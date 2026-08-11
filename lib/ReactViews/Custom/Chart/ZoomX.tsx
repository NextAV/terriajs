import { select as d3Select } from "d3-selection";
import { zoom as d3Zoom, zoomIdentity } from "d3-zoom";
import { useEffect, type MutableRefObject, type ReactNode } from "react";
import { XScale } from "./types";
import {
  panTargetIsReachable,
  zoomActionForDomain
} from "../../../Charts/chartZoomWindow";

/**
 * Imperative handle for driving the chart's zoom PROGRAMMATICALLY through the
 * SAME d3 behavior the wheel/drag gestures use. Every method goes through
 * `selection.call(zoom.…)`, so the "zoom" event fires and the entire publish
 * pipeline (zoomed scale → post-commit domain publish → any scrubber aligned
 * to it) sees a programmatic zoom exactly as it sees a gesture. A parallel
 * zoom state — anything that writes scales without going through the behavior
 * — is the de-sync class this file's `extent` comment describes; do not add
 * one.
 */
export interface ZoomXApi {
  /** Multiply the current scale by `factor`, anchored at the extent centre
   *  (d3's own default). Constrained by scaleExtent/translateExtent. */
  scaleBy: (factor: number) => void;
  /** Display exactly `domain` (epoch-ms) across the plot. Passed through
   *  d3's OWN constrain, so a window wider than the data clamps to the
   *  initial view rather than under-zooming (k < 1 never renders). */
  zoomToDomain: (domain: [number, number]) => void;
  /** Pan (constrained, keeping k) so the world position of `ms` sits at the
   *  extent centre. No-op at identity, where everything is already visible. */
  centerOn: (ms: number) => void;
  /** Return to the identity transform — the full initial view. */
  resetIdentity: () => void;
}

interface Props {
  initialScale: XScale;
  scaleExtent: [number, number];
  translateExtent: [[number, number], [number, number]];
  /**
   * Viewport extent of the zoom, in the surface's coordinate space. Pass the
   * chart's own box AND THE SAME VALUE as `translateExtent` — d3's constraint
   * forces the identity transform at scale k=1 only when the two boxes are
   * identical; let them diverge and a zoom-out silently stops returning to
   * the initial view (the original bug re-emerges). With them identical, a
   * wheel zoom-out always lands EXACTLY back on the initial view. Previously
   * d3 derived the extent from the owner SVG while `translateExtent` ran to
   * Infinity, so a zoom-out anchored away from where the zoom-in happened
   * settled at k=1 with a residual translate — the chart stuck panned into
   * empty space past the data, and under the UNBOUNDED extents no gesture
   * re-constrained it (reported 2026-07-06 as the bottom-chart/scrubber
   * de-sync on al-shaheen; the defect itself is tenant-agnostic). A stale
   * out-of-bounds transform surviving from before this fix self-heals on the
   * user's next zoom gesture — re-binding preserves the node's `__zoom`, and
   * the new constraint applies when the gesture fires. Optional: when
   * absent, d3's default extent is used — the pre-existing behaviour.
   */
  extent?: [[number, number], [number, number]];
  /**
   * Optional out-param populated with the imperative zoom API while the
   * behavior is bound (null when unmounted). Lets zoom BUTTONS and a
   * programmatic default window drive the same behavior as the wheel.
   */
  apiRef?: MutableRefObject<ZoomXApi | null>;
  children: ReactNode;
  onZoom: (arg: XScale) => void;
  surface: string;
}

export const ZoomX = ({
  surface,
  scaleExtent,
  translateExtent,
  extent,
  apiRef,
  initialScale,
  onZoom,
  children
}: Props) => {
  useEffect(() => {
    const zoom = d3Zoom()
      .scaleExtent(scaleExtent)
      .translateExtent(translateExtent)
      .on("zoom", (event) => {
        onZoom(event.transform.rescaleX(initialScale));
      });
    if (extent) zoom.extent(extent);

    const selection = d3Select(surface);
    selection.call(zoom as never);

    if (apiRef) {
      apiRef.current = {
        scaleBy: (factor) => {
          if (!Number.isFinite(factor) || factor <= 0) return;
          // d3's scaleBy routes through its constrain — extent-aware.
          zoom.scaleBy(selection as never, factor);
        },
        zoomToDomain: (domain) => {
          const p0 = Number(initialScale(domain[0]));
          const p1 = Number(initialScale(domain[1]));
          const plotWidth = extent ? extent[1][0] - extent[0][0] : NaN;
          // The DECISION (noop / identity / transform) is pure and unit-tested
          // in `chartZoomWindow`; only the d3 calls live here. In particular
          // the k clamp must be explicit: `zoom.transform` applies k verbatim
          // (d3 clamps k only in scaleTo/scaleBy/wheeled), so a window wider
          // than the data would otherwise render at k < 1 with blank margins.
          const action = zoomActionForDomain(p0, p1, plotWidth, scaleExtent[0]);
          if (action.kind === "noop") return;
          if (action.kind === "identity") {
            zoom.transform(selection as never, zoomIdentity);
            return;
          }
          const raw = zoomIdentity.translate(action.x, 0).scale(action.k);
          // `zoom.transform` applies verbatim, so run d3's own constrain for
          // the TRANSLATE half (keeps the window inside translateExtent).
          const constrained = extent
            ? (zoom.constrain()(raw, extent, translateExtent) as typeof raw)
            : raw;
          zoom.transform(selection as never, constrained);
        },
        centerOn: (ms) => {
          const px = Number(initialScale(ms));
          if (!Number.isFinite(px)) return;
          // REFUSE an unreachable target. `translateTo` is constrained by
          // `translateExtent`, so a world x outside the plot box cannot be
          // panned to — but d3 emits "zoom" UNCONDITIONALLY (zoom.js
          // gesture.zoom -> emit), and this component's handler builds a NEW
          // scale object per emit, so a caller that re-runs on scale identity
          // would spin forever on a target it can never reach. That is not
          // hypothetical here: a timeline driver may carry more instants than
          // the chart has bars (al-shaheen's 233-pass union vs its
          // credible-detection bars), so an instant outside the chart's own
          // domain is reachable by one ◀ step.
          const [lo, hi] = extent
            ? [extent[0][0], extent[1][0]]
            : [-Infinity, Infinity];
          if (!panTargetIsReachable(px, lo, hi)) return;
          // World coords are the UN-zoomed pixel space, which is exactly
          // `initialScale(ms)`; y is irrelevant for an x-only zoom.
          zoom.translateTo(selection as never, px, 0);
        },
        resetIdentity: () => {
          zoom.transform(selection as never, zoomIdentity);
        }
      };
    }

    return () => {
      selection.on(".zoom", null);
      if (apiRef) apiRef.current = null;
    };
  }, [
    initialScale,
    onZoom,
    scaleExtent,
    surface,
    translateExtent,
    extent,
    apiRef
  ]);

  // eslint-disable-next-line react/jsx-no-useless-fragment
  return <>{children}</>;
};
ZoomX.displayName = "ZoomX";

export default ZoomX;

import { select as d3Select } from "d3-selection";
import { zoom as d3Zoom } from "d3-zoom";
import { useEffect, type ReactNode } from "react";
import { XScale } from "./types";

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
  children: ReactNode;
  onZoom: (arg: XScale) => void;
  surface: string;
}

export const ZoomX = ({
  surface,
  scaleExtent,
  translateExtent,
  extent,
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

    return () => {
      selection.on(".zoom", null);
    };
  }, [initialScale, onZoom, scaleExtent, surface, translateExtent, extent]);

  // eslint-disable-next-line react/jsx-no-useless-fragment
  return <>{children}</>;
};
ZoomX.displayName = "ZoomX";

export default ZoomX;

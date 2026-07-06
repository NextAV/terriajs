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
   * chart's own box (and the same value as `translateExtent`) so d3's
   * constraint forces the identity transform at scale k=1: a wheel zoom-out
   * then always lands EXACTLY back on the initial view. Without it d3 derives
   * the extent from the owner SVG while `translateExtent` ran to Infinity, so
   * a zoom-out anchored away from where the zoom-in happened settled at k=1
   * with a residual translate — the chart stuck panned into empty space past
   * the data, with no gesture able to bring it home (reported 2026-07-06 as
   * the bottom-chart/scrubber de-sync on al-shaheen; the defect itself is
   * tenant-agnostic). Optional: when absent, d3's default extent is used —
   * the pre-existing behaviour.
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

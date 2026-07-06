import { observer } from "mobx-react";
import { forwardRef, useImperativeHandle } from "react";
import type { ChartPoint } from "../../../Charts/ChartData";
import type { ChartItem } from "../../../ModelMixins/ChartableMixin";
import type { ChartZoomHandle, Scales } from "./types";

interface Props {
  id: string;
  chartItem: ChartItem;
  scales: Scales;
  color?: string;
}

// A bar fills this fraction of the gap to its nearest neighbour, leaving a small gutter so
// per-date counts read as discrete columns rather than a solid block.
const BAR_FILL_FRACTION = 0.7;
// Used when there is a single point (no neighbour gap to measure) or the measured width
// degenerates — keeps a lone bar visible without guessing a huge width.
const FALLBACK_BAR_WIDTH = 6;
// Caps the width so a chart with only a few points doesn't render absurdly wide bars.
const MAX_BAR_WIDTH = 48;

// Bar width = a fraction of the SMALLEST gap between adjacent bars, so no two bars overlap
// even when the x values are unevenly spaced. Recomputed from whichever x-mapping is in
// force (initial or zoomed) because zooming changes the pixel spacing. Takes a bare
// x→pixel mapping so it works with both the d3 scale (initial render) and the plain
// rescaled function handed to doZoom.
function computeBarWidth(
  bars: readonly ChartPoint[],
  toPixels: (x: number | Date) => number
): number {
  if (bars.length < 2) return FALLBACK_BAR_WIDTH;
  const xs = bars
    .map((p) => toPixels(p.x))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1];
    // `gap > 0` intentionally excludes coincident pixels (two points that zoom
    // collapses onto the same x), which would otherwise yield a zero-width bar.
    if (gap > 0 && gap < minGap) minGap = gap;
  }
  if (!Number.isFinite(minGap)) return FALLBACK_BAR_WIDTH;
  return Math.min(MAX_BAR_WIDTH, Math.max(1, minGap * BAR_FILL_FRACTION));
}

// The transparent click hit area is a bit wider than the visible bar (min ~10px) so a
// thin bar is still an easy click target, without widening the bar's visual footprint.
// `barWidth / BAR_FILL_FRACTION` recovers ~the full inter-bar gap (the bar fills that
// fraction of it), giving a per-date "column" hit target.
function hitWidthFor(barWidth: number): number {
  return Math.max(barWidth / BAR_FILL_FRACTION, 10);
}

/**
 * Vertical-bar renderer for discrete per-x counts (e.g. candidate detections per date).
 * A line implies continuity between samples that discrete daily counts don't have; bars
 * make each date's count read as its own column. Bars are anchored at the plot bottom and
 * extend up to the value's y-pixel.
 *
 * The bottom-dock chart zooms the X axis only (ZoomX → rescaleX), so bar HEIGHTS are
 * invariant under zoom — doZoom re-x's and re-widths the bars imperatively (mirroring
 * LineChart's imperative path update) without touching y/height.
 */
const _BarChart = forwardRef<ChartZoomHandle, Props>(
  ({ id, chartItem, scales, color }, ref) => {
    const points = chartItem.points;
    // Only points whose x maps to a finite pixel and whose y is finite become a drawable
    // bar. Filter ONCE so the JSX render and the imperative doZoom iterate the same set —
    // keeping the `#id rect` node order aligned with `bars` for index-based zoom updates.
    const bars = points.filter(
      (p) => Number.isFinite(scales.x(p.x)) && Number.isFinite(p.y)
    );

    useImperativeHandle(
      ref,
      () => ({
        doZoom(zoomed) {
          // Two rects per bar: the visible bar + a full-height transparent HIT area
          // (so a thin bar is still easy to click). Select each class separately so
          // the index alignment with `bars` holds.
          const vis = document.querySelectorAll<SVGRectElement>(
            `#${id} rect.bar-vis`
          );
          const hit = document.querySelectorAll<SVGRectElement>(
            `#${id} rect.bar-hit`
          );
          // A mismatch means the DOM is mid-rebuild; skip this frame rather than
          // mis-assign widths across bars.
          if (vis.length !== bars.length || hit.length !== bars.length) return;
          const width = computeBarWidth(bars, zoomed.x);
          const hitW = hitWidthFor(width);
          bars.forEach((p, i) => {
            const cx = zoomed.x(p.x);
            // Under X-only zoom a point that was finite at initial render stays
            // finite, so this is defensive only; if it ever hits, the bar keeps its
            // prior x/width (index alignment is preserved) rather than getting NaN.
            if (!Number.isFinite(cx)) return;
            vis[i].setAttribute("x", String(cx - width / 2));
            vis[i].setAttribute("width", String(width));
            hit[i].setAttribute("x", String(cx - hitW / 2));
            hit[i].setAttribute("width", String(hitW));
          });
        }
      }),
      // Includes `scales` (unlike LineChart's [id, chartItem]) because `bars` is
      // filtered through scales.x — the handle must rebuild if the scale changes so
      // the rect node order stays aligned with `bars`.
      [id, bars, scales]
    );

    const fill = color || chartItem.getColor();
    const width = computeBarWidth(bars, scales.x);
    // Anchor at the plot bottom (the larger end of the inverted [height, 0] y-range) so a
    // bar's base sits on the axis regardless of whether the y-domain is floored at 0 — a
    // small-count bar is never clipped to zero height by a non-zero domain minimum.
    const [r0, r1] = scales.y.range();
    const baseline = Math.max(r0, r1);
    const plotTop = Math.min(r0, r1);
    const plotHeight = Math.abs(r0 - r1);
    const hitW = hitWidthFor(width);
    // A bar chart of a time series is clickable — the chart item's onClick (set by
    // TableMixin for `chartType:"bar"`) scrubs the timeline to the bar's date.
    const onBarClick =
      typeof chartItem.onClick === "function"
        ? (p: ChartPoint) => chartItem.onClick(p)
        : undefined;

    return (
      <g id={id}>
        {bars.map((p, i) => {
          const cx = scales.x(p.x);
          const top = scales.y(p.y);
          return (
            <g
              key={i}
              onClick={onBarClick ? () => onBarClick(p) : undefined}
              style={onBarClick ? { cursor: "pointer" } : undefined}
            >
              {/* Full-height transparent hit area so a thin bar is easy to click.
                  Rendered only when clickable so it never intercepts hover/zoom on a
                  non-interactive bar chart. */}
              {onBarClick && (
                <rect
                  className="bar-hit"
                  x={cx - hitW / 2}
                  y={plotTop}
                  width={hitW}
                  height={plotHeight}
                  fill="transparent"
                />
              )}
              <rect
                className="bar-vis"
                x={cx - width / 2}
                y={Math.min(top, baseline)}
                width={width}
                height={Math.abs(baseline - top)}
                fill={fill}
              />
            </g>
          );
        })}
      </g>
    );
  }
);

_BarChart.displayName = "BarChart";

export default observer(_BarChart);

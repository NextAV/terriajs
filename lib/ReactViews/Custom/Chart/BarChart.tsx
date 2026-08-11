import { observer } from "mobx-react";
import { forwardRef, useImperativeHandle } from "react";
import { computeHitBounds } from "../../../Charts/barHitBounds";
import type { ChartPoint } from "../../../Charts/ChartData";
import type { ChartItem } from "../../../ModelMixins/ChartableMixin";
import type { ChartZoomHandle, Scales } from "./types";

interface Props {
  id: string;
  chartItem: ChartItem;
  scales: Scales;
  color?: string;
  /**
   * Whether this series draws the transparent click targets. With several bar series on
   * one axis every series would otherwise draw its own, and a full-height hit rect is a
   * PAINTED element (`fill="transparent"` still satisfies `pointer-events:
   * visiblePainted`), so the last one painted becomes the click target for the whole plot
   * — making every earlier series' bars unclickable and resolving clicks to the wrong
   * series' nearest point. Exactly one series draws them, and it must be the BACKMOST,
   * where it cannot cover anything. Defaults to true: a single-series chart is
   * byte-identical.
   */
  rendersHitLayer?: boolean;
  /**
   * The x values the bar WIDTH is measured from. Must be the union across every bar
   * series on the chart, so all series share one band and the inset is a structural
   * guarantee rather than a coincidence of which series happens to contain the tightest
   * pair. Omitted (single-series charts) → measured from this series' own bars, which is
   * the historical behaviour.
   */
  bandPoints?: readonly ChartPoint[];
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
  (
    {
      id,
      chartItem,
      scales,
      color,
      rendersHitLayer = true,
      bandPoints
    },
    ref
  ) => {
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
          // The visible bars always re-x on zoom. The full-height transparent HIT
          // rects (one per bar, for easy clicking) exist ONLY when the chart is
          // clickable — so gate their count check on `clickable`, or a non-clickable
          // bar chart (hit.length === 0) would fail the guard and freeze the visible
          // bars' zoom too.
          const vis = document.querySelectorAll<SVGRectElement>(
            `#${id} rect.bar-vis`
          );
          // A mismatch means the DOM is mid-rebuild; skip this frame rather than
          // mis-assign widths across bars.
          if (vis.length !== bars.length) return;
          const clickable =
            typeof chartItem.onClick === "function" && rendersHitLayer;
          const hit = clickable
            ? document.querySelectorAll<SVGRectElement>(`#${id} rect.bar-hit`)
            : null;
          if (hit && hit.length !== bars.length) return;
          // Inset AFTER re-measuring the band, so the nesting holds at every zoom level
          // rather than only at the initial scale.
          const width = computeBarWidth(bandPoints ?? bars, zoomed.x);
          // Recomputed from the ZOOMED mapping: the tiling depends on pixel spacing,
          // which zoom changes, so a hit area computed at the initial scale would
          // drift out from under its bar as soon as the user zooms.
          const hitBounds = computeHitBounds(bars, zoomed.x);
          bars.forEach((p, i) => {
            const cx = zoomed.x(p.x);
            // Under X-only zoom a point that was finite at initial render stays
            // finite, so this is defensive only; if it ever hits, the bar keeps its
            // prior x/width (index alignment is preserved) rather than getting NaN.
            if (!Number.isFinite(cx)) return;
            vis[i].setAttribute("x", String(cx - width / 2));
            vis[i].setAttribute("width", String(width));
            const b = hitBounds[i];
            if (hit && b) {
              hit[i].setAttribute("x", String(b.x));
              hit[i].setAttribute("width", String(b.width));
            }
          });
        }
      }),
      // Includes `scales` (unlike LineChart's [id, chartItem]) because `bars` is
      // filtered through scales.x — the handle must rebuild if the scale changes so
      // the rect node order stays aligned with `bars`; and `chartItem` because
      // doZoom now branches on `chartItem.onClick` (whether hit rects exist).
      [
        id,
        bars,
        scales,
        chartItem,
        rendersHitLayer,
        bandPoints
      ]
    );

    const fill = color || chartItem.getColor();
    // Band from the SHARED points (all bar series) so every series insets from the same
    // basis; per-series bands made the "each series is narrower than the one behind it"
    // guarantee depend on which series happened to hold the tightest pair.
    const width = computeBarWidth(bandPoints ?? bars, scales.x);
    // Anchor at the plot bottom (the larger end of the inverted [height, 0] y-range).
    // A bar's HEIGHT is baseline - scales.y(value), so it is proportional to `value`
    // only when the y-domain includes 0 (then scales.y(0) == baseline). calculateDomainY
    // (BottomDockChart) zero-bases the domain whenever a bar item is present for exactly
    // this reason: a non-zero domain minimum collapses the smallest-value bar toward
    // zero height.
    const [r0, r1] = scales.y.range();
    const baseline = Math.max(r0, r1);
    const plotTop = Math.min(r0, r1);
    const plotHeight = Math.abs(r0 - r1);
    const hitBounds = computeHitBounds(bars, scales.x);
    // A bar chart of a time series is clickable — the chart item's onClick (set by
    // TableMixin for `chartType:"bar"`) scrubs the timeline to the bar's date.
    // Bound whether or not this series draws the hit layer: a click landing on a VISIBLE
    // bar hits that rect and bubbles only through its own ancestors, never to a sibling
    // series' hit rect — so dropping this would make the front series' bars dead.
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
              {onBarClick && rendersHitLayer && hitBounds[i] && (
                <rect
                  className="bar-hit"
                  x={hitBounds[i]!.x}
                  y={plotTop}
                  width={hitBounds[i]!.width}
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

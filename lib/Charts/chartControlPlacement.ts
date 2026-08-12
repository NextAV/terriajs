/**
 * Pure placement math for the bottom-dock chart's overlay controls.
 *
 * Kept dependency-free (no d3, no React) for the same reason as
 * `chartZoomWindow` / `barHitBounds`: the decision is testable, and the
 * component only renders the number it is handed. A placement rule written
 * inline in JSX is reachable by no assertion at all — which is how the first
 * version of these controls shipped occluding data nobody had counted.
 */

export interface ControlStackGeometry {
  /** Left edge of the plot band (`adjustedMargin.left`). */
  plotLeft: number;
  /** Width of the plot band. */
  plotWidth: number;
  /** The chart's right margin (`adjustedMargin.right`). */
  marginRight: number;
  /** The stack's width. */
  controlSize: number;
  /** Gap from the band's right edge in the fallback case. */
  inset?: number;
}

/**
 * Left edge (in the chart's own prop-coordinate px) of the zoom-control stack.
 *
 * Takes a NAMED object rather than four positional numbers deliberately.
 * `marginRight` and `controlSize` are both 30 at the shipped defaults, so a
 * positional signature makes swapping them a silent no-op today and a 74px
 * error for any consumer passing `margin.right = 50` — and `margin` is public
 * API on `BottomDockChartProps`. A review found exactly that swap survived
 * every assertion, because the call site is not reachable from a unit test.
 * Naming the arguments removes the class instead of documenting it.
 *
 * The stack sits in the chart's RIGHT MARGIN whenever that margin can hold it,
 * flush with the chart's right edge — so it overlaps the plot band, and
 * therefore the data, by exactly zero px. When the margin is narrower than the
 * stack there is nowhere outside the band to put it, so it falls back inside,
 * inset from the band's right edge (the historical placement).
 *
 * Why flush rather than with a gap: the default margin (30) equals the default
 * control size (30), so any gap would have to come out of the plot band or
 * overflow the chart's declared width. Where a consumer gives a wider right
 * margin the surplus becomes the gap on the INBOARD side, which is the side
 * that matters — the stack stays pinned to the chart's edge either way.
 *
 * Do NOT lean on the root svg rendering wider than the `width` prop for extra
 * room (it does today — see the `width="100%"` vs `width` prop mismatch); that
 * is a known defect, and a placement that depends on it breaks when it is
 * fixed.
 *
 * NOTE the invariant this rests on: `adjustedMargin` in `BottomDockChart` is
 * `{...margin, left: margin.left + estimatedYAxesWidth}`, so `.right` passes
 * through unchanged and `plotLeft + plotWidth === width - marginRight`
 * exactly. The taken branch therefore returns `width - controlSize` for ANY
 * `marginRight >= controlSize`, independent of the y-axis label width. Add
 * `right:` to that spread and the stack silently overhangs the chart.
 */
export function controlStackLeft({
  plotLeft,
  plotWidth,
  marginRight,
  controlSize,
  inset = 4
}: ControlStackGeometry): number {
  const bandRight = plotLeft + plotWidth;
  const inboard = bandRight - controlSize - inset;
  // `marginRight` is the one value a CONSUMER supplies (the `margin` prop);
  // `controlSize` is a module constant. Guard the one that can arrive broken,
  // and degrade to the inboard placement rather than to NaN.
  if (!Number.isFinite(marginRight)) return inboard;
  // Enough margin to clear the plot band entirely -> sit in it, flush right.
  if (marginRight >= controlSize) return bandRight + (marginRight - controlSize);
  return inboard;
}

/**
 * True when the stack, placed by `controlStackLeft`, overlaps the plot band.
 *
 * Exists so "does this occlude data?" is an assertion rather than a claim in a
 * commit message. The answer is expected to be false for the default margin
 * and true only in the degenerate narrow-margin fallback.
 */
export function controlStackOverlapsPlot(g: ControlStackGeometry): boolean {
  return controlStackLeft(g) < g.plotLeft + g.plotWidth;
}

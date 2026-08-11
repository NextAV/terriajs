/**
 * Pure math for the bottom-dock chart's programmatic zoom: the default time
 * window and the d3 transform that displays a given x-domain.
 *
 * Kept dependency-free (no d3, no React) so the invariants are testable the
 * same way `barColumnSnap` / `barHitBounds` are — the component translates
 * these numbers into `d3-zoom` calls but never re-derives them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Latest finite x (epoch ms) across every chart item's points, or undefined
 * when nothing is plottable. Accepts Date or number x — the chart's own
 * points carry either depending on the column type.
 */
export function latestPointMs(
  chartItems: ReadonlyArray<{
    points: ReadonlyArray<{ x: Date | number }>;
  }>
): number | undefined {
  let last: number | undefined;
  for (const item of chartItems) {
    for (const p of item.points) {
      const ms = p.x instanceof Date ? p.x.getTime() : Number(p.x);
      if (!Number.isFinite(ms)) continue;
      if (last === undefined || ms > last) last = ms;
    }
  }
  return last;
}

/**
 * The default window: the last `days` days OF THE DATA, anchored at the
 * latest observation — never at the wall clock. A dashboard whose ingest lags
 * would otherwise open on dead whitespace, and "how stale is this?" is a
 * caption's job, not an empty plot's. One day of right-hand pad keeps the
 * final bar (drawn from its period START) fully inside the window.
 *
 * Returns undefined when the request is degenerate (no data, or a
 * non-positive day count) — callers treat that as "no default window".
 */
export function defaultTimeWindow(
  lastMs: number | undefined,
  days: number | undefined
): [number, number] | undefined {
  if (lastMs === undefined || !Number.isFinite(lastMs)) return undefined;
  if (days === undefined || !Number.isFinite(days) || days <= 0)
    return undefined;
  const end = lastMs + DAY_MS;
  return [end - days * DAY_MS, end];
}

/**
 * The d3 zoom transform (k, x translate) that renders `domain` across a plot
 * of `plotWidth` px, given where the UN-zoomed scale puts the domain's ends
 * (`p0`, `p1` px). d3 applies `x' = k·x + tx`, so mapping [p0, p1] onto
 * [0, plotWidth] is k = plotWidth/(p1−p0), tx = −k·p0.
 *
 * Returns undefined on any degenerate input (zero/negative span, non-finite
 * pixels, unmeasured plot) rather than handing d3 an Infinity — the caller
 * then simply does not zoom, which is the safe no-op.
 *
 * NOTE k may be < 1 (a requested window WIDER than the data domain). The
 * caller passes the result through d3's own constrain with scaleExtent
 * [1, ∞), which clamps it back to identity — deliberately not re-implemented
 * here, so there is exactly one constraint implementation.
 */
export function transformForDomain(
  p0: number,
  p1: number,
  plotWidth: number
): { k: number; x: number } | undefined {
  if (!Number.isFinite(p0) || !Number.isFinite(p1)) return undefined;
  if (!(plotWidth > 0)) return undefined;
  const span = p1 - p0;
  if (!(span > 0)) return undefined;
  const k = plotWidth / span;
  return { k, x: -k * p0 };
}

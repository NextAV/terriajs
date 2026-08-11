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
 * k MAY BE < 1 — a requested window WIDER than the data domain. The caller
 * MUST clamp that itself. An earlier version of this note said d3's own
 * `constrain` would clamp it back to identity via `scaleExtent`; that is
 * FALSE and was verified false against real d3: `defaultConstrain` only
 * TRANSLATES, and the k clamp lives in scaleTo/scaleBy/wheeled — paths
 * `zoom.transform` never takes. A 90-day window on a 30-day archive measured
 * k = 0.3333 both before and after `constrain`, rendering the chart
 * under-zoomed with blank margins past the last observation.
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

/**
 * What `zoomToDomain` should DO for a requested window — the decision, split
 * out from the d3 calls so it is testable.
 *
 * This exists because the first version of this change put the clamp inline
 * in the component and asserted (wrongly) that d3's `constrain` handled it.
 * The pure-math tests could not reach that claim, so nothing caught it; a
 * review did, by executing real d3. Decisions belong here; only the d3 calls
 * belong in the component.
 *
 *  - `noop`     — degenerate request; do not touch the transform.
 *  - `identity` — the window is at least as wide as the data, so showing it
 *                 means showing everything. Must NOT be expressed as k < 1:
 *                 `zoom.transform` applies k verbatim (d3 clamps k only in
 *                 scaleTo/scaleBy/wheeled), so k < 1 renders the chart
 *                 under-zoomed with blank margins past the last observation.
 *  - `transform`— a genuine zoom-in.
 */
export function zoomActionForDomain(
  p0: number,
  p1: number,
  plotWidth: number,
  minScale: number
): { kind: "noop" } | { kind: "identity" } | { kind: "transform"; k: number; x: number } {
  const t = transformForDomain(p0, p1, plotWidth);
  if (!t) return { kind: "noop" };
  if (!Number.isFinite(minScale)) return { kind: "transform", k: t.k, x: t.x };
  if (t.k <= minScale) return { kind: "identity" };
  return { kind: "transform", k: t.k, x: t.x };
}

/**
 * Whether a pan target is REACHABLE, i.e. inside the pannable box.
 *
 * d3's `translateTo` is constrained by `translateExtent`, so an out-of-box
 * target silently cannot be reached — but d3 emits its "zoom" event
 * unconditionally, and a consumer that rebuilds a scale object per emit will
 * therefore see a fresh identity forever and re-run indefinitely. A caller
 * that pans in response to a scale change MUST check this first.
 *
 * Non-finite `px` is unreachable (never pan to NaN).
 */
export function panTargetIsReachable(
  px: number,
  lo: number,
  hi: number
): boolean {
  if (!Number.isFinite(px)) return false;
  return px >= lo && px <= hi;
}

/**
 * How stale the newest data point is, for a caption that states it.
 *
 * A chart windowed onto the last N days OF ITS DATA (see `defaultTimeWindow`)
 * is always full, which is what makes it readable — but it also means a feed
 * that stopped updating LOOKS current, because its right edge is still the
 * newest bar. On a product whose contract is "did we look?", that is exactly
 * the wrong thing to leave implied, so the window keeps its anchor and the
 * staleness is SAID instead.
 *
 * Returns undefined when there is no data or when the gap is below
 * `minDays` — a feed that is current should carry no caption at all, rather
 * than a reassuring "0 days ago" that adds noise to every other dashboard.
 *
 * `nowMs` is a parameter, never `Date.now()` read inside: this has to be
 * testable, and a function that reads the clock itself cannot be.
 */
export function stalenessDays(
  lastMs: number | undefined,
  nowMs: number,
  minDays = 2
): number | undefined {
  if (lastMs === undefined || !Number.isFinite(lastMs)) return undefined;
  if (!Number.isFinite(nowMs)) return undefined;
  const days = Math.floor((nowMs - lastMs) / (24 * 60 * 60 * 1000));
  if (!Number.isFinite(days) || days < minDays) return undefined;
  return days;
}

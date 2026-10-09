/**
 * Snapping between a discrete-interval bar chart's x values and a timeline's
 * discrete instants.
 *
 * A per-period bar chart (e.g. one bar per DAY) plots each bar at the START of
 * its period — a daily CSV column `2026-05-08` becomes `2026-05-08T00:00:00Z`.
 * The timeline's discrete instants, by contrast, are the real observation times
 * inside those periods (`2026-05-08T14:32:37Z`). The two therefore never
 * coincide, and mapping between them by NEAREST is wrong:
 *
 *   bar 2026-05-08 00:00Z   ->  nearest instant is 2026-05-07T14:32Z (9.5 h
 *                               before) rather than its OWN 2026-05-08T14:32Z
 *                               (14.5 h after)
 *
 * i.e. for any period whose observation falls in its second half, "nearest"
 * selects the PREVIOUS period. Measured on the al-Shaheen Sentinel-1 archive
 * (229 daily bars, 233 pass instants, roughly half of them ~14:30Z ascending
 * passes) nearest-matching sends 57 of 229 bar clicks (25%) to the wrong day.
 *
 * The correct relation is CONTAINMENT, not proximity: an instant belongs to the
 * period it falls inside, `[columnStart, columnStart + span)`. That is what
 * these helpers implement, in both directions.
 *
 * Agreement between a bar click and the chart's "selected time" marker rests on
 * both using this predicate AND on each real instant lying inside its own
 * column. It is NOT guaranteed by the shared predicate alone: the two callers
 * measure `span` from different inputs (the clicked series' points vs every bar
 * series flattened), so a chart mixing bar series of different periods could in
 * principle have them disagree. Align the span source if that case ever arises.
 *
 * Basis note — what containment does NOT cover. It assumes a bar's x is at or
 * before its own instants, which holds when x values are period STARTS in the
 * same frame as the instants (ISO date-only columns: `Date.parse` → UTC
 * midnight) or in a frame behind it. Where that fails, the failure is SILENT
 * rather than a fallback: an instant earlier than its own column's start is
 * simply contained by the ADJACENT column, and both directions agree on that
 * wrong column, so nothing returns `undefined`. `undefined` is returned only
 * when NO column contains the instant at all.
 */

/** One day in ms — the default column span when it cannot be measured. */
export const DEFAULT_COLUMN_SPAN_MS = 24 * 60 * 60 * 1000;

/**
 * Width of one column: the smallest positive gap between adjacent x values.
 *
 * The SMALLEST gap (not the mean or modal one) is what makes containment safe —
 * a wider span could swallow the next column's instants, whereas a span that is
 * too narrow only ever fails to match, which the callers treat as "no opinion"
 * and fall back on. Ignores non-finite values and coincident points.
 */
export function columnSpanMs(xs: readonly number[]): number {
  const sorted = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0 && gap < min) min = gap;
  }
  return Number.isFinite(min) && min > 0 ? min : DEFAULT_COLUMN_SPAN_MS;
}

/**
 * The instant belonging to the column that STARTS at `columnStartMs` — i.e. the
 * earliest instant in `[columnStartMs, columnStartMs + spanMs)`.
 *
 * Earliest (not nearest-within-window) is deliberate: when a period holds more
 * than one observation — Sentinel-1 images the al-Shaheen AOI twice on 4 dates
 * in the archive — the first is the reproducible choice, and stepping to the
 * second stays available on the timeline itself.
 *
 * Returns `undefined` when the column contains no instant, which is a real
 * state (a bar for a period the timeline has no instant for), not an error.
 */
export function instantForColumn(
  columnStartMs: number,
  instantsMs: readonly number[],
  spanMs: number = DEFAULT_COLUMN_SPAN_MS
): number | undefined {
  if (!Number.isFinite(columnStartMs) || !(spanMs > 0)) return undefined;
  const end = columnStartMs + spanMs;
  let best: number | undefined;
  for (const t of instantsMs) {
    if (!Number.isFinite(t)) continue;
    if (t >= columnStartMs && t < end && (best === undefined || t < best)) {
      best = t;
    }
  }
  return best;
}

/**
 * The column start that OWNS `instantMs` — the largest `columnStartsMs` value
 * with `start <= instantMs < start + spanMs`.
 *
 * A ONE-SIDED inverse of `instantForColumn`, not a true one: `column → instant
 * → column` is the identity (the direction both callers rely on), while
 * `instant → column → instant` collapses a period holding two observations onto
 * the earlier of them.
 *
 * Used to draw a "selected time" marker on the bar it belongs to rather than at
 * the instant's own x, which on a daily chart sits up to a full period to the
 * right of its bar (an afternoon pass is ~0.6 of a day past midnight).
 *
 * Returns `undefined` when no column contains the instant, so a caller keeps
 * its exact-position behaviour instead of snapping to an unrelated bar.
 */
export function columnForInstant(
  instantMs: number,
  columnStartsMs: readonly number[],
  spanMs: number = DEFAULT_COLUMN_SPAN_MS
): number | undefined {
  if (!Number.isFinite(instantMs) || !(spanMs > 0)) return undefined;
  let best: number | undefined;
  for (const start of columnStartsMs) {
    if (!Number.isFinite(start)) continue;
    if (
      start <= instantMs &&
      instantMs < start + spanMs &&
      (best === undefined || start > best)
    ) {
      best = start;
    }
  }
  return best;
}

/** A bar's x and, when the data declares one, the period it stands for. */
export interface BarColumn {
  xMs: number;
  periodStartMs?: number;
  periodEndMs?: number;
}

function hasDeclaredPeriod(bar: BarColumn): boolean {
  const start = Number.isFinite(bar.periodStartMs)
    ? (bar.periodStartMs as number)
    : bar.xMs;
  return (
    bar.periodEndMs !== undefined &&
    Number.isFinite(bar.periodEndMs) &&
    Number.isFinite(start) &&
    bar.periodEndMs > start
  );
}

/**
 * The bar x the "selected time" marker should sit on — the marker's side of
 * `resolveBarClick`, with the SAME two regimes so the marker and the click
 * cannot disagree about which bar an instant belongs to.
 *
 * DECLARED (any bar declares a valid period): the bar whose own declared
 * `[periodStartMs, periodEndMs)` contains the instant (the latest-starting one
 * if periods overlap). No inferred span is used: on a half-month chart the
 * smallest gap is 13 days, so a frame on day 29-31 of a 16-day half-month would
 * be selected by the click on its bar while an inferred marker missed that bar.
 * An instant no declared period contains returns `undefined` (the marker keeps
 * its exact x), exactly as the click refuses to jump out of a period.
 *
 * INFERRED (no bar declares a period, every chart before this existed):
 * `columnForInstant` over the bars' x with `spanMs`, unchanged.
 */
export function markerColumnForInstant(
  instantMs: number,
  bars: readonly BarColumn[],
  spanMs: number = DEFAULT_COLUMN_SPAN_MS
): number | undefined {
  if (!Number.isFinite(instantMs)) return undefined;
  const declared = bars.filter(hasDeclaredPeriod);
  if (declared.length === 0) {
    return columnForInstant(
      instantMs,
      bars.map((b) => b.xMs),
      spanMs
    );
  }
  let best: BarColumn | undefined;
  let bestStart = -Infinity;
  for (const bar of declared) {
    const start = Number.isFinite(bar.periodStartMs)
      ? (bar.periodStartMs as number)
      : bar.xMs;
    if (
      start <= instantMs &&
      instantMs < (bar.periodEndMs as number) &&
      start > bestStart
    ) {
      best = bar;
      bestStart = start;
    }
  }
  return best === undefined ? undefined : best.xMs;
}

/**
 * Where a click on a bar sends the timeline.
 *
 * Two regimes, chosen by whether the data DECLARES the bar's period.
 *
 * INFERRED (no declared period, every chart before this existed): the period is
 * `[clickMs, clickMs + spanMs)` with `spanMs` measured from the series' own
 * smallest gap, and a period holding no instant falls back to the NEAREST
 * instant. That fallback is the frame-safety valve described at the top of this
 * file, and this branch is the previous inline logic moved here unchanged.
 *
 * DECLARED (`periodEndMs` given): the bar stands for `[periodStartMs, periodEndMs)`
 * exactly as the data says — `periodStartMs` defaults to `clickMs` — so a
 * calendar half-month of 13, 15 or 16 days is contained exactly instead of by
 * the smallest gap. A declared period with no instant inside it resolves to
 * `emptyPeriod`, never to the nearest instant: the nearest may be weeks away,
 * and landing there would show a picture from another period under a click on
 * this one. The caller says so instead of moving the clock.
 *
 * A declared period that is not a period (non-finite, or end <= start) is
 * treated as undeclared, so a malformed row degrades to the old behaviour
 * rather than to a dead bar.
 */
export type BarClickResolution =
  | { kind: "instant"; instantMs: number }
  | { kind: "emptyPeriod"; periodStartMs: number; periodEndMs: number }
  | { kind: "none" };

export function resolveBarClick(
  clickMs: number,
  instantsMs: readonly number[],
  options: { spanMs: number; periodStartMs?: number; periodEndMs?: number }
): BarClickResolution {
  if (!Number.isFinite(clickMs)) return { kind: "none" };
  const start = Number.isFinite(options.periodStartMs)
    ? (options.periodStartMs as number)
    : clickMs;
  const end = options.periodEndMs;
  if (end !== undefined && Number.isFinite(end) && end > start) {
    const inside = instantForColumn(start, instantsMs, end - start);
    return inside === undefined
      ? { kind: "emptyPeriod", periodStartMs: start, periodEndMs: end }
      : { kind: "instant", instantMs: inside };
  }
  const contained = instantForColumn(clickMs, instantsMs, options.spanMs);
  if (contained !== undefined) return { kind: "instant", instantMs: contained };
  let best: number | undefined;
  let bestDiff = Infinity;
  for (const t of instantsMs) {
    if (!Number.isFinite(t)) continue;
    const diff = Math.abs(t - clickMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }
  return best === undefined
    ? { kind: "none" }
    : { kind: "instant", instantMs: best };
}

/**
 * The sentence shown when a click lands on a declared period with no instant in
 * it. Every part is read from the data: the timeline driver's own name, the
 * period's own label (or its declared bounds), and the date the map is on.
 */
export function emptyPeriodNotice(args: {
  driverName?: string;
  periodLabel?: string;
  periodStartMs: number;
  periodEndMs: number;
  currentMs?: number;
}): string {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const what = args.driverName ? `“${args.driverName}” date` : "date";
  const where =
    args.periodLabel && args.periodLabel.trim()
      ? args.periodLabel.trim()
      : `${day(args.periodStartMs)} up to ${day(args.periodEndMs)}`;
  const stays =
    args.currentMs !== undefined && Number.isFinite(args.currentMs)
      ? `; the map stays on ${day(args.currentMs)}`
      : "; the map is unchanged";
  return `No ${what} in ${where}${stays}.`;
}

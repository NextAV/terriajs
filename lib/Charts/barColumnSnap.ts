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

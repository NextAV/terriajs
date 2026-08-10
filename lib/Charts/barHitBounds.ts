import type { ChartPoint } from "./ChartData";

// A hit area never extends further than this from its own bar, so clicking far from
// every bar (a wide gap in the data, or a sparse zoomed-in view) stays a no-op rather
// than teleporting the timeline to a distant observation.
export const MAX_HIT_HALF_WIDTH = 40;

/**
 * Click targets that TILE the axis: each bar owns the span up to the midpoint of the
 * gap to each neighbour (capped by MAX_HIT_HALF_WIDTH), so every x within the data
 * resolves to exactly ONE bar — the spatially nearest.
 *
 * Replaces a single fixed width for all bars, which was wrong in BOTH directions
 * because it was derived from the series' SMALLEST gap:
 *
 *  - where bars are closer together than that width (a dense series at low zoom), the
 *    targets OVERLAP, so which bar receives a click was decided by DOM paint order
 *    rather than by position — measured ~4 deep on a 229-bar daily series, i.e. a
 *    click could resolve one or two periods away from where the user aimed;
 *  - where bars are further apart than the smallest gap (the common case — a median
 *    gap of 2 days against a minimum of 1), the space between targets was DEAD and a
 *    click there did nothing at all.
 *
 * Returns one entry per input bar, index-aligned with `bars` (so the imperative zoom
 * path can keep updating rects by index). Bars whose x is non-finite get `undefined`.
 */
export function computeHitBounds(
  bars: readonly ChartPoint[],
  toPixels: (x: number | Date) => number
): ({ x: number; width: number } | undefined)[] {
  const px = bars.map((p) => toPixels(p.x));
  // Sort INDICES, not values: the result must stay aligned with `bars`, and the input
  // order is not guaranteed to be sorted by x.
  const order = px
    .map((_, i) => i)
    .filter((i) => Number.isFinite(px[i]))
    .sort((a, b) => px[a] - px[b]);
  const out: ({ x: number; width: number } | undefined)[] = bars.map(
    () => undefined
  );
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const prev = k > 0 ? px[order[k - 1]] : undefined;
    const next = k < order.length - 1 ? px[order[k + 1]] : undefined;
    // A lone bar (or the outer edge of the series) has no neighbour on that side, so
    // it borrows the other side's half-gap and falls back to the cap when it has
    // neither — never an unbounded target.
    const leftHalf =
      prev !== undefined
        ? (px[i] - prev) / 2
        : next !== undefined
          ? (next - px[i]) / 2
          : MAX_HIT_HALF_WIDTH;
    const rightHalf =
      next !== undefined
        ? (next - px[i]) / 2
        : prev !== undefined
          ? (px[i] - prev) / 2
          : MAX_HIT_HALF_WIDTH;
    const l = Math.min(leftHalf, MAX_HIT_HALF_WIDTH);
    const r = Math.min(rightHalf, MAX_HIT_HALF_WIDTH);
    out[i] = { x: px[i] - l, width: Math.max(1, l + r) };
  }
  return out;
}

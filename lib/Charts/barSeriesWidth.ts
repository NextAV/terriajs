// A bar never shrinks below this, so a deeply-nested series degrades to a hairline rather
// than disappearing entirely — the failure this whole module exists to prevent.
export const MIN_SERIES_BAR_WIDTH = 0.75;

/**
 * Width for one bar series when several share an axis at the SAME x.
 *
 * Bar series are drawn centred on their x value, so two series plotting the same category
 * land on exactly the same pixels. With equal widths the later-painted series covers the
 * earlier one COMPLETELY wherever its value is greater or equal — measured on the
 * al-Shaheen dashboard as 18 of 35 detection bars rendered invisible behind the
 * acquisitions series (identical width 1.5251px, centres 0.000px apart).
 *
 * Each series is drawn a fixed FRACTION of the band narrower than the one behind it, so:
 *  - the series painted LAST is always fully visible (it is on top and narrowest), and
 *  - the series behind it still reads as a frame around it.
 *
 * The shrink is PROPORTIONAL — `(count - index) / count` — not a fixed per-step
 * subtraction that saturates at zero. A saturating step gave every series from index 3
 * onward the same floored width, i.e. reintroduced total occlusion for 3+ series at the
 * densities this fix exists for (guardian WARN-3, with numbers: 3 series at a band ≤1.25
 * collapsed indices 1 and 2 onto 0.75px each).
 *
 * `bandWidth` MUST be shared across the series (see BarChart's `bandPoints`). Deriving it
 * per-series makes the guarantee coincidental rather than structural: the band comes from
 * a series' own tightest gap, so a sparser series gets a WIDER band, and inset it can
 * still exceed the band of the series behind it — the invariant then silently stops
 * holding on data that merely looks different (guardian WARN-2).
 *
 * Strictly decreasing whenever `bandWidth >= seriesCount * MIN_SERIES_BAR_WIDTH`; below
 * that the floor makes trailing series tie, which is the honest answer — at that density
 * the band cannot carry that many distinguishable series. It is never INVERTED: the width
 * is capped at the band, so the floor can never make a front series wider than the one
 * behind it.
 *
 * Why inset rather than dodge: a dodge moves bars off their own x, which would break the
 * selected-time marker (drawn at the category's x) and the click tiling (computed from
 * bar positions) — both of which are exact today. Insetting keeps every bar centred on
 * its true x, so neither is disturbed.
 *
 * ORDER IS SEMANTIC, and belongs to whoever composes the chart: declare the CONTEXT
 * series first (widest, behind, and the one that owns the click targets) and the PRODUCT
 * series last (narrowest, in front), so the series a reader must not miss is the one that
 * can never be covered.
 */
export function seriesBarWidth(
  bandWidth: number,
  seriesIndex: number,
  seriesCount: number
): number {
  if (!Number.isFinite(bandWidth) || bandWidth <= 0) return bandWidth;
  // A single-series chart is the overwhelmingly common case and must be byte-identical:
  // no inset, no floor, the caller's width returned unchanged.
  if (!(seriesCount > 1) || !(seriesIndex > 0)) return bandWidth;
  const steps = Math.max(0, seriesCount - seriesIndex);
  const proportional = (bandWidth * steps) / seriesCount;
  // Capped at the band so the floor can never invert the order (a floored trailing series
  // must not come out WIDER than the series behind it, which `max()` alone allows on a
  // sub-floor band).
  return Math.min(bandWidth, Math.max(MIN_SERIES_BAR_WIDTH, proportional));
}

// Each co-located series after the first is drawn this much narrower than the one behind
// it, so the series behind stays visible as a frame around it.
export const SERIES_INSET_FRACTION = 0.4;
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
 * Insetting by series index makes the front series strictly narrower, so:
 *  - the series painted LAST is always fully visible (it is on top and narrower), and
 *  - the series behind it still reads as a frame around it.
 *
 * Why inset rather than dodge: a dodge moves bars off their own x, which would break the
 * selected-time marker (drawn at the category's x) and the click tiling (computed from
 * bar positions) — both of which are exact today. Insetting keeps every bar centred on
 * its true x, so neither is disturbed.
 *
 * ORDER IS SEMANTIC, and belongs to whoever composes the chart: declare the CONTEXT
 * series first (widest, behind) and the PRODUCT series last (narrowest, in front), so the
 * series a reader must not miss is the one that can never be covered.
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
  const shrink = Math.max(0, 1 - seriesIndex * SERIES_INSET_FRACTION);
  return Math.max(MIN_SERIES_BAR_WIDTH, bandWidth * shrink);
}

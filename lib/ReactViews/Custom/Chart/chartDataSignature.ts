import { ChartItem } from "../../../ModelMixins/ChartableMixin";

/**
 * A stable signature of WHAT a chart plots — the series present, the x-scale
 * type, how many points each series has, and the x-extent each covers.
 *
 * Why this exists: a chart's zoom is a user gesture and must survive any
 * re-render that does not change the plotted data. `BottomDockChart` used to
 * reset the zoom whenever its `chartItems` ARRAY IDENTITY changed, but that
 * array is freshly allocated on every parent render (`ChartPanel` builds it
 * with `.filter(...)`), and `ChartPanel` is a mobx `observer` that reads the
 * timeline clock — so every scrub, including the one caused by clicking a bar,
 * silently cleared the zoom and reset the published x-domain that scrubbers
 * align to.
 *
 * Comparing this signature instead means:
 *  - re-render with identical data  → same signature → zoom preserved
 *  - series added/removed, span or point count changed → new signature → the
 *    zoom resets, which is correct (the old window may not exist any more)
 *
 * NOTE this signature is only PART of the reset key in `BottomDockChart`; the
 * plot geometry (`plotWidth`) is the other part, because a zoomed d3 scale
 * carries a pixel range built at the old width. Do not read the reset
 * behaviour off this function alone — in particular, `plotWidth` is derived
 * from the estimated y-axis label width, which depends on the y VALUES, so a
 * y-only refresh can still legitimately reset the zoom. The guarantee this
 * function provides is one-directional: an unchanged signature means the
 * x-window is still meaningful, not that no reset can occur.
 *
 * Order matters and is deliberate: a reordered series list is a different
 * rendering, so it produces a different signature.
 *
 * Known and accepted blind spot: points redistributing WITHIN an unchanged
 * x-extent, at an unchanged count, produce the same signature. That is benign
 * for this signature's only job — a zoom is a date RANGE, and that range is
 * still valid — but it means this must not be reused as a general
 * "has the data changed?" test.
 *
 * Encoding: `JSON.stringify` of a tuple array, NOT a delimiter-joined string.
 * `ChartItem.key` embeds a backend-controlled `name`, so a member named
 * `Flow | rate` would otherwise inject a field delimiter and could, with an
 * adversarial second arrangement, collide two different chart states into one
 * signature (consequence: a zoom that fails to reset when it should).
 */
export function chartDataSignature(items: ReadonlyArray<ChartItem>): string {
  return JSON.stringify(
    items.map((c) => {
      // `domain` is non-optional on ChartItem; the optional chain is
      // defence-in-depth for a hand-built item, not a reachable branch.
      const domainX = c.domain?.x;
      return [
        c.key,
        // A time↔linear scale flip must invalidate a zoomed scale. Reaching it
        // requires the first selected item to change (ChartView force-hides
        // items whose axis disagrees), which already changes `key` — this
        // makes the guarantee independent of that reasoning.
        c.xAxis?.scale,
        c.points.length,
        Number(domainX?.[0]),
        Number(domainX?.[1])
      ];
    })
  );
}

export default chartDataSignature;

import { ChartItem } from "../../../ModelMixins/ChartableMixin";

/**
 * A stable signature of WHAT a chart plots — the series present, how many
 * points each has, and the x-extent each covers.
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
 *  - values changing under an unchanged extent → same signature → zoom kept;
 *    the x-window is still valid, so there is no reason to disturb the user.
 *
 * Order matters and is deliberate: a reordered series list is a different
 * rendering, so it produces a different signature.
 *
 * Known and accepted blind spot: points redistributing WITHIN an unchanged
 * x-extent, at an unchanged count, produce the same signature. That is benign
 * for this signature's only job — a zoom is a date RANGE, and that range is
 * still valid — but it means this must not be reused as a general
 * "has the data changed?" test.
 */
export function chartDataSignature(items: ReadonlyArray<ChartItem>): string {
  return items
    .map((c) => {
      const domainX = c.domain?.x as [unknown, unknown] | undefined;
      return `${c.key}|${c.points.length}|${Number(
        domainX?.[0] as never
      )}|${Number(domainX?.[1] as never)}`;
    })
    .join("~");
}

export default chartDataSignature;

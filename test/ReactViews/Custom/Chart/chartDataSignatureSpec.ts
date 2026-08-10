import { ChartItem } from "../../../../lib/ModelMixins/ChartableMixin";
import { chartDataSignature } from "../../../../lib/ReactViews/Custom/Chart/chartDataSignature";

/**
 * Locks the contract that keeps a chart's zoom alive across re-renders.
 *
 * The regression this guards: `BottomDockChart`'s zoom-reset effect used to be
 * keyed on the chart-items ARRAY IDENTITY, which is reallocated on every parent
 * render — so a timeline scrub (or the click on a bar that causes one) zoomed
 * the chart back out and reset the x-domain that scrubbers align to.
 */
function item(
  key: string,
  pointCount: number,
  x0: number,
  x1: number
): ChartItem {
  const points = Array.from({ length: pointCount }, (_, i) => ({
    x: new Date(x0 + i),
    y: i
  }));
  return {
    id: key,
    name: key,
    key,
    item: {} as any,
    type: "line",
    showInChartPanel: true,
    isSelectedInWorkbench: true,
    xAxis: { scale: "time" },
    points,
    domain: { x: [new Date(x0), new Date(x1)], y: [0, 1] },
    getColor: () => "#fff",
    updateIsSelectedInWorkbench: () => {}
  } as unknown as ChartItem;
}

describe("chartDataSignature", function () {
  const a = item("acquisitions", 229, 1_700_000_000_000, 1_780_000_000_000);
  const b = item("detections", 35, 1_700_000_000_000, 1_780_000_000_000);

  it("is stable across a re-render that reallocates the array", function () {
    // THE regression: `.filter(...)` in ChartPanel returns a new array with the
    // same contents on every render. Identity differs; the signature must not.
    const render1 = [a, b];
    const render2 = [a, b].filter(() => true);
    expect(render1).not.toBe(render2);
    expect(chartDataSignature(render1)).toBe(chartDataSignature(render2));
  });

  it("is stable when point VALUES change but the extent and count do not", function () {
    // A zoom window over an unchanged x-extent is still valid, so a value-only
    // refresh must not disturb the user's view.
    const bSameShape = item(
      "detections",
      35,
      1_700_000_000_000,
      1_780_000_000_000
    );
    bSameShape.points.forEach((p, i) => {
      (p as any).y = i * 7;
    });
    expect(chartDataSignature([a, b])).toBe(
      chartDataSignature([a, bSameShape])
    );
  });

  it("changes when a series is added", function () {
    expect(chartDataSignature([b])).not.toBe(chartDataSignature([a, b]));
  });

  it("changes when a series is removed", function () {
    expect(chartDataSignature([a, b])).not.toBe(chartDataSignature([a]));
  });

  it("changes when the x-extent changes", function () {
    const widened = item(
      "detections",
      35,
      1_700_000_000_000,
      1_790_000_000_000
    );
    expect(chartDataSignature([a, b])).not.toBe(
      chartDataSignature([a, widened])
    );
  });

  it("changes when the point count changes", function () {
    const denser = item("detections", 36, 1_700_000_000_000, 1_780_000_000_000);
    expect(chartDataSignature([a, b])).not.toBe(
      chartDataSignature([a, denser])
    );
  });

  it("changes when the series order changes", function () {
    expect(chartDataSignature([a, b])).not.toBe(chartDataSignature([b, a]));
  });

  it("changes when the x-scale type flips time <-> linear", function () {
    // A zoomed `scaleTime` is meaningless over linear data. Reaching this needs
    // the first selected item to change (ChartView force-hides items whose axis
    // disagrees), which already changes `key` — asserted so the guarantee does
    // not depend on that reasoning holding.
    const linear = item("detections", 35, 1_700_000_000_000, 1_780_000_000_000);
    (linear as any).xAxis = { scale: "linear" };
    expect(chartDataSignature([a, b])).not.toBe(
      chartDataSignature([a, linear])
    );
  });

  it("cannot collide when a series name contains a field delimiter", function () {
    // `ChartItem.key` embeds a backend-controlled `name`, so a member named
    // "Flow | rate" would inject a delimiter into a naively joined signature.
    // Encoding as JSON removes the class; a collision here would mean a zoom
    // that fails to reset when the chart genuinely changed.
    const joined = [item("Flow | rate", 1, 0, 1)];
    const split = [item("Flow", 1, 0, 1), item("rate", 1, 0, 1)];
    expect(chartDataSignature(joined)).not.toBe(chartDataSignature(split));
  });

  it("does not throw on an empty list or a missing domain", function () {
    expect(chartDataSignature([])).toBe("[]");
    const noDomain = item("x", 1, 0, 1);
    delete (noDomain as any).domain;
    expect(() => chartDataSignature([noDomain])).not.toThrow();
  });
});

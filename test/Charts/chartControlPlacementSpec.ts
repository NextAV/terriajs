import {
  controlStackLeft,
  controlStackOverlapsPlot
} from "../../lib/Charts/chartControlPlacement";

// The shipped defaults: DEFAULT_MARGIN.right and CONTROL_SIZE in
// BottomDockChart. If either moves, these must be re-derived there.
const MARGIN_RIGHT = 30;
const CONTROL = 30;

// A chart the size of the al-shaheen bottom dock. `width` is DERIVED from the
// same identity the component relies on -- `plotLeft + plotWidth === width -
// marginRight` -- rather than hardcoded, so the assertions below still mean
// "flush with the chart's right edge" if any of these numbers change.
const PLOT_LEFT = 40;
const PLOT_WIDTH = 1390;
const widthFor = (marginRight: number) => PLOT_LEFT + PLOT_WIDTH + marginRight;
const geom = (marginRight: number, controlSize = CONTROL) => ({
  plotLeft: PLOT_LEFT,
  plotWidth: PLOT_WIDTH,
  marginRight,
  controlSize
});

describe("chartControlPlacement", function () {
  describe("controlStackLeft", function () {
    it("puts the stack in the right margin, clear of the plot band", function () {
      // The band ends at 1430; the stack starts exactly there.
      expect(controlStackLeft(geom(MARGIN_RIGHT))).toBe(PLOT_LEFT + PLOT_WIDTH);
    });

    it("lands flush with the chart's right edge, not merely inside it", function () {
      const left = controlStackLeft(geom(MARGIN_RIGHT));
      expect(left + CONTROL).toBe(widthFor(MARGIN_RIGHT));
    });

    it("stays flush when the margin is wider than the stack", function () {
      // Surplus margin becomes an inboard gap, not an overhang.
      const left = controlStackLeft(geom(50));
      expect(left).toBe(PLOT_LEFT + PLOT_WIDTH + 20);
      expect(left + CONTROL).toBe(widthFor(50));
    });

    it("is independent of the y-axis label width", function () {
      // `estimatedYAxesWidth` shifts plotLeft right and shrinks plotWidth by
      // the same amount, so the result must not move. This is the identity the
      // component's `adjustedMargin` spread guarantees.
      const wide = controlStackLeft({
        plotLeft: PLOT_LEFT + 120,
        plotWidth: PLOT_WIDTH - 120,
        marginRight: MARGIN_RIGHT,
        controlSize: CONTROL
      });
      expect(wide).toBe(controlStackLeft(geom(MARGIN_RIGHT)));
    });

    it("falls back INSIDE the band when the margin cannot hold the stack", function () {
      // Nothing outside the band would fit, so the historical inboard
      // placement is the only option; it must not be pushed off the chart.
      expect(controlStackLeft(geom(10))).toBe(
        PLOT_LEFT + PLOT_WIDTH - CONTROL - 4
      );
    });

    it("falls back rather than returning NaN on a non-finite margin", function () {
      // `margin` is a consumer-supplied prop; a broken one must not place the
      // stack at NaN px, which renders it at the container's origin.
      const inboard = PLOT_LEFT + PLOT_WIDTH - CONTROL - 4;
      expect(controlStackLeft(geom(NaN))).toBe(inboard);
      expect(controlStackLeft(geom(Infinity))).toBe(inboard);
    });
  });

  describe("controlStackOverlapsPlot", function () {
    it("does not overlap the plot band at the shipped defaults", function () {
      // This is the whole point of the change: the stack leaves the data area.
      expect(controlStackOverlapsPlot(geom(MARGIN_RIGHT))).toBe(false);
    });

    it("reports the overlap honestly in the narrow-margin fallback", function () {
      expect(controlStackOverlapsPlot(geom(10))).toBe(true);
    });

    it("does not overlap when the margin is wider than the stack", function () {
      expect(controlStackOverlapsPlot(geom(50))).toBe(false);
    });
  });
});

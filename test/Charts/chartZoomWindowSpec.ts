import {
  defaultTimeWindow,
  latestPointMs,
  transformForDomain
} from "../../lib/Charts/chartZoomWindow";

const DAY = 24 * 60 * 60 * 1000;
const ms = (iso: string) => Date.parse(iso);

describe("chartZoomWindow", function () {
  describe("latestPointMs", function () {
    it("finds the latest x across several series, Date or number", function () {
      expect(
        latestPointMs([
          { points: [{ x: new Date("2026-06-23T14:41:49Z") }] },
          { points: [{ x: ms("2026-07-03T02:30:40Z") }, { x: ms("2025-01-02T00:00:00Z") }] }
        ])
      ).toBe(ms("2026-07-03T02:30:40Z"));
    });

    it("skips non-finite x rather than returning it", function () {
      expect(
        latestPointMs([{ points: [{ x: NaN }, { x: ms("2026-01-01T00:00:00Z") }] }])
      ).toBe(ms("2026-01-01T00:00:00Z"));
    });

    it("returns undefined when nothing is plottable", function () {
      expect(latestPointMs([])).toBeUndefined();
      expect(latestPointMs([{ points: [] }])).toBeUndefined();
      expect(latestPointMs([{ points: [{ x: NaN }] }])).toBeUndefined();
    });
  });

  describe("defaultTimeWindow", function () {
    it("anchors at the LAST OBSERVATION, never the wall clock", function () {
      const last = ms("2026-07-03T02:30:40Z");
      const w = defaultTimeWindow(last, 90)!;
      // End = last + 1 day of pad; start = end − 90 days. Nothing here reads
      // Date.now() — a stale archive must open on its data, not on whitespace.
      expect(w[1]).toBe(last + DAY);
      expect(w[0]).toBe(last + DAY - 90 * DAY);
    });

    it("is undefined for a non-positive or missing day count", function () {
      expect(defaultTimeWindow(ms("2026-01-01T00:00:00Z"), 0)).toBeUndefined();
      expect(defaultTimeWindow(ms("2026-01-01T00:00:00Z"), -5)).toBeUndefined();
      expect(defaultTimeWindow(ms("2026-01-01T00:00:00Z"), undefined)).toBeUndefined();
      expect(defaultTimeWindow(ms("2026-01-01T00:00:00Z"), NaN)).toBeUndefined();
    });

    it("is undefined when there is no data to anchor on", function () {
      expect(defaultTimeWindow(undefined, 90)).toBeUndefined();
      expect(defaultTimeWindow(NaN, 90)).toBeUndefined();
    });
  });

  describe("transformForDomain", function () {
    it("maps the domain's pixel ends exactly onto [0, plotWidth]", function () {
      // Window occupying [1000, 1200] px of the un-zoomed scale, plot 1390 px.
      const t = transformForDomain(1000, 1200, 1390)!;
      // d3 applies x' = k·x + tx:
      expect(t.k * 1000 + t.x).toBeCloseTo(0, 6);
      expect(t.k * 1200 + t.x).toBeCloseTo(1390, 6);
    });

    it("returns k < 1 for a window WIDER than the plot's domain, leaving the clamp to d3's constrain", function () {
      // The caller passes this through zoom.constrain() with scaleExtent
      // [1, ∞) — deliberately ONE constraint implementation, not two.
      const t = transformForDomain(-200, 1590, 1390)!;
      expect(t.k).toBeLessThan(1);
      expect(t.k).toBeGreaterThan(0);
    });

    it("refuses degenerate input instead of handing d3 an Infinity", function () {
      expect(transformForDomain(100, 100, 1390)).toBeUndefined(); // zero span
      expect(transformForDomain(200, 100, 1390)).toBeUndefined(); // negative span
      expect(transformForDomain(NaN, 100, 1390)).toBeUndefined();
      expect(transformForDomain(0, 100, 0)).toBeUndefined(); // unmeasured plot
      expect(transformForDomain(0, 100, -5)).toBeUndefined();
    });
  });
});

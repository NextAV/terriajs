import {
  defaultTimeWindow,
  latestPointMs,
  panTargetIsReachable,
  stalenessDays,
  transformForDomain,
  zoomActionForDomain
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

    it("returns k < 1 for a window WIDER than the data — the CALLER must clamp it", function () {
      // REGRESSION LOCK. This function deliberately does not clamp, but the
      // reason matters: d3's `constrain` does NOT clamp k either (it only
      // translates; the k clamp is in scaleTo/scaleBy/wheeled, which
      // `zoom.transform` does not use). Verified against real d3 — a 90-day
      // window on a 30-day archive keeps k = 0.3333 through `constrain` and
      // renders the chart under-zoomed with blank margins past the last
      // observation. So `ZoomX.zoomToDomain` clamps explicitly against
      // `scaleExtent[0]`; if that clamp is ever removed, this shape is what
      // reaches d3.
      const t = transformForDomain(-200, 1590, 1390)!;
      expect(t.k).toBeLessThan(1);
      expect(t.k).toBeGreaterThan(0);
    });

    it("a window exactly the width of the data gives k === 1 (the clamp boundary)", function () {
      // The caller clamps on `k <= scaleExtent[0]`, so this is the exact input
      // that must resolve to identity rather than a 1.0000000002 near-miss.
      const t = transformForDomain(0, 1390, 1390)!;
      expect(t.k).toBe(1);
      expect(t.x).toBe(-0);
    });

    it("refuses degenerate input instead of handing d3 an Infinity", function () {
      expect(transformForDomain(100, 100, 1390)).toBeUndefined(); // zero span
      expect(transformForDomain(200, 100, 1390)).toBeUndefined(); // negative span
      expect(transformForDomain(NaN, 100, 1390)).toBeUndefined();
      expect(transformForDomain(0, 100, 0)).toBeUndefined(); // unmeasured plot
      expect(transformForDomain(0, 100, -5)).toBeUndefined();
    });
  });

  // The two decisions a review proved the component was getting wrong. They
  // live here, not in the component, precisely so these assertions can reach
  // them — the earlier pure-math-only suite could not, which is why the
  // defects shipped past it.
  describe("zoomActionForDomain", function () {
    const MIN = 1; // scaleExtent[0]

    it("clamps a window WIDER than the data to identity, never k < 1", function () {
      // Real numbers from the review: a 90-day window on a 30-day archive.
      // d3's own constrain does NOT do this (verified: k stays 0.3333), so
      // the chart would render under-zoomed with blank margins past the last
      // observation.
      const a = zoomActionForDomain(-2000, 3000, 1000, MIN);
      expect(a.kind).toBe("identity");
    });

    it("treats a window exactly the data's width as identity, not a 1.0 transform", function () {
      expect(zoomActionForDomain(0, 1390, 1390, MIN).kind).toBe("identity");
    });

    it("returns a real transform for a genuine zoom-in", function () {
      const a = zoomActionForDomain(1000, 1200, 1390, MIN) as {
        kind: string;
        k: number;
        x: number;
      };
      expect(a.kind).toBe("transform");
      expect(a.k * 1000 + a.x).toBeCloseTo(0, 6);
      expect(a.k * 1200 + a.x).toBeCloseTo(1390, 6);
    });

    it("is a no-op on degenerate input rather than a degenerate transform", function () {
      expect(zoomActionForDomain(100, 100, 1390, MIN).kind).toBe("noop");
      expect(zoomActionForDomain(0, 100, 0, MIN).kind).toBe("noop");
      expect(zoomActionForDomain(NaN, 100, 1390, MIN).kind).toBe("noop");
    });
  });

  describe("panTargetIsReachable", function () {
    it("refuses a target outside the pannable box", function () {
      // The loop guard. d3's translateTo is constrained, so an out-of-box
      // target cannot be reached — but d3 still EMITS, and a consumer that
      // rebuilds a scale per emit would re-run forever. Real trigger: a
      // timeline driver carrying more instants than the chart has bars.
      expect(panTargetIsReachable(-86.8, 0, 1000)).toBe(false);
      expect(panTargetIsReachable(1200, 0, 1000)).toBe(false);
    });

    it("accepts an in-box target, boundaries included", function () {
      expect(panTargetIsReachable(500, 0, 1000)).toBe(true);
      expect(panTargetIsReachable(0, 0, 1000)).toBe(true);
      expect(panTargetIsReachable(1000, 0, 1000)).toBe(true);
    });

    it("refuses a non-finite target even when the box is UNBOUNDED", function () {
      // The unbounded case is what makes the explicit isFinite guard
      // load-bearing, and a mutation test is what showed it: against FINITE
      // bounds the comparisons already reject NaN and ±Infinity on their own,
      // so an assertion using only those passed with the guard deleted. ZoomX
      // passes ±Infinity whenever `extent` is absent, and there
      // `Infinity <= Infinity` is TRUE — so without the guard a NaN/Infinity
      // target would be "reachable" and get panned to.
      expect(panTargetIsReachable(Infinity, -Infinity, Infinity)).toBe(false);
      expect(panTargetIsReachable(NaN, -Infinity, Infinity)).toBe(false);
      expect(panTargetIsReachable(NaN, 0, 1000)).toBe(false);
      expect(panTargetIsReachable(Infinity, 0, 1000)).toBe(false);
    });
  });

  describe("stalenessDays", function () {
    const last = ms("2026-07-03T00:00:00Z");
    const now = ms("2026-08-11T00:00:00Z");

    it("reports the gap the caption states", function () {
      // The number in "last pass: 2026-07-03 (39 days ago)".
      expect(stalenessDays(last, now)).toBe(39);
    });

    it("is SILENT on a current feed, so a healthy dashboard gains no noise", function () {
      expect(stalenessDays(now, now)).toBeUndefined();
      expect(stalenessDays(now - DAY, now)).toBeUndefined(); // 1 day < minDays 2
    });

    it("floors rather than rounds, so the caption never overstates the gap", function () {
      // 39 days and 23 hours is still "39 days ago", never "40".
      expect(stalenessDays(last, now + 23 * 60 * 60 * 1000)).toBe(39);
    });

    it("returns undefined with no data or an unusable clock", function () {
      expect(stalenessDays(undefined, now)).toBeUndefined();
      expect(stalenessDays(NaN, now)).toBeUndefined();
      expect(stalenessDays(last, NaN)).toBeUndefined();
    });

    it("does not read the clock itself — `nowMs` is injected", function () {
      // A function that read Date.now() internally could not be asserted
      // against a fixed date at all; this test only exists because it does not.
      expect(stalenessDays(last, ms("2026-07-10T00:00:00Z"))).toBe(7);
      expect(stalenessDays(last, ms("2027-07-03T00:00:00Z"))).toBe(365);
    });
  });
});

import {
  MIN_SERIES_BAR_WIDTH,
  seriesBarWidth
} from "../../lib/Charts/barSeriesWidth";

describe("seriesBarWidth", function () {
  it("is byte-identical for a single bar series", function () {
    // The overwhelmingly common case: every chart that isn't al-Shaheen's.
    [0.5, 1.5251, 6, 48].forEach((w) => {
      expect(seriesBarWidth(w, 0, 1)).toBe(w);
    });
  });

  it("leaves the first (backmost) series at full band width", function () {
    expect(seriesBarWidth(10, 0, 3)).toBe(10);
  });

  it("makes each successive series strictly narrower than the one behind it", function () {
    const widths = [0, 1, 2].map((i) => seriesBarWidth(20, i, 3));
    expect(widths[1]).toBeLessThan(widths[0]);
    expect(widths[2]).toBeLessThan(widths[1]);
  });

  it("REGRESSION: co-located series must not share a width — that is total occlusion", function () {
    // The measured defect: on the live al-Shaheen chart both series rendered at
    // 1.5251px on identical centres, so the later-painted one covered the earlier
    // one COMPLETELY on 18 of 35 dates. Equal widths are the defect itself.
    const band = 1.5250783699059012;
    expect(seriesBarWidth(band, 1, 2)).not.toBe(seriesBarWidth(band, 0, 2));
    expect(seriesBarWidth(band, 1, 2)).toBeLessThan(band);
  });

  it("never shrinks a series to nothing, however many share the axis", function () {
    for (let n = 2; n <= 8; n++) {
      for (let i = 0; i < n; i++) {
        expect(seriesBarWidth(4, i, n)).toBeGreaterThanOrEqual(
          MIN_SERIES_BAR_WIDTH
        );
      }
    }
  });

  it("REGRESSION: is STRICTLY decreasing while the band can carry the series", function () {
    // A floor alone is not enough and passing it is not evidence of anything: a
    // per-step shrink that saturates at zero gave every series from index 3 on the
    // SAME floored width, i.e. total occlusion again — and the old "never shrinks to
    // nothing" loop passed the whole time (guardian WARN-3). Assert the property that
    // actually matters, over the whole regime where it is achievable.
    for (let n = 2; n <= 8; n++) {
      const band = n * MIN_SERIES_BAR_WIDTH * 4;
      const widths = Array.from({ length: n }, (_, i) =>
        seriesBarWidth(band, i, n)
      );
      widths.slice(1).forEach((w, k) => {
        expect(w).toBeLessThan(widths[k]);
      });
    }
  });

  it("never INVERTS: a floored series is never wider than the one behind it", function () {
    // Below the floor the widths may TIE (the band cannot carry them), but the front
    // series must never come out wider — which `max(MIN, ...)` alone allows.
    [0.1, 0.5, 0.75, 1, 1.5250783699].forEach((band) => {
      for (let n = 2; n <= 5; n++) {
        const widths = Array.from({ length: n }, (_, i) =>
          seriesBarWidth(band, i, n)
        );
        widths.slice(1).forEach((w, k) => {
          expect(w <= widths[k]).toBe(true);
        });
      }
    });
  });

  it("insets proportionally to the band, so the shrink cannot saturate", function () {
    expect(seriesBarWidth(100, 1, 2)).toBe(50);
    expect(seriesBarWidth(100, 1, 4)).toBe(75);
    expect(seriesBarWidth(100, 3, 4)).toBe(25);
  });

  it("passes a degenerate band through untouched rather than inventing a width", function () {
    expect(seriesBarWidth(0, 1, 2)).toBe(0);
    expect(seriesBarWidth(-3, 1, 2)).toBe(-3);
    expect(Number.isNaN(seriesBarWidth(NaN, 1, 2))).toBe(true);
  });
});

import {
  MIN_SERIES_BAR_WIDTH,
  SERIES_INSET_FRACTION,
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

  it("insets by the declared fraction of the band", function () {
    expect(seriesBarWidth(100, 1, 2)).toBe(100 * (1 - SERIES_INSET_FRACTION));
  });

  it("passes a degenerate band through untouched rather than inventing a width", function () {
    expect(seriesBarWidth(0, 1, 2)).toBe(0);
    expect(seriesBarWidth(-3, 1, 2)).toBe(-3);
    expect(Number.isNaN(seriesBarWidth(NaN, 1, 2))).toBe(true);
  });
});

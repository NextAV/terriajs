import {
  DEFAULT_COLUMN_SPAN_MS,
  columnForInstant,
  columnSpanMs,
  emptyPeriodNotice,
  instantForColumn,
  resolveBarClick
} from "../../lib/Charts/barColumnSnap";

const DAY = DEFAULT_COLUMN_SPAN_MS;
const ms = (iso: string) => Date.parse(iso);

// A daily bar chart: x values are ISO date-only strings, which Date.parse maps
// to UTC midnight — the START of each period.
const bar = (d: string) => ms(`${d}T00:00:00Z`);

describe("barColumnSnap", function () {
  describe("columnSpanMs", function () {
    it("measures the smallest positive gap", function () {
      expect(
        columnSpanMs([bar("2026-05-07"), bar("2026-05-08"), bar("2026-05-12")])
      ).toBe(DAY);
    });

    it("ignores coincident points rather than returning a zero span", function () {
      expect(
        columnSpanMs([bar("2026-05-07"), bar("2026-05-07"), bar("2026-05-09")])
      ).toBe(2 * DAY);
    });

    it("falls back to one day when there is no measurable gap", function () {
      expect(columnSpanMs([])).toBe(DAY);
      expect(columnSpanMs([bar("2026-05-07")])).toBe(DAY);
      expect(columnSpanMs([NaN, Infinity])).toBe(DAY);
    });
  });

  describe("instantForColumn", function () {
    // The regression this module exists for: an afternoon observation is
    // NEARER to the following day's midnight bar than to its own.
    const instants = [
      ms("2026-05-07T14:32:37Z"),
      ms("2026-05-08T14:32:47Z"),
      ms("2026-05-09T02:31:48Z")
    ];

    it("selects the instant INSIDE the clicked period, not the nearest one", function () {
      const clicked = bar("2026-05-08");
      const nearest = instants.reduce((a, t) =>
        Math.abs(t - clicked) < Math.abs(a - clicked) ? t : a
      );
      // Guard the premise: nearest really is the previous day here, so this
      // test would pass trivially if the premise ever stopped holding.
      expect(nearest).toBe(ms("2026-05-07T14:32:37Z"));
      expect(instantForColumn(clicked, instants, DAY)).toBe(
        ms("2026-05-08T14:32:47Z")
      );
    });

    it("works for a morning observation too", function () {
      expect(instantForColumn(bar("2026-05-09"), instants, DAY)).toBe(
        ms("2026-05-09T02:31:48Z")
      );
    });

    it("returns the EARLIEST instant when a period holds two", function () {
      const twice = [ms("2026-05-13T02:30:00Z"), ms("2026-05-13T14:40:00Z")];
      expect(instantForColumn(bar("2026-05-13"), twice, DAY)).toBe(
        ms("2026-05-13T02:30:00Z")
      );
    });

    it("is half-open: an instant exactly on the next boundary is excluded", function () {
      expect(
        instantForColumn(bar("2026-05-08"), [bar("2026-05-09")], DAY)
      ).toBeUndefined();
      expect(
        instantForColumn(bar("2026-05-08"), [bar("2026-05-08")], DAY)
      ).toBe(bar("2026-05-08"));
    });

    it("returns undefined when the period holds no instant (caller falls back)", function () {
      expect(
        instantForColumn(bar("2026-05-11"), instants, DAY)
      ).toBeUndefined();
    });

    it("rejects non-finite input rather than matching arbitrarily", function () {
      expect(instantForColumn(NaN, instants, DAY)).toBeUndefined();
      expect(instantForColumn(bar("2026-05-08"), [NaN], DAY)).toBeUndefined();
      expect(instantForColumn(bar("2026-05-08"), instants, 0)).toBeUndefined();
    });
  });

  describe("columnForInstant", function () {
    const bars = [bar("2026-05-07"), bar("2026-05-08"), bar("2026-05-09")];

    it("maps an afternoon instant back to its OWN bar, not the next one", function () {
      expect(columnForInstant(ms("2026-05-08T14:32:47Z"), bars, DAY)).toBe(
        bar("2026-05-08")
      );
    });

    it("returns undefined outside every column", function () {
      expect(
        columnForInstant(ms("2026-06-01T00:00:00Z"), bars, DAY)
      ).toBeUndefined();
    });
  });

  describe("round trip", function () {
    // The property that makes a bar click and the selected-time marker agree
    // by construction: whatever instant a column yields must map back to it.
    it("column -> instant -> column is the identity for every bar", function () {
      const bars = [
        bar("2026-05-07"),
        bar("2026-05-08"),
        bar("2026-05-09"),
        bar("2026-05-12")
      ];
      const instants = [
        ms("2026-05-07T14:32:37Z"),
        ms("2026-05-08T14:32:47Z"),
        ms("2026-05-09T02:31:48Z"),
        ms("2026-05-12T14:40:49Z")
      ];
      const span = columnSpanMs(bars);
      bars.forEach((b) => {
        const inst = instantForColumn(b, instants, span);
        expect(inst).toBeDefined();
        expect(columnForInstant(inst!, bars, span)).toBe(b);
      });
    });
  });

  describe("resolveBarClick", function () {
    // Two 1 m frames, Doha-style: one in early June, one in mid-September.
    const frames = [ms("2026-06-03T07:22:00Z"), ms("2026-09-15T07:22:00Z")];

    describe("an UNDECLARED period keeps the old behaviour", function () {
      it("returns the instant contained in the inferred column", function () {
        expect(
          resolveBarClick(bar("2026-06-03"), frames, { spanMs: DAY })
        ).toEqual({ kind: "instant", instantMs: frames[0] });
      });

      it("falls back to the NEAREST instant when the column holds none", function () {
        // July: nothing inside, nearest is June's frame (~4 weeks away).
        expect(
          resolveBarClick(bar("2026-07-01"), frames, { spanMs: DAY })
        ).toEqual({ kind: "instant", instantMs: frames[0] });
      });

      it("returns none when there are no instants at all", function () {
        expect(resolveBarClick(bar("2026-07-01"), [], { spanMs: DAY })).toEqual(
          { kind: "none" }
        );
      });
    });

    describe("a DECLARED period never jumps outside itself", function () {
      it("returns the instant inside the declared period", function () {
        // Bar drawn at the period's MIDDLE; the period is 1-15 June.
        expect(
          resolveBarClick(ms("2026-06-08T12:00:00Z"), frames, {
            spanMs: 15 * DAY,
            periodStartMs: bar("2026-06-01"),
            periodEndMs: bar("2026-06-16")
          })
        ).toEqual({ kind: "instant", instantMs: frames[0] });
      });

      it("reports an EMPTY period instead of the nearest instant (the input the rule exists to refuse)", function () {
        // 1-15 July holds no frame; the nearest (3 June) is 28 days before.
        expect(
          resolveBarClick(ms("2026-07-08T12:00:00Z"), frames, {
            spanMs: 15 * DAY,
            periodStartMs: bar("2026-07-01"),
            periodEndMs: bar("2026-07-16")
          })
        ).toEqual({
          kind: "emptyPeriod",
          periodStartMs: bar("2026-07-01"),
          periodEndMs: bar("2026-07-16")
        });
      });

      it("contains a 16-day half-month exactly, which the smallest-gap span cannot", function () {
        // A frame on 31 Jan, period 16-31 Jan (16 days). The smallest gap over a
        // year of half-months is 13 days (16 Feb -> 1 Mar), so an INFERRED span
        // stops at 29 Jan, misses it, and falls back to the nearest instant —
        // here a frame on 10 Jan, in the PREVIOUS half-month.
        const earlyJan = ms("2026-01-10T07:22:00Z");
        const lateJan = ms("2026-01-31T07:22:00Z");
        expect(
          resolveBarClick(bar("2026-01-16"), [earlyJan, lateJan], {
            spanMs: 13 * DAY
          })
        ).toEqual({ kind: "instant", instantMs: earlyJan });
        expect(
          resolveBarClick(bar("2026-01-16"), [earlyJan, lateJan], {
            spanMs: 13 * DAY,
            periodEndMs: bar("2026-02-01")
          })
        ).toEqual({ kind: "instant", instantMs: lateJan });
      });

      it("excludes an instant at the period's END (the end is exclusive)", function () {
        expect(
          resolveBarClick(bar("2026-06-01"), [bar("2026-06-16")], {
            spanMs: 15 * DAY,
            periodEndMs: bar("2026-06-16")
          }).kind
        ).toBe("emptyPeriod");
      });

      it("treats a malformed period (end <= start) as undeclared", function () {
        expect(
          resolveBarClick(bar("2026-07-01"), frames, {
            spanMs: DAY,
            periodStartMs: bar("2026-07-16"),
            periodEndMs: bar("2026-07-01")
          })
        ).toEqual({ kind: "instant", instantMs: frames[0] });
      });
    });
  });

  describe("emptyPeriodNotice", function () {
    it("names the driver, the period label and the date the map stays on", function () {
      expect(
        emptyPeriodNotice({
          driverName: "True colour (1 m)",
          periodLabel: "1\u201315 Jul 2026",
          periodStartMs: bar("2026-07-01"),
          periodEndMs: bar("2026-07-16"),
          currentMs: ms("2026-06-03T07:22:00Z")
        })
      ).toBe(
        "No \u201cTrue colour (1 m)\u201d date in 1\u201315 Jul 2026; the map stays on 2026-06-03."
      );
    });

    it("falls back to the declared bounds and an unnamed driver", function () {
      expect(
        emptyPeriodNotice({
          periodStartMs: bar("2026-07-01"),
          periodEndMs: bar("2026-07-16")
        })
      ).toBe("No date in 2026-07-01 up to 2026-07-16; the map is unchanged.");
    });
  });
});

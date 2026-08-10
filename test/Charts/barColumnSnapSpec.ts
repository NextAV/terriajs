import {
  DEFAULT_COLUMN_SPAN_MS,
  columnForInstant,
  columnSpanMs,
  instantForColumn
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
      expect(instantForColumn(bar("2026-05-08"), [bar("2026-05-08")], DAY)).toBe(
        bar("2026-05-08")
      );
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
});

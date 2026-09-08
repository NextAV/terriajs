import {
  collapseToObservations,
  formatObservationInstant,
  inferRepeatMs,
  nextExpectedObservationMs,
  observationCaption,
  relativeInstantPhrase
} from "../../lib/Charts/observationCadence";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ms = (iso: string) => Date.parse(iso);

/**
 * The real al-Shaheen geometry: three Sentinel-1 tracks over one AOI, each on
 * a 6-day repeat, offset so the gaps run ~24 h, ~36 h, ~84 h. Two of the three
 * are only ~8 minutes apart in time-of-day, which is what makes a naive
 * period search pick a wrong interval.
 */
function threeTrackArchive(cycles: number): number[] {
  const out: number[] = [];
  const seeds = [
    ms("2026-06-04T14:40:52Z"), // track 101, ascending
    ms("2026-06-05T14:33:03Z"), // track 28, ascending  (8 min from 101)
    ms("2026-06-07T02:30:46Z") //  track 137, descending
  ];
  // A few seconds of NEGATIVE drift per cycle, as the real tracks have: the
  // measured al-Shaheen descending track runs 02:31:09 -> 02:30:46, i.e. six
  // days MINUS 23 seconds. The sign is what matters. Running short means an
  // older pass projected forward by a whole 6 days lands just AFTER the
  // newest one, which is the condition the same-overpass tolerance in the
  // floor exists to absorb. With no drift -- or drift the other way -- that
  // tolerance can be deleted and the suite stays green (measured twice).
  for (let c = 0; c < cycles; c++) {
    for (const s of seeds) out.push(s + c * 6 * DAY - c * 7 * 1000);
  }
  return out.sort((a, b) => a - b);
}

describe("observationCadence", function () {
  describe("collapseToObservations", function () {
    it("merges an overpass that arrived as two frames", function () {
      // The AOI straddles an along-track frame boundary: one pass, two frames
      // ~25 s apart. Counted separately they imply a 25-second cadence.
      const t = ms("2026-09-05T14:33:03Z");
      expect(collapseToObservations([t, t + 25 * 1000])).toEqual([t]);
    });

    it("keeps genuinely separate passes", function () {
      const a = ms("2026-09-05T14:33:03Z");
      const b = ms("2026-09-07T02:30:46Z");
      expect(collapseToObservations([b, a])).toEqual([a, b]);
    });

    it("drops non-finite instants rather than propagating them", function () {
      const t = ms("2026-09-05T14:33:03Z");
      expect(collapseToObservations([NaN, t, Infinity])).toEqual([t]);
    });
  });

  describe("inferRepeatMs", function () {
    it("finds the FUNDAMENTAL period, not one of its harmonics", function () {
      // The load-bearing case. Every multiple of the true repeat inherits its
      // matches, so a "most matches wins" rule picks 12 days over 6 and every
      // prediction lands a day early. Measured on the real archive: 6d
      // explained 77% of observations and 12d explained 83%.
      expect(inferRepeatMs(threeTrackArchive(8))).toBe(6 * DAY);
    });

    it("says nothing when the history is too short to be sure", function () {
      // A wrong date stated plainly is worse than no date.
      expect(inferRepeatMs(threeTrackArchive(2))).toBeUndefined();
    });

    it("says nothing when no single period explains the history", function () {
      const noise = [0, 3, 11, 26, 40, 57, 91, 130, 150, 201].map(
        (d) => ms("2026-01-01T00:00:00Z") + d * DAY + (d % 7) * HOUR
      );
      expect(inferRepeatMs(noise)).toBeUndefined();
    });
  });

  describe("nextExpectedObservationMs", function () {
    it("names the next pass across three interleaved tracks", function () {
      const archive = threeTrackArchive(10);
      const last = archive[archive.length - 1]; // a 137 pass, 02:30
      // The next pass is track 101 of the following cycle - NOT this track
      // again, and not the 28 track that happens to sit next in the array.
      // Asserted as a PREDICTION (within minutes), because that is what it
      // is: the tracks drift a few seconds a cycle and the inferred repeat
      // is a whole number of days.
      const predicted = nextExpectedObservationMs(archive, last)!;
      const trueNext = archive[archive.length - 3] + 6 * DAY - 7 * 1000;
      expect(Math.abs(predicted - trueNext) < 5 * MIN).toBe(true);
      // Non-vacuous: the 28 track is a day further out, far outside that
      // tolerance, so the assertion above genuinely picks a track.
      expect(
        Math.abs(predicted - (archive[archive.length - 2] + 6 * DAY)) > DAY / 2
      ).toBe(true);
    });

    it("does not re-predict the overpass that just happened", function () {
      // Asked AT a pass, an older same-track pass projects to a few seconds
      // later. Measured on the real archive: it answered 02:30:53 for a pass
      // at 02:30:46 instead of the genuine next pass three days out.
      const archive = threeTrackArchive(10);
      const last = archive[archive.length - 1];
      const next = nextExpectedObservationMs(archive, last)!;
      expect(next - last).toBeGreaterThan(HOUR);
    });

    it("takes its phase from the latest cycle, not from stale history", function () {
      // A track whose slot moved (the Sentinel-1A retirement did exactly
      // this) leaves old passes that project forward onto a time nothing
      // flies any more. With the full history in scope a 2026-05-12 pass
      // projected twenty cycles forward beat the real answer by a day.
      const archive = threeTrackArchive(10);
      const stale = archive[0] - 20 * 6 * DAY - 3 * HOUR;
      const last = archive[archive.length - 1];
      const withStale = nextExpectedObservationMs([stale, ...archive], last);
      expect(withStale).toBe(nextExpectedObservationMs(archive, last));
    });

    it("says nothing rather than project a dead cadence", function () {
      // Every track overdue by more than a full cycle means the feed stopped.
      const archive = threeTrackArchive(10);
      const last = archive[archive.length - 1];
      expect(
        nextExpectedObservationMs(archive, last + 40 * DAY)
      ).toBeUndefined();
    });

    it("rejects a non-finite clock", function () {
      expect(
        nextExpectedObservationMs(threeTrackArchive(10), NaN)
      ).toBeUndefined();
    });
  });

  describe("formatObservationInstant", function () {
    it("renders in UTC, not the machine's zone", function () {
      // A local rendering shifts the DATE for a reader east or west of the
      // meridian, so the caption would name a different day than the
      // timeline tick it describes.
      expect(formatObservationInstant(ms("2026-09-07T02:30:46Z"))).toBe(
        "7 Sep 2026, 02:30 UTC"
      );
      expect(formatObservationInstant(ms("2026-09-10T14:40:52Z"))).toBe(
        "10 Sep 2026, 14:40 UTC"
      );
    });

    it("returns undefined for a non-instant", function () {
      expect(formatObservationInstant(NaN)).toBeUndefined();
    });
  });

  describe("relativeInstantPhrase", function () {
    it("uses hours below two days and whole days above", function () {
      expect(relativeInstantPhrase(-36 * HOUR)).toBe("36 h ago");
      expect(relativeInstantPhrase(24 * HOUR)).toBe("in 24 h");
      expect(relativeInstantPhrase(3 * DAY)).toBe("in 3 days");
      expect(relativeInstantPhrase(-2 * DAY)).toBe("2 days ago");
    });

    it("says 'now' inside the hour instead of 'in 0 days'", function () {
      expect(relativeInstantPhrase(5 * MIN)).toBe("now");
    });

    it("keeps the singular", function () {
      expect(relativeInstantPhrase(-50 * HOUR)).toBe("2 days ago");
      expect(relativeInstantPhrase(-30 * DAY)).toBe("30 days ago");
      expect(relativeInstantPhrase(49 * HOUR)).toBe("in 2 days");
    });
  });

  describe("observationCaption", function () {
    const last = ms("2026-09-07T02:30:46Z");
    const next = ms("2026-09-10T14:40:52Z");

    it("states both halves, and words the second as an expectation", function () {
      const caption = observationCaption({
        label: "pass",
        lastMs: last,
        nextMs: next,
        nowMs: last + 36 * HOUR
      })!;
      expect(caption).toBe(
        "last pass 7 Sep 2026, 02:30 UTC (36 h ago) · " +
          "next expected 10 Sep 2026, 14:40 UTC (in 2 days)"
      );
      // The second half is a prediction from an inferred cadence, wrong by up
      // to ~36 h across a constellation change. It must never read as a
      // commitment.
      expect(caption).toContain("expected");
    });

    it("does NOT go quiet on a fresh feed", function () {
      // THE BUG THIS FIXES. The staleness caption it replaces suppressed
      // itself below two days, so on a feed whose gaps run 24-84 h the line
      // vanished for roughly half of every cycle and read as a glitch.
      const caption = observationCaption({
        label: "pass",
        lastMs: last,
        nextMs: next,
        nowMs: last + 1 * HOUR
      });
      expect(caption).toBeDefined();
      expect(caption).toContain("1 h ago");
    });

    it("states the half it has when the other is unavailable", function () {
      expect(
        observationCaption({
          label: "pass",
          lastMs: last,
          nextMs: undefined,
          nowMs: last + 5 * DAY
        })
      ).toBe("last pass 7 Sep 2026, 02:30 UTC (5 days ago)");
    });

    it("is undefined when neither half can be stated", function () {
      expect(
        observationCaption({
          label: "pass",
          lastMs: undefined,
          nextMs: undefined,
          nowMs: last
        })
      ).toBeUndefined();
    });

    it("is undefined without a usable domain noun", function () {
      // The noun crosses a network boundary; "last : ..." is broken copy on
      // a customer surface.
      expect(
        observationCaption({
          label: "   ",
          lastMs: last,
          nextMs: next,
          nowMs: last
        })
      ).toBeUndefined();
    });
  });
});

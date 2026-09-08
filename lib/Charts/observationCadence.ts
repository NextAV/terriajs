/**
 * When is the next observation expected, and how to say it.
 *
 * A revisit-based product (a SAR pass, an InSAR acquisition, a survey visit)
 * observes on a fixed repeat cycle, so the chart can state not only when it
 * last looked but when it will look next. Both halves matter on a product
 * whose contract is "an observation is not an all-clear": a reader who can
 * see the next pass is three days out reads today's empty map correctly.
 *
 * Everything here is PURE and takes `nowMs` as a parameter -- a function that
 * reads the clock itself cannot be tested, which is the same reason
 * `stalenessDays` takes one.
 */

/** Instants closer together than this are the same overpass, not two. */
const SAME_PASS_MS = 10 * 60 * 1000;

/** How far a repeat may drift between cycles and still count as a match. */
const REPEAT_TOLERANCE_MS = 20 * 60 * 1000;

/** Shortest and longest repeat cycle we will infer, in whole days. */
const MIN_REPEAT_DAYS = 1;
const MAX_REPEAT_DAYS = 30;

/**
 * Fewest observations before a cadence may be inferred at all.
 *
 * A short history can produce a confident-looking repeat from two or three
 * points that happen to line up, and a wrong date stated plainly is worse
 * than no date. Below this the caller gets undefined and says nothing.
 */
const MIN_OBSERVATIONS = 8;

/**
 * A repeat must explain at least this share of the history. Below it we are
 * fitting noise -- e.g. a feed that changed cadence mid-window, where no
 * single interval maps most observations onto another.
 */
const MIN_EXPLAINED = 0.5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when `sorted` holds a value within `tol` of `target`.
 *
 * Binary-searches to the INSERTION POINT and then checks the two neighbours,
 * rather than testing each midpoint on the way down. Testing midpoints looks
 * equivalent and is not: the nearest element need never be visited as a
 * midpoint, so the search reports "no match" while a match sits beside the
 * point it converged on. Measured -- with that version the inferred repeat
 * came out 5 days instead of 6 and every prediction was 24 hours early.
 */
function hasNear(sorted: number[], target: number, tol: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  for (const i of [lo - 1, lo]) {
    if (i >= 0 && i < sorted.length && Math.abs(sorted[i] - target) <= tol) {
      return true;
    }
  }
  return false;
}

/**
 * Collapse same-overpass frame splits into one observation.
 *
 * An AOI straddling an along-track frame boundary receives one overpass as
 * two frames ~25 s apart. Left separate they are indistinguishable from a
 * genuine cadence of 25 seconds, and the inferred repeat collapses -- measured
 * on the al-Shaheen archive, this single step moved the median prediction
 * error from 11.9 HOURS to 7 minutes.
 */
export function collapseToObservations(instants: number[]): number[] {
  const sorted = instants
    .filter((t) => Number.isFinite(t))
    .slice()
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) {
    if (out.length === 0 || t - out[out.length - 1] > SAME_PASS_MS) out.push(t);
  }
  return out;
}

/**
 * The repeat cycle the history is most consistent with, in ms, or undefined.
 *
 * Deliberately inferred from the DATA rather than hard-coded: the repeat is a
 * property of the constellation flying today, not of our source code. When
 * Sentinel-1A retired on 2026-06-29 the effective revisit over a fixed AOI
 * changed, and a hard-coded interval would have gone quietly wrong.
 */
export function inferRepeatMs(observations: number[]): number | undefined {
  if (observations.length < MIN_OBSERVATIONS) return undefined;
  const sorted = observations.slice().sort((a, b) => a - b);
  const needed = sorted.length * MIN_EXPLAINED;
  // SMALLEST period that clears the bar -- NOT the highest-scoring one.
  // Every MULTIPLE of the true repeat inherits its matches and usually adds
  // a few more (a track whose 6-day partner is missing may still have a
  // 12-day one), so "most hits wins" is structurally biased toward
  // harmonics. Measured on the al-Shaheen archive: 6d matched 77% of
  // observations and 12d matched 83%, so max-hits chose TWELVE days and
  // every prediction came out a day early. The fundamental is what the
  // satellite actually flies; the harmonics are arithmetic.
  for (let days = MIN_REPEAT_DAYS; days <= MAX_REPEAT_DAYS; days++) {
    const d = days * DAY_MS;
    let hits = 0;
    for (const t of sorted) {
      if (hasNear(sorted, t + d, REPEAT_TOLERANCE_MS)) hits++;
    }
    if (hits >= needed) return d;
  }
  return undefined;
}

/**
 * The next expected observation instant, or undefined when we cannot say.
 *
 * Projects EVERY past observation forward by the inferred repeat and takes
 * the soonest that is still ahead of `nowMs` -- which is what makes it work
 * across several interleaved orbit tracks without needing to know they exist.
 *
 * ACCURACY, measured by backtest over 120 days of real Sentinel-1
 * acquisitions above the al-Shaheen AOI (69 observations): in a settled
 * constellation, 24 of 24 predictions landed within 1.5 minutes. ACROSS a
 * constellation change (the S1A retirement) it was wrong by up to ~48 hours
 * and took about three weeks to re-converge. So this is an EXPECTATION and
 * the caller must word it as one -- never as a commitment.
 */
export function nextExpectedObservationMs(
  instants: number[],
  nowMs: number
): number | undefined {
  if (!Number.isFinite(nowMs)) return undefined;
  const observations = collapseToObservations(instants);
  const repeat = inferRepeatMs(observations);
  if (repeat === undefined) return undefined;
  const latest = observations[observations.length - 1];
  // A feed that has missed a whole cycle is no longer described by its own
  // cadence, so projecting it forward would name a date on the strength of a
  // rhythm that has already stopped. Saying nothing is the honest answer.
  //
  // This is checked against the LATEST OBSERVATION. Checking the projected
  // result instead cannot work and was the first version's mistake: the
  // stepping loop always lands within one cycle of the floor, so
  // `best - floor > repeat` is unreachable by construction -- a guard that
  // reads as a safety net and can never fire.
  if (nowMs - latest > repeat + REPEAT_TOLERANCE_MS) return undefined;
  // The floor clears the LATEST KNOWN OBSERVATION, not just `nowMs`.
  // Projecting an older same-track pass forward reproduces the overpass that
  // just happened, a few seconds off, and with `nowMs` sitting on that pass
  // it reads as "in the future" -- measured: asked at the 2026-09-07 02:30:46
  // pass, the predictor answered 02:30:53, seven seconds later, instead of
  // the genuine next pass three days out. One overpass tolerance separates
  // "the same look again" from "the next look".
  const floor = Math.max(nowMs, latest + SAME_PASS_MS);
  // PHASE comes from the most recent cycle only; the long history is used to
  // infer the PERIOD and nothing else. One repeat cycle back from the newest
  // observation contains exactly one pass per active track, with their
  // current phases -- and an older pass projected forward carries the phase
  // of whatever was flying then. Measured: with the full history in scope, a
  // 2026-05-12 pass projected twenty cycles forward beat the real answer by a
  // day, because the track's slot moved when Sentinel-1A retired. Bounding
  // the phase window also means the prediction re-converges within one cycle
  // of a constellation change instead of drifting for weeks.
  const phaseWindowStart = latest - repeat - REPEAT_TOLERANCE_MS;
  let best: number | undefined;
  for (const t of observations) {
    if (t < phaseWindowStart) continue;
    let next = t + repeat;
    // A history reaching well into the past still projects forward: step by
    // whole cycles rather than skipping the track entirely.
    while (next <= floor) next += repeat;
    if (best === undefined || next < best) best = next;
  }
  return best;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * "7 Sep 2026, 02:30 UTC", or undefined for a non-instant.
 *
 * Built from UTC getters rather than `toLocaleString`, for two reasons. The
 * observation instant IS in UTC and a local rendering silently shifts the
 * DATE for a reader east or west of the meridian -- the caption would name a
 * different day than the timeline tick it describes. And a locale-dependent
 * string cannot be asserted in a spec that must pass on any CI machine.
 */
export function formatObservationInstant(ms: number): string | undefined {
  if (!Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return (
    `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`
  );
}

/**
 * "36 h ago" / "in 3 days" / "now" for a signed offset from the present.
 *
 * Hours below two days, whole days above: "in 0 days" is the phrasing this
 * avoids, and on a feed whose gaps run 24-84 hours the hour is the useful
 * unit exactly where the day is not.
 */
export function relativeInstantPhrase(deltaMs: number): string | undefined {
  if (!Number.isFinite(deltaMs)) return undefined;
  const abs = Math.abs(deltaMs);
  const future = deltaMs > 0;
  if (abs < 60 * 60 * 1000) return "now";
  if (abs < 2 * DAY_MS) {
    const h = Math.round(abs / (60 * 60 * 1000));
    return future ? `in ${h} h` : `${h} h ago`;
  }
  const days = Math.floor(abs / DAY_MS);
  const unit = days === 1 ? "day" : "days";
  return future ? `in ${days} ${unit}` : `${days} ${unit} ago`;
}

export interface ObservationCaptionOptions {
  /** Domain noun: "pass", "acquisition", "visit". */
  label: string;
  /** Newest observation actually made. */
  lastMs: number | undefined;
  /** Next expected observation, from `nextExpectedObservationMs`. */
  nextMs: number | undefined;
  nowMs: number;
}

/**
 * "last pass 7 Sep 2026, 02:30 UTC (36 h ago) - next expected 10 Sep 2026,
 * 14:41 UTC (in 3 days)", or undefined when neither half can be stated.
 *
 * WORDING is load-bearing. The second half is a PREDICTION from an inferred
 * cadence, so it says "expected" and never commits: the backtest above shows
 * it wrong by up to ~48 h across a constellation change. A reader may plan
 * around "expected"; they would be misled by a bare date.
 *
 * Unlike the staleness caption this replaces, it does NOT go quiet on a
 * healthy feed. That suppression made sense when the line was only a warning,
 * but it also meant the line vanished for roughly half of every revisit cycle
 * -- present at 84 hours, gone at 24 -- so it read as a glitch rather than as
 * a deliberate silence. A line that answers "when did we last look, and when
 * do we look next" is useful precisely when the feed is healthy.
 */
export function observationCaption(
  options: ObservationCaptionOptions
): string | undefined {
  const { label, lastMs, nextMs, nowMs } = options;
  const trimmed = typeof label === "string" ? label.trim() : "";
  if (trimmed.length === 0 || !Number.isFinite(nowMs)) return undefined;

  const parts: string[] = [];
  const lastText =
    lastMs === undefined ? undefined : formatObservationInstant(lastMs);
  if (lastText !== undefined && lastMs !== undefined) {
    const rel = relativeInstantPhrase(lastMs - nowMs);
    parts.push(`last ${trimmed} ${lastText}${rel ? ` (${rel})` : ""}`);
  }
  const nextText =
    nextMs === undefined ? undefined : formatObservationInstant(nextMs);
  if (nextText !== undefined && nextMs !== undefined) {
    const rel = relativeInstantPhrase(nextMs - nowMs);
    parts.push(`next expected ${nextText}${rel ? ` (${rel})` : ""}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

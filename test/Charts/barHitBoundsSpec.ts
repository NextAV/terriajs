import {
  MAX_HIT_HALF_WIDTH,
  computeHitBounds
} from "../../lib/Charts/barHitBounds";
import type { ChartPoint } from "../../lib/Charts/ChartData";

const pts = (xs: number[]): ChartPoint[] => xs.map((x) => ({ x, y: 1 }));
const identity = (x: number | Date) => Number(x);

/** Overlaps and voids between the returned tiles, sorted by position. */
function tiling(bounds: ({ x: number; width: number } | undefined)[]) {
  const spans = bounds
    .filter((b): b is { x: number; width: number } => b !== undefined)
    .map((b) => [b.x, b.x + b.width])
    .sort((a, b) => a[0] - b[0]);
  let overlaps = 0;
  let voids = 0;
  for (let i = 1; i < spans.length; i++) {
    const d = spans[i][0] - spans[i - 1][1];
    if (d < -1e-9) overlaps++;
    else if (d > 1e-9) voids++;
  }
  return { overlaps, voids };
}

describe("computeHitBounds", function () {
  it("tiles evenly spaced bars with no overlap and no void", function () {
    const b = computeHitBounds(pts([0, 10, 20, 30, 40]), identity);
    expect(tiling(b).overlaps).toBe(0);
    expect(tiling(b).voids).toBe(0);
  });

  it("gives each bar the midpoint of the gap to each neighbour", function () {
    // Uneven on purpose: bar at 10 owns 5..20 (half of the 10-gap on its left,
    // half of the 20-gap on its right).
    const b = computeHitBounds(pts([0, 10, 30]), identity);
    expect(b[1]!.x).toBe(5);
    expect(b[1]!.x + b[1]!.width).toBe(20);
  });

  it("owns its own centre — every bar", function () {
    const xs = [0, 10, 20, 60, 70];
    const b = computeHitBounds(pts(xs), identity);
    xs.forEach((x, i) => {
      const owner = b.findIndex(
        (r) => r !== undefined && x >= r.x && x < r.x + r.width
      );
      expect(owner).toBe(i);
    });
  });

  it("contains its own centre even when bars share a pixel", function () {
    // Guardian's breaking input for the first version: the middle bar's right
    // half-gap was 0, producing the half-open tile [5,10) — which excludes the
    // very pixel the user aimed at. Every bar must contain its own centre, and
    // bars sharing a pixel must share a tile (they are indistinguishable).
    [
      [0, 10, 10],
      [0, 10, 10, 20],
      [10, 10],
      [0, 0, 10]
    ].forEach((xs) => {
      const b = computeHitBounds(pts(xs), identity);
      xs.forEach((x, i) => {
        const r = b[i]!;
        expect(x >= r.x && x < r.x + r.width).toBe(true);
      });
    });
    const shared = computeHitBounds(pts([0, 10, 10, 20]), identity);
    expect(shared[1]!.x).toBe(shared[2]!.x);
    expect(shared[1]!.width).toBe(shared[2]!.width);
  });

  it("does NOT overlap when bars are closer together than the old 10px floor", function () {
    // The regression this replaces: a fixed >= 10px width on bars ~2.5px apart
    // made ~4 tiles cover the same pixel, so DOM paint order decided the click.
    const b = computeHitBounds(pts([0, 2.5, 5, 7.5, 10]), identity);
    expect(tiling(b).overlaps).toBe(0);
    expect(b[1]!.width).toBe(2.5);
  });

  it("caps reach so a click far from every bar stays a no-op", function () {
    const b = computeHitBounds(pts([0, 1000]), identity);
    // Both halves of a 1000px gap cap at MAX_HIT_HALF_WIDTH, and the outer edge
    // borrows the inner half-gap (also capped) — so each bar gets a symmetric
    // 2 x cap tile rather than reaching halfway across the chart.
    expect(b[0]!.width).toBe(2 * MAX_HIT_HALF_WIDTH);
    expect(b[0]!.x).toBe(-MAX_HIT_HALF_WIDTH);
    const covered = b.some(
      (r) => r !== undefined && 500 >= r.x && 500 < r.x + r.width
    );
    expect(covered).toBe(false);
  });

  it("keeps the result index-aligned with unsorted input", function () {
    // Load-bearing: the imperative zoom path updates rects BY INDEX, so a
    // position-sorted result would assign each bar its neighbour's tile.
    const b = computeHitBounds(pts([30, 0, 10]), identity);
    expect(b[1]!.x < b[2]!.x).toBe(true);
    expect(b[2]!.x < b[0]!.x).toBe(true);
  });

  it("gives a lone bar a bounded tile rather than the whole axis", function () {
    const b = computeHitBounds(pts([50]), identity);
    expect(b[0]!.x).toBe(50 - MAX_HIT_HALF_WIDTH);
    expect(b[0]!.width).toBe(2 * MAX_HIT_HALF_WIDTH);
  });

  it("returns undefined for a non-finite x instead of a NaN rect", function () {
    expect(computeHitBounds(pts([NaN]), identity)[0]).toBeUndefined();
    const mixed = computeHitBounds(pts([0, NaN, 10]), identity);
    expect(mixed[1]).toBeUndefined();
    expect(mixed[0]).toBeDefined();
    expect(mixed[2]).toBeDefined();
  });

  it("never returns a zero-width tile for coincident bars", function () {
    const b = computeHitBounds(pts([10, 10]), identity);
    b.forEach((r) => expect(r!.width >= 1).toBe(true));
  });
});

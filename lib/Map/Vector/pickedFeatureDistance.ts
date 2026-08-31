/** Ordering picked vector-tile features by how far they are from the click.
 *
 * WHY THIS EXISTS. `View.queryFeatures` returns every feature within `brushSize` of the click
 * and returns them in *iteration* order — layer by layer, then tile-array order. It computes
 * the distance to decide membership and then throws it away, and `PickedFeature` carries no
 * position. So `pickFeatures`' first entry, which becomes `selectedFeature`, is an arbitrary
 * member of the returned set rather than the nearest one.
 *
 * On a dense point layer that is very visible. MEASURED in real hardware-WebGL Chrome against
 * the live 11.3M-point Doha PSI velocity layer, with the distances re-derived independently of
 * this file: without the sort, 6 of 6 multi-feature picks returned a non-nearest feature first,
 * worst case rank 26 of 31 — the panel opened on a point 499 m away while one sat 113 m from
 * the cursor. With the sort, 9 of 9 came back rank 1 of N.
 *
 * The brush is 16 *data-tile pixels*, so the ground area it covers grows as you zoom out (2
 * features at 16 km camera height, 10 at 60 km, 32 at 150 km) — hundreds of metres at low zoom
 * is expected, and is exactly the case where "which one" matters.
 *
 * ERRATUM: an earlier draft cited "1,247 features ... ~9.1 km". That figure is NOT reproducible
 * on this layer. Replaced by the measurement above, and recorded as wrong rather than quietly
 * deleted, because it was quoted downstream too.
 *
 * WHY THE MATH IS DUPLICATED HERE, AND HOW THAT IS KEPT HONEST. protomaps-leaflet computes the
 * click's tile-local position inside `TileCache.queryFeatures`, using `project()` and `MAXCOORD`
 * — neither of which it exports. Recovering the distance therefore means recomputing the
 * click's position in the same space.
 *
 * Two things keep that from being a silent-drift hazard. First, the projection is expressed in
 * NORMALIZED Web Mercator (0..1 across the world), which needs no constant from the library and
 * is the standard slippy-map definition rather than a copy of theirs. Second — and this is the
 * load-bearing half — the result is CROSS-CHECKED against the set the library itself returned:
 * every point/line feature it admitted must, under our recomputation, come out closer than the
 * brush. If any does not, our idea of where the click landed disagrees with theirs, and we
 * return the original order untouched rather than sort by a number we no longer trust.
 *
 * That makes the failure mode "no improvement", never "confidently wrong order".
 */

/** Where Web Mercator is defined. protomaps-leaflet clamps to this before projecting, so this
 * file does too -- it is a property of the projection, not a constant borrowed from them. */
const MAX_MERCATOR_LATITUDE = 85.0511287798;

export interface XY {
  x: number;
  y: number;
}

export interface FeatureLike {
  geomType: number;
  geom: XY[][];
}

export interface PickedLike {
  feature: FeatureLike;
}

/** World position in 0..1, x east from -180, y south from the north edge.
 *
 * Equivalent to the library's `project()` followed by its normalize step, but written in the
 * constant-free form so nothing here has to track a value it does not export.
 */
export function normalizedWebMercator(lonDeg: number, latDeg: number): XY {
  // Clamped exactly where the library clamps. Without it the two agree to 2e-15 everywhere
  // inside the Mercator domain and diverge outside it, which is the one input that could make
  // the cross-check below reject a correct sort.
  const clamped = Math.max(
    Math.min(MAX_MERCATOR_LATITUDE, latDeg),
    -MAX_MERCATOR_LATITUDE
  );
  const latRad = (clamped * Math.PI) / 180;
  return {
    x: (lonDeg + 180) / 360,
    y: 0.5 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / (2 * Math.PI)
  };
}

/** The data zoom `View.queryFeatures` will have used for this display zoom. */
export function dataZoomFor(
  displayZoom: number,
  levelDiff: number,
  maxDataLevel: number
): number {
  return Math.min(Math.round(displayZoom) - levelDiff, maxDataLevel);
}

/** The click, in the same tile-local pixel space the picked features' `geom` uses. */
export function tileLocalClickCenter(
  lonDeg: number,
  latDeg: number,
  dataZoom: number,
  tileSize: number
): XY {
  const n = normalizedWebMercator(lonDeg, latDeg);
  // The library wraps x into 0..1 before scaling; mirrored so a click east of the
  // antimeridian lands in the same tile it does there.
  const wrappedX = n.x > 1 ? n.x - Math.floor(n.x) : n.x;
  const scale = 1 << dataZoom;
  const onZoomX = wrappedX * scale;
  const onZoomY = n.y * scale;
  return {
    x: (onZoomX - Math.floor(onZoomX)) * tileSize,
    y: (onZoomY - Math.floor(onZoomY)) * tileSize
  };
}

/** Distance from `center` to the nearest vertex of `geom`. */
export function minVertexDistance(geom: XY[][], center: XY): number {
  let best = Infinity;
  for (const part of geom) {
    for (const v of part) {
      const dx = v.x - center.x;
      const dy = v.y - center.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Order `picked` nearest-first, or return it untouched if the ordering cannot be trusted.
 *
 * `polygonType` features are given distance 0: the library admits them by point-in-polygon, so
 * the click is inside them, and their vertices can be arbitrarily far away. They are excluded
 * from the cross-check for the same reason.
 *
 * The sort is STABLE, so features at equal distance keep the order the library produced.
 */
export function sortPickedByDistance<T extends PickedLike>(
  picked: T[],
  center: XY,
  brushSizeAtZoom: number,
  pointType: number,
  lineType: number,
  polygonType: number
): T[] {
  if (picked.length < 2) return picked;

  const distances = new Map<T, number>();
  for (const p of picked) {
    const t = p.feature?.geomType;
    if (t === polygonType) {
      distances.set(p, 0);
      continue;
    }
    if (t !== pointType && t !== lineType) return picked; // unknown geometry: do not reorder
    const geom = p.feature?.geom;
    if (!geom || geom.length === 0) return picked;
    const d = minVertexDistance(geom, center);
    if (!Number.isFinite(d)) return picked;
    // The cross-check. A feature the library admitted must read as inside the brush under our
    // recomputation of where the click was. A vertex-based distance is >= the true distance to
    // a line segment, so a small tolerance keeps a line whose nearest point lies between two
    // distant vertices from failing the whole sort.
    const tolerance = t === lineType ? 2 : 1;
    if (d >= brushSizeAtZoom * tolerance) return picked;
    distances.set(p, d);
  }

  return picked
    .map((p, i) => ({ p, i, d: distances.get(p) as number }))
    .sort((a, b) => (a.d === b.d ? a.i - b.i : a.d - b.d))
    .map((e) => e.p);
}

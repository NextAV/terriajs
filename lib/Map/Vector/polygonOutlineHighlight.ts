import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import Color from "terriajs-cesium/Source/Core/Color";
import CesiumMath from "terriajs-cesium/Source/Core/Math";
import PolygonHierarchy from "terriajs-cesium/Source/Core/PolygonHierarchy";

/**
 * NextAV: how a selected polygon is highlighted.
 *
 * Set on `Terria.polygonSelectionHighlight` by the embedding application, not
 * through a catalogue trait: upstream validates member traits strictly, and this
 * is a property of the app session, not of any one layer.
 *
 * Left undefined, the stock highlight runs unchanged. With `style: "outline"`
 * a selected polygon entity keeps its own fill and gains a line along each of
 * its rings. The stock branch sets `polygon.outline` (which Cesium does not
 * draw for a ground-draped polygon) and a 0.75-alpha fill in the basemap
 * contrast colour, so on the 3D globe a selection reads as an opaque patch
 * that hides the imagery inside it.
 */
export interface PolygonSelectionHighlight {
  style: "outline";
  /** CSS colour. Defaults to white. */
  color?: string;
  /** Line width in screen pixels. Defaults to 3. */
  width?: number;
}

export const DEFAULT_OUTLINE_COLOR = "#ffffff";
export const DEFAULT_OUTLINE_WIDTH_PX = 3;
const MAX_OUTLINE_WIDTH_PX = 16;

export interface ResolvedOutlineStyle {
  color: Color;
  width: number;
}

/**
 * The colour and width to draw, or undefined when the outline style is not
 * requested. A malformed colour or width falls back to the default rather than
 * drawing nothing: the caller already decided to outline.
 */
export function resolveOutlineStyle(
  setting: PolygonSelectionHighlight | undefined
): ResolvedOutlineStyle | undefined {
  if (!setting || setting.style !== "outline") return undefined;
  const color =
    (typeof setting.color === "string"
      ? Color.fromCssColorString(setting.color)
      : undefined) ?? Color.fromCssColorString(DEFAULT_OUTLINE_COLOR);
  const width =
    typeof setting.width === "number" &&
    Number.isFinite(setting.width) &&
    setting.width > 0
      ? Math.min(setting.width, MAX_OUTLINE_WIDTH_PX)
      : DEFAULT_OUTLINE_WIDTH_PX;
  return { color, width };
}

/**
 * Every ring of a polygon hierarchy, outer ring first, then holes depth-first.
 *
 * Rings are returned OPEN and free of consecutive duplicates: a GeoJSON ring
 * repeats its first position at the end, and a looped ground polyline over
 * that builds a zero-length closing segment whose normal is NaN, which stops
 * Cesium rendering altogether. A ring left with fewer than two distinct
 * positions cannot be drawn as a line and is dropped.
 */
export function polygonHierarchyRings(
  hierarchy: PolygonHierarchy | Cartesian3[] | undefined
): Cartesian3[][] {
  if (!hierarchy) return [];
  const same = (a: Cartesian3, b: Cartesian3) =>
    Cartesian3.equalsEpsilon(a, b, CesiumMath.EPSILON10);
  const open = (positions: Cartesian3[] | undefined) => {
    if (!Array.isArray(positions)) return undefined;
    const ring: Cartesian3[] = [];
    for (const p of positions) {
      if (p && (ring.length === 0 || !same(ring[ring.length - 1], p))) {
        ring.push(p);
      }
    }
    while (ring.length > 1 && same(ring[0], ring[ring.length - 1])) {
      ring.pop();
    }
    return ring.length >= 2 ? ring : undefined;
  };
  if (Array.isArray(hierarchy)) {
    const ring = open(hierarchy);
    return ring ? [ring] : [];
  }
  const rings: Cartesian3[][] = [];
  const visit = (h: PolygonHierarchy | undefined) => {
    if (!h) return;
    const ring = open(h.positions);
    if (ring) rings.push(ring);
    if (Array.isArray(h.holes)) h.holes.forEach(visit);
  };
  visit(hierarchy);
  return rings;
}

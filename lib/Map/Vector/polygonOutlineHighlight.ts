import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import Color from "terriajs-cesium/Source/Core/Color";
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
 * A ring with fewer than two positions cannot be drawn as a line and is
 * dropped. Rings are returned open; the viewer closes them.
 */
export function polygonHierarchyRings(
  hierarchy: PolygonHierarchy | Cartesian3[] | undefined
): Cartesian3[][] {
  if (!hierarchy) return [];
  if (Array.isArray(hierarchy)) {
    return hierarchy.length >= 2 ? [hierarchy] : [];
  }
  const rings: Cartesian3[][] = [];
  const visit = (h: PolygonHierarchy | undefined) => {
    if (!h) return;
    if (Array.isArray(h.positions) && h.positions.length >= 2) {
      rings.push(h.positions);
    }
    if (Array.isArray(h.holes)) h.holes.forEach(visit);
  };
  visit(hierarchy);
  return rings;
}

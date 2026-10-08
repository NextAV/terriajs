import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import Color from "terriajs-cesium/Source/Core/Color";
import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
import PolygonHierarchy from "terriajs-cesium/Source/Core/PolygonHierarchy";
import ColorMaterialProperty from "terriajs-cesium/Source/DataSources/ColorMaterialProperty";
import {
  DEFAULT_OUTLINE_WIDTH_PX,
  polygonHierarchyRings,
  resolveOutlineStyle
} from "../../lib/Map/Vector/polygonOutlineHighlight";
import TerriaFeature from "../../lib/Models/Feature/Feature";
import NoViewer from "../../lib/Models/NoViewer";
import Terria from "../../lib/Models/Terria";

const outer = Cartesian3.fromDegreesArray([
  51.5, 25.3, 51.501, 25.3, 51.501, 25.301, 51.5, 25.301
]);
const hole = Cartesian3.fromDegreesArray([
  51.5004, 25.3004, 51.5006, 25.3004, 51.5006, 25.3006
]);
const islandInHole = Cartesian3.fromDegreesArray([
  51.5005, 25.3005, 51.50052, 25.3005, 51.50052, 25.30052
]);

class RecordingViewer extends NoViewer {
  supported = true;
  drawn: { rings: Cartesian3[][]; color: Color; width: number }[] = [];
  removed = 0;

  _addPolygonOutlineHighlight(
    rings: Cartesian3[][],
    color: Color,
    widthPx: number
  ): (() => void) | undefined {
    if (!this.supported) return undefined;
    this.drawn.push({ rings, color, width: widthPx });
    return () => {
      this.removed++;
    };
  }
}

function polygonFeature(): TerriaFeature {
  return new TerriaFeature({
    polygon: {
      hierarchy: new PolygonHierarchy(outer, [new PolygonHierarchy(hole)]),
      material: new ColorMaterialProperty(Color.RED)
    }
  });
}

function materialColor(feature: TerriaFeature): Color | undefined {
  return (feature.polygon!.material as ColorMaterialProperty).color?.getValue(
    JulianDate.now()
  );
}

describe("polygonOutlineHighlight", function () {
  describe("polygonHierarchyRings", function () {
    it("returns the outer ring then every hole, depth-first", function () {
      const rings = polygonHierarchyRings(
        new PolygonHierarchy(outer, [
          new PolygonHierarchy(hole, [new PolygonHierarchy(islandInHole)])
        ])
      );
      expect(rings.length).toBe(3);
      expect(rings[0]).toBe(outer);
      expect(rings[1]).toBe(hole);
      expect(rings[2]).toBe(islandInHole);
    });

    it("accepts a bare position array", function () {
      expect(polygonHierarchyRings(outer)).toEqual([outer]);
    });

    it("drops a ring that cannot be drawn as a line", function () {
      const single = [outer[0]];
      expect(polygonHierarchyRings(new PolygonHierarchy(single))).toEqual([]);
      expect(polygonHierarchyRings(single)).toEqual([]);
      expect(polygonHierarchyRings(undefined)).toEqual([]);
    });
  });

  describe("resolveOutlineStyle", function () {
    it("is off unless the outline style is requested", function () {
      expect(resolveOutlineStyle(undefined)).toBeUndefined();
      expect(resolveOutlineStyle({ style: "fill" } as any)).toBeUndefined();
    });

    it("defaults to a white line of the default width", function () {
      const style = resolveOutlineStyle({ style: "outline" })!;
      expect(Color.equals(style.color, Color.WHITE)).toBe(true);
      expect(style.width).toBe(DEFAULT_OUTLINE_WIDTH_PX);
    });

    it("falls back to the defaults on a malformed colour or width", function () {
      const style = resolveOutlineStyle({
        style: "outline",
        color: "not-a-colour",
        width: Number.NaN
      })!;
      expect(Color.equals(style.color, Color.WHITE)).toBe(true);
      expect(style.width).toBe(DEFAULT_OUTLINE_WIDTH_PX);
      expect(resolveOutlineStyle({ style: "outline", width: -2 })!.width).toBe(
        DEFAULT_OUTLINE_WIDTH_PX
      );
    });

    it("caps an absurd width", function () {
      expect(
        resolveOutlineStyle({ style: "outline", width: 400 })!.width
      ).toBeLessThanOrEqual(16);
    });
  });

  describe("GlobeOrMap._highlightFeature on a polygon", function () {
    let terria: Terria;
    let viewer: RecordingViewer;

    beforeEach(function () {
      terria = new Terria({ baseUrl: "./" });
      viewer = new RecordingViewer(terria.mainViewer);
    });

    it("keeps the stock translucent fill when no style is set", async function () {
      const feature = polygonFeature();
      await viewer._highlightFeature(feature);
      expect(viewer.drawn.length).toBe(0);
      const color = materialColor(feature)!;
      expect(Color.equals(color, Color.RED)).toBe(false);
      expect(color.alpha).toBeCloseTo(0.75, 5);
    });

    it("outlines every ring and leaves the polygon's own fill alone", async function () {
      terria.polygonSelectionHighlight = { style: "outline", width: 4 };
      const feature = polygonFeature();
      const materialBefore = feature.polygon!.material;
      const outlineBefore = feature.polygon!.outline;

      await viewer._highlightFeature(feature);

      expect(viewer.drawn.length).toBe(1);
      expect(viewer.drawn[0].rings.length).toBe(2);
      expect(viewer.drawn[0].width).toBe(4);
      expect(Color.equals(viewer.drawn[0].color, Color.WHITE)).toBe(true);
      expect(feature.polygon!.material).toBe(materialBefore);
      expect(feature.polygon!.outline).toBe(outlineBefore);
      expect(Color.equals(materialColor(feature)!, Color.RED)).toBe(true);
    });

    it("removes the outline when the selection clears", async function () {
      terria.polygonSelectionHighlight = { style: "outline" };
      await viewer._highlightFeature(polygonFeature());
      expect(viewer.removed).toBe(0);
      await viewer._highlightFeature(undefined);
      expect(viewer.removed).toBe(1);
    });

    it("replaces the previous outline when another polygon is selected", async function () {
      terria.polygonSelectionHighlight = { style: "outline" };
      await viewer._highlightFeature(polygonFeature());
      await viewer._highlightFeature(polygonFeature());
      expect(viewer.drawn.length).toBe(2);
      expect(viewer.removed).toBe(1);
    });

    it("falls back to the stock fill when the viewer cannot draw the outline", async function () {
      terria.polygonSelectionHighlight = { style: "outline" };
      viewer.supported = false;
      const feature = polygonFeature();
      await viewer._highlightFeature(feature);
      expect(viewer.drawn.length).toBe(0);
      expect(materialColor(feature)!.alpha).toBeCloseTo(0.75, 5);
    });

    it("outlines a contour pick-fill polygon too", async function () {
      terria.polygonSelectionHighlight = { style: "outline" };
      const feature = polygonFeature();
      (feature as any)._contourPickFill = true;
      const materialBefore = feature.polygon!.material;
      await viewer._highlightFeature(feature);
      expect(viewer.drawn.length).toBe(1);
      expect(feature.polygon!.material).toBe(materialBefore);
    });
  });
});

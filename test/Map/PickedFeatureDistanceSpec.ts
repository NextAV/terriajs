import {
  dataZoomFor,
  minVertexDistance,
  normalizedWebMercator,
  sortPickedByDistance,
  tileLocalClickCenter
} from "../../lib/Map/Vector/pickedFeatureDistance";

// protomaps-leaflet's GeomType values.
const POINT = 1;
const LINE = 2;
const POLYGON = 3;

const pt = (x: number, y: number, geomType = POINT) => ({
  feature: { geomType, geom: [[{ x, y }]] }
});

describe("pickedFeatureDistance", function () {
  describe("normalizedWebMercator", function () {
    it("agrees with the library's project()+normalize to floating-point noise", function () {
      // The library projects with R*lng*d / R*ln((1+sin)/(1-sin))/2 and normalizes by MAXCOORD.
      // Neither R nor MAXCOORD is exported, so this file recomputes in the constant-free form.
      // This locks the equivalence rather than asserting it in a comment.
      const R = 6378137;
      const MAXCOORD = R * Math.PI;
      const MAX_LAT = 85.0511287798;
      const upstream = (latDeg: number, lonDeg: number) => {
        const d = Math.PI / 180;
        const lat = Math.max(Math.min(MAX_LAT, latDeg), -MAX_LAT);
        const sin = Math.sin(lat * d);
        const px = R * lonDeg * d;
        const py = (R * Math.log((1 + sin) / (1 - sin))) / 2;
        return {
          x: (px + MAXCOORD) / (MAXCOORD * 2),
          y: 1 - (py + MAXCOORD) / (MAXCOORD * 2)
        };
      };
      // Includes latitudes beyond the Mercator domain, which is the one input where an
      // unclamped reimplementation diverges.
      const cases = [
        [25.28117, 51.57372],
        [44.49, 11.34],
        [0, 0],
        [MAX_LAT, 180],
        [-MAX_LAT, -180],
        [89.9, 10],
        [-89.9, -10]
      ];
      cases.forEach(([lat, lon]) => {
        const a = upstream(lat, lon);
        const b = normalizedWebMercator(lon, lat);
        expect(Math.abs(a.x - b.x)).toBeLessThan(1e-12);
        expect(Math.abs(a.y - b.y)).toBeLessThan(1e-12);
      });
    });
  });

  describe("dataZoomFor", function () {
    it("mirrors View.queryFeatures' own choice, including the maxDataLevel cap", function () {
      // The cap must BIND in at least one case, or removing it changes nothing: at
      // displayZoom 16 with levelDiff 1 the result is 15 whether or not maxDataLevel is
      // applied, so a test built only from that pair passes with the cap deleted.
      expect(dataZoomFor(20, 1, 15)).toBe(15); // cap binds: 19 -> 15
      expect(dataZoomFor(16, 1, 20)).toBe(15); // cap does not bind
      expect(dataZoomFor(9.4, 1, 20)).toBe(8); // rounds the display zoom first
    });
  });

  describe("tileLocalClickCenter", function () {
    it("returns a position inside the tile", function () {
      const c = tileLocalClickCenter(51.57372, 25.28117, 15, 1024);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThan(1024);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThan(1024);
    });
  });

  describe("sortPickedByDistance", function () {
    const center = { x: 100, y: 100 };

    it("puts the nearest feature first", function () {
      const far = pt(140, 100);
      const near = pt(103, 100);
      const mid = pt(110, 100);
      const out = sortPickedByDistance(
        [far, near, mid],
        center,
        50,
        POINT,
        LINE,
        POLYGON
      );
      expect(out[0]).toBe(near);
      expect(out[2]).toBe(far);
    });

    it("is a no-op for 0 or 1 features -- the ordinary sparse-layer case", function () {
      const one = [pt(103, 100)];
      expect(sortPickedByDistance(one, center, 50, POINT, LINE, POLYGON)).toBe(
        one
      );
      const none: any[] = [];
      expect(sortPickedByDistance(none, center, 50, POINT, LINE, POLYGON)).toBe(
        none
      );
    });

    it("is stable, so equidistant features keep the library's order", function () {
      const a = pt(110, 100);
      const b = pt(100, 110);
      const out = sortPickedByDistance(
        [a, b],
        center,
        50,
        POINT,
        LINE,
        POLYGON
      );
      expect(out[0]).toBe(a);
      expect(out[1]).toBe(b);
    });

    it("returns the ORIGINAL order when a feature reads outside the brush", function () {
      // Our idea of where the click landed disagrees with the library's -- it admitted this
      // feature, we make it 300px away. Do not sort by a number we no longer trust.
      const input = [pt(400, 100), pt(103, 100)];
      const out = sortPickedByDistance(input, center, 50, POINT, LINE, POLYGON);
      expect(out).toBe(input);
    });

    it("gives a polygon distance 0 and does not cross-check it", function () {
      // Admitted by point-in-polygon, so the click is inside; its vertices may be far away.
      const poly = {
        feature: { geomType: POLYGON, geom: [[{ x: 900, y: 900 }]] }
      };
      const point = pt(120, 100);
      const out = sortPickedByDistance(
        [point, poly],
        center,
        50,
        POINT,
        LINE,
        POLYGON
      );
      expect(out[0]).toBe(poly);
    });

    it("does not reorder an unknown geometry type", function () {
      const input = [pt(140, 100, 99), pt(103, 100, 99)];
      expect(
        sortPickedByDistance(input, center, 50, POINT, LINE, POLYGON)
      ).toBe(input);
    });
  });

  describe("minVertexDistance", function () {
    it("takes the nearest vertex across all parts", function () {
      expect(
        minVertexDistance(
          [
            [{ x: 0, y: 0 }],
            [
              { x: 3, y: 4 },
              { x: 1, y: 0 }
            ]
          ],
          { x: 0, y: 0 }
        )
      ).toBe(0);
    });
  });
});

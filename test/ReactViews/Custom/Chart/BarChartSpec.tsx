import { render } from "@testing-library/react";
import { scaleLinear, scaleTime } from "@visx/scale";
import BarChart from "../../../../lib/ReactViews/Custom/Chart/BarChart";

describe("BarChart", function () {
  const points = [
    { x: new Date("2026-01-01"), y: 2 },
    { x: new Date("2026-01-02"), y: 5 },
    { x: new Date("2026-01-03"), y: 3 }
  ];

  const chartItem = {
    id: "chartitem",
    item: {} as never,
    categoryName: "Bar chart",
    key: "key-chartitem",
    name: "chartitem",
    type: "bar" as const,
    xAxis: { name: "xAxis", scale: "time" as const },
    points,
    domain: {
      x: [points[0].x.valueOf(), points[2].x.valueOf()],
      y: [0, 5]
    },
    getColor: () => "red",
    onClick: () => {},
    showInChartPanel: true,
    isSelectedInWorkbench: true,
    updateIsSelectedInWorkbench: () => {}
  };

  // Inverted y-range [height, 0] (visx convention): value 0 → the plot bottom (50),
  // value 5 → the top (0), so a taller bar is a bigger value.
  const PLOT_BOTTOM = 50;
  const scales = {
    x: scaleTime({
      domain: [points[0].x, points[2].x],
      range: [0, 30]
    }),
    y: scaleLinear({ domain: [0, 5], range: [PLOT_BOTTOM, 0] })
  };
  const props = { id: "testbar", chartItem, scales };

  it("renders one rect per point", function () {
    const { container } = render(
      <svg>
        <BarChart {...props} />
      </svg>
    );
    expect(container.querySelectorAll("#testbar rect").length).toBe(3);
  });

  it("draws bars anchored at the plot bottom with height proportional to value", function () {
    const { container } = render(
      <svg>
        <BarChart {...props} />
      </svg>
    );
    const rects = Array.from(
      container.querySelectorAll<SVGRectElement>("#testbar rect")
    );
    const box = rects.map((r) => ({
      y: parseFloat(r.getAttribute("y") ?? "NaN"),
      height: parseFloat(r.getAttribute("height") ?? "NaN"),
      width: parseFloat(r.getAttribute("width") ?? "NaN")
    }));

    // Every bar has a positive width and its base sits on the plot bottom (y + height).
    box.forEach((b) => {
      expect(b.width).toBeGreaterThan(0);
      expect(b.y + b.height).toBeCloseTo(PLOT_BOTTOM, 5);
    });

    // Heights track the values [2, 5, 3] → the middle bar (value 5) is the tallest.
    expect(box[1].height).toBeGreaterThan(box[0].height);
    expect(box[1].height).toBeGreaterThan(box[2].height);
    expect(box[2].height).toBeGreaterThan(box[0].height);
    // value 5 spans the full plot height; value 2 is 2/5 of it.
    expect(box[1].height).toBeCloseTo(PLOT_BOTTOM, 5);
    expect(box[0].height).toBeCloseTo((2 / 5) * PLOT_BOTTOM, 5);
  });

  it("renders a zero-count point as a zero-height bar (present in the DOM, invisible)", function () {
    // A day with 0 candidates maps to the baseline: height 0. It must still emit a
    // rect (so the rect-count stays aligned with the point-count in doZoom) — it is
    // simply invisible. Documents the behaviour so a future y-domain-floor change
    // that would change it is caught.
    const zeroPoints = [
      { x: new Date("2026-02-01"), y: 0 },
      { x: new Date("2026-02-02"), y: 4 }
    ];
    const zeroProps = {
      id: "zerobar",
      chartItem: { ...chartItem, points: zeroPoints },
      scales: {
        x: scaleTime({
          domain: [zeroPoints[0].x, zeroPoints[1].x],
          range: [0, 30]
        }),
        y: scaleLinear({ domain: [0, 4], range: [PLOT_BOTTOM, 0] })
      }
    };
    const { container } = render(
      <svg>
        <BarChart {...zeroProps} />
      </svg>
    );
    const rects = Array.from(
      container.querySelectorAll<SVGRectElement>("#zerobar rect")
    );
    expect(rects.length).toBe(2);
    expect(parseFloat(rects[0].getAttribute("height") ?? "NaN")).toBeCloseTo(
      0,
      5
    );
  });

  it("gives all bars the same (non-overlapping) width", function () {
    const { container } = render(
      <svg>
        <BarChart {...props} />
      </svg>
    );
    const widths = Array.from(
      container.querySelectorAll<SVGRectElement>("#testbar rect")
    ).map((r) => parseFloat(r.getAttribute("width") ?? "NaN"));
    widths.forEach((w) => expect(w).toBeCloseTo(widths[0], 5));
  });
});

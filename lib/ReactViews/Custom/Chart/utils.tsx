import { AxisBottom, AxisLeft } from "@visx/axis";
import { Line } from "@visx/shape";
import { observer } from "mobx-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef
} from "react";
import type { ChartItem } from "../../../ModelMixins/ChartableMixin";
import BarChart from "./BarChart";
import LineAndPointChart from "./LineAndPointChart";
import LineChart from "./LineChart";
import MomentLinesChart from "./MomentLinesChart";
import MomentPointsChart from "./MomentPointsChart";
import PointOnMap from "./PointOnMap";
import type { ChartZoomHandle, XScale, YScale } from "./types";

const LABEL_COLOR = "#efefef";
const Y_AXIS_NUM_TICKS = 4;
const Y_AXIS_TICK_LABEL_FONT_SIZE = 10;

interface PlotProps {
  chartItems: readonly ChartItem[];
  initialScales: readonly { x: XScale; y: YScale }[];
  zoomedScales: readonly { x: XScale; y: YScale }[];
}

export const Plot = memo(
  ({ chartItems, initialScales, zoomedScales }: PlotProps) => {
    const chartRefs = useRef<
      { id: string; zoomHandle: ChartZoomHandle; itemIndex: number }[]
    >([]);

    // Bar series are centred on their x, so several on one axis land on the SAME pixels
    // and, at equal widths, the one painted LAST is the only one you see. All of the below
    // is inert for a single bar series — every chart that exists today bar one.
    //
    // ORDER IS DERIVED FROM THE DATA, deliberately, because array order here is NOT stable:
    // it is `terria.workbench.items` order, and `Workbench.add()` inserts at index 0, so
    // toggling a layer off and on (or a workbench drag) reorders the bar series. Under an
    // inset that degraded gracefully — whichever ended up in front was narrower, so both
    // stayed visible. At equal widths it does not: one toggle could hide the product series
    // entirely, which is the exact defect this whole change set exists to fix.
    //
    // So the series with the MOST points is treated as the backdrop: it paints FIRST (so the
    // sparser series is never covered) and it draws the click targets (its x tiling is the
    // finest, so a click resolves to the date actually under the cursor). A coverage/context
    // series is a superset of the product it contextualises by construction, which is what
    // makes point count the right proxy — and unlike declaration order, nothing in the UI
    // can flip it.
    //
    // The hit layer MUST go to the backmost series: a full-height hit rect is a PAINTED
    // element (`fill="transparent"` still satisfies `pointer-events: visiblePainted`), so
    // one drawn in front owns every click on the plot.
    const barPositions = useMemo(() => {
      const indices = chartItems
        .map((c, i) => (c.type === "bar" ? i : -1))
        .filter((i) => i >= 0);
      // Most points first. `sort` is stable (ES2019+), so equal counts keep array order.
      const byDensity = [...indices].sort(
        (a, b) => chartItems[b].points.length - chartItems[a].points.length
      );
      // slot -> chart-item index: the k-th bar POSITION in the output renders the k-th
      // densest series, so the DOM order (= paint order) is density-ordered regardless of
      // how the workbench happens to be sorted.
      const slotFor = new Map<number, number>();
      indices.forEach((slot, k) => slotFor.set(slot, byDensity[k]));
      // y-filtered to match what BarChart actually DRAWS. A point with a finite x but a
      // non-finite y is never rendered as a bar, yet left in the band source it tightens
      // the band for every series on the chart (measured 7.00px -> 2.10px, 70% thinner)
      // — a bar that does not exist making every bar that does exist thinner. The x
      // filter stays in BarChart, where the scale is.
      //
      // NOTE the band is the MINIMUM gap over the UNION, so adding a series can only ever
      // shrink it, and a single near-but-not-equal pair collapses it for every bar on the
      // chart: measured at 229 daily bars, an exact-subset series keeps 2.75px while the
      // same series offset by 1ms drops every bar to the 1px floor. Both series here are
      // daily and midnight-keyed, so this is latent — but it is why the two must stay on
      // the same time grid, not merely overlap.
      const bandPoints =
        indices.length > 1
          ? indices.flatMap((i) =>
              chartItems[i].points.filter((p) => Number.isFinite(p.y))
            )
          : undefined;
      return {
        count: indices.length,
        slotFor,
        hitLayerIndex: byDensity.length > 0 ? byDensity[0] : -1,
        bandPoints
      };
    }, [chartItems]);

    useEffect(() => {
      chartRefs.current?.forEach((ref) => {
        if (typeof ref?.zoomHandle.doZoom === "function") {
          // Indexed by the ref's OWN chart-item index, never by its position in this
          // push-ordered array. Those coincided only while render order matched
          // `chartItems` order; bar series now render density-ordered, so a positional
          // read would hand a series another series' scale.
          ref.zoomHandle.doZoom(zoomedScales[ref.itemIndex]);
        }
      });
    }, [zoomedScales]);

    const addToRefs = (
      id: string,
      el: ChartZoomHandle | null,
      itemIndex: number
    ) => {
      if (el) {
        chartRefs.current.push({ id, zoomHandle: el, itemIndex });
      } else {
        chartRefs.current = chartRefs.current.filter((ref) => ref.id !== id);
      }
    };

    return (
      <>
        {chartItems.map((chartItem, i) => {
          const id = sanitizeIdString(chartItem.key);
          switch (chartItem.type) {
            case "line":
              return (
                <LineChart
                  key={chartItem.key}
                  ref={(node) => addToRefs(id, node, i)}
                  id={id}
                  chartItem={chartItem}
                  scales={initialScales[i]}
                />
              );
            case "bar": {
              // This POSITION renders whichever bar series the density order assigns to
              // it, so DOM order (= paint order) is density-ordered no matter how the
              // workbench is sorted. `key`/`id`/scales all follow the assigned item, so a
              // series keeps its identity and its own scale wherever it is drawn.
              const barIndex = barPositions.slotFor.get(i) ?? i;
              const barItem = chartItems[barIndex];
              const barId = sanitizeIdString(barItem.key);
              return (
                <BarChart
                  key={barItem.key}
                  ref={(node) => addToRefs(barId, node, barIndex)}
                  id={barId}
                  chartItem={barItem}
                  scales={initialScales[barIndex]}
                  rendersHitLayer={
                    barPositions.count < 2 ||
                    barPositions.hitLayerIndex === barIndex
                  }
                  bandPoints={barPositions.bandPoints}
                />
              );
            }
            case "momentPoints": {
              // Find a basis item to stick the points on, if we can't find one, we
              // vertically center the points
              const basisItemIndex = chartItems.findIndex(
                (item) =>
                  (item.type === "line" || item.type === "lineAndPoint") &&
                  item.xAxis.scale === "time"
              );

              return (
                <MomentPointsChart
                  key={chartItem.key}
                  ref={(node) => addToRefs(id, node, i)}
                  id={id}
                  chartItem={chartItem}
                  scales={initialScales[i]}
                  basisItem={chartItems[basisItemIndex]}
                  basisItemScales={initialScales[basisItemIndex]}
                  glyph={chartItem.glyphStyle}
                />
              );
            }
            case "momentLines": {
              return (
                <MomentLinesChart
                  key={chartItem.key}
                  ref={(node) => addToRefs(id, node, i)}
                  id={id}
                  chartItem={chartItem}
                  scales={initialScales[i]}
                />
              );
            }
            case "lineAndPoint": {
              return (
                <LineAndPointChart
                  key={chartItem.key}
                  ref={(node) => addToRefs(id, node, i)}
                  id={id}
                  chartItem={chartItem}
                  scales={initialScales[i]}
                  glyph={chartItem.glyphStyle}
                />
              );
            }
            default: {
              // Exhaustiveness guard: every ChartItemType must have a case above.
              // If a new type is added to the union without a case here, this
              // assignment fails the build (chartItem.type is no longer `never`),
              // turning a silent "renders nothing" into a compile error.
              const _exhaustive: never = chartItem.type;
              return _exhaustive;
            }
          }
        })}
      </>
    );
  }
);

Plot.displayName = "Plot";

interface XAxisProps {
  top: number;
  scale: XScale;
  label: string;
}

export const XAxis = memo(({ scale, ...restProps }: XAxisProps) => {
  return (
    <AxisBottom
      stroke="#efefef"
      tickStroke="#efefef"
      tickLabelProps={() => ({
        fill: "#efefef",
        textAnchor: "middle",
        fontSize: 12,
        fontFamily: "Arial"
      })}
      labelProps={{
        fill: LABEL_COLOR,
        fontSize: 12,
        textAnchor: "middle",
        fontFamily: "Arial"
      }}
      // .nice() rounds the scale so that the aprox beginning and
      // aprox end labels are shown
      // See: https://stackoverflow.com/questions/21753126/d3-js-starting-and-ending-tick
      scale={scale.nice()}
      {...restProps}
    />
  );
});
XAxis.displayName = "XAxis";

interface YAxisProps {
  scale: YScale;
  color: string;
  units?: string;
  offset: number;
}

export const YAxis = memo(({ scale, color, units, offset }: YAxisProps) => {
  return (
    <AxisLeft
      key={`y-axis-${units}`}
      left={offset}
      scale={scale}
      numTicks={Y_AXIS_NUM_TICKS}
      stroke={color}
      tickStroke={color}
      label={units || ""}
      labelOffset={10}
      labelProps={{
        fill: color,
        textAnchor: "middle",
        fontSize: 12,
        fontFamily: "Arial"
      }}
      tickLabelProps={() => ({
        fill: color,
        textAnchor: "end",
        fontSize: Y_AXIS_TICK_LABEL_FONT_SIZE,
        fontFamily: "Arial"
      })}
    />
  );
});
YAxis.displayName = "YAxis";

interface CursorProps extends ComponentPropsWithoutRef<typeof Line> {
  x: number;
}

export const Cursor = memo(({ x, ...restProps }: CursorProps) => {
  return <Line from={{ x, y: 0 }} to={{ x, y: 1000 }} {...restProps} />;
});

Cursor.displayName = "Cursor";

interface PointsOnMapProps {
  chartItems: readonly ChartItem[];
}

export const PointsOnMap: React.FC<PointsOnMapProps> = observer(
  ({ chartItems }: PointsOnMapProps) => {
    return (
      <>
        {chartItems.map(
          (chartItem) =>
            chartItem.pointOnMap && (
              <PointOnMap
                key={`point-on-map-${chartItem.key}`}
                color={chartItem.getColor()}
                point={chartItem.pointOnMap}
              />
            )
        )}
      </>
    );
  }
);
PointsOnMap.displayName = "PointsOnMap";

const sanitizeIdString = (id: string) => {
  // delete all non-alphanum chars
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
};

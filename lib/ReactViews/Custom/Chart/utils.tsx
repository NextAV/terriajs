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
    const chartRefs = useRef<{ id: string; zoomHandle: ChartZoomHandle }[]>([]);

    // Bar series are centred on their x, so several on one axis land on the SAME pixels.
    // Two things follow, and both are inert for a single bar series — every chart that
    // exists today bar one.
    //
    // WIDTH: every bar series measures its width from ONE shared set of points, so all
    // series on a chart render at an IDENTICAL width. Measuring per-series makes the
    // width a function of which series happens to hold the tightest pair — a sparse
    // series then draws visibly wider bars than a dense one on the same axis, which
    // reads as a rendering fault rather than as data. Equal widths mean the series
    // painted last is the one you see, so the composer declares the CONTEXT series
    // first and the PRODUCT last; that is sound only because the product's dates are a
    // subset of the context's, so a covered context bar tells the reader nothing the
    // product bar has not already told them.
    //
    // CLICKS: the hit layer goes to the BACKMOST bar series, never to "the one with the
    // most points". A full-height hit rect is a PAINTED element (`fill="transparent"`
    // still satisfies `pointer-events: visiblePainted`), so whichever series draws it
    // last owns every click on the plot: the series behind it become unclickable and
    // clicks resolve to the wrong series' nearest point. Drawn by the backmost series
    // it can cover nothing. So the composer's first-declared series is both the
    // backdrop and the click surface, and should be the one with the finest x tiling.
    const barPositions = useMemo(() => {
      const indices = chartItems
        .map((c, i) => (c.type === "bar" ? i : -1))
        .filter((i) => i >= 0);
      // y-filtered to match what BarChart actually DRAWS. A point with a finite x but a
      // non-finite y is never rendered as a bar, yet left in the band source it tightens
      // the band for every series on the chart (measured 7.00px -> 2.10px, 70% thinner)
      // — a bar that does not exist making every bar that does exist thinner. The x
      // filter stays in BarChart, where the scale is.
      const bandPoints =
        indices.length > 1
          ? indices.flatMap((i) =>
              chartItems[i].points.filter((p) => Number.isFinite(p.y))
            )
          : undefined;
      return {
        count: indices.length,
        hitLayerIndex: indices.length > 0 ? indices[0] : -1,
        bandPoints
      };
    }, [chartItems]);

    useEffect(() => {
      chartRefs.current?.forEach((ref, i) => {
        if (typeof ref?.zoomHandle.doZoom === "function") {
          ref.zoomHandle.doZoom(zoomedScales[i]);
        }
      });
    }, [zoomedScales]);

    const addToRefs = (id: string, el: ChartZoomHandle | null) => {
      if (el) {
        chartRefs.current.push({ id, zoomHandle: el });
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
                  ref={(node) => addToRefs(id, node)}
                  id={id}
                  chartItem={chartItem}
                  scales={initialScales[i]}
                />
              );
            case "bar":
              return (
                <BarChart
                  key={chartItem.key}
                  ref={(node) => addToRefs(id, node)}
                  id={id}
                  chartItem={chartItem}
                  scales={initialScales[i]}
                  rendersHitLayer={
                    barPositions.count < 2 || barPositions.hitLayerIndex === i
                  }
                  bandPoints={barPositions.bandPoints}
                />
              );
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
                  ref={(node) => addToRefs(id, node)}
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
                  ref={(node) => addToRefs(id, node)}
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
                  ref={(node) => addToRefs(id, node)}
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

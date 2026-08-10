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

    // Bar series are centred on their x, so several on one axis land on the SAME pixels
    // and the later-painted one covers the earlier one wherever its value is greater or
    // equal. Give each its position among the bar series so BarChart can inset them
    // (declaration order = paint order = widest-to-narrowest, back-to-front), share ONE
    // set of points to measure the band from, and let exactly ONE draw the click targets.
    //
    // The hit layer goes to the BACKMOST bar series, never to "the one with the most
    // points". A full-height hit rect is a PAINTED element (`fill="transparent"` still
    // satisfies `pointer-events: visiblePainted`), so whichever series draws it last owns
    // every click on the plot: the series behind it become unclickable and clicks resolve
    // to the wrong series' nearest point. Drawn by the backmost series it can cover
    // nothing. This is why the composer must declare the series with the finest x tiling
    // first — it is both the backdrop and the click surface.
    //
    // All inert for a single bar series, which is every chart that exists today bar one.
    const barPositions = useMemo(() => {
      const indices = chartItems
        .map((c, i) => (c.type === "bar" ? i : -1))
        .filter((i) => i >= 0);
      const order = new Map<number, number>();
      indices.forEach((i, position) => order.set(i, position));
      // Measured from the union, so every series insets from the SAME band. Deriving it
      // per-series makes the "each series is narrower than the one behind it" guarantee
      // depend on which series happens to hold the tightest pair — it then silently stops
      // holding on data that merely looks different.
      const bandPoints =
        indices.length > 1
          ? indices.flatMap((i) => chartItems[i].points)
          : undefined;
      return {
        order,
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
                  seriesIndex={barPositions.order.get(i) ?? 0}
                  seriesCount={barPositions.count}
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

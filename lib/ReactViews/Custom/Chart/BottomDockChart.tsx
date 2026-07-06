import { RectClipPath } from "@visx/clip-path";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { withParentSize, WithParentSizeProvidedProps } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import groupBy from "lodash-es/groupBy";
import minBy from "lodash-es/minBy";
import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";
import type { ChartPoint } from "../../../Charts/ChartData";
import type { ChartAxis, ChartItem } from "../../../ModelMixins/ChartableMixin";
import Styles from "./bottom-dock-chart.scss";
import Legends from "./Legends";
import Tooltip from "./Tooltip";
import type { XScale, YScale } from "./types";
import { Cursor, Plot, PointsOnMap, XAxis, YAxis } from "./utils";
import { ZoomX } from "./ZoomX";

const CHART_MIN_WIDTH = 110;
const DEFAULT_GRID_COLOR = "#efefef";
const Y_AXIS_NUM_TICKS = 4;
const Y_AXIS_TICK_LABEL_FONT_SIZE = 10;

interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface BottomDockChartProps extends WithParentSizeProvidedProps {
  chartItems: readonly ChartItem[];
  xAxis: ChartAxis;
  height: number;

  width?: number;
  margin?: Margin;
  onXDomainChange?: (domain: [number, number] | undefined) => void;
  onPlotFracChange?: (frac: [number, number] | undefined) => void;
  /**
   * Optional epoch-ms of the timeline clock's currently-SELECTED time. When
   * provided (and the x-axis is time), the chart draws a PERMANENT vertical
   * marker at that date — always visible, distinct from the transient hover
   * cursor — so the user can see which date the bottom time slider is on
   * against the bars. `undefined` (every caller that doesn't pass it) → no
   * marker, byte-identical to before.
   */
  selectedTimeMs?: number;
}

const _BottomDockChart: React.FC<BottomDockChartProps> = observer(
  ({
    chartItems,
    xAxis,
    parentWidth = 0,
    width,
    height,
    margin,
    onXDomainChange,
    onPlotFracChange,
    selectedTimeMs
  }) => {
    return (
      <Chart
        chartItems={chartItems}
        xAxis={xAxis}
        height={height}
        margin={margin}
        width={Math.max(CHART_MIN_WIDTH, width || parentWidth)}
        onXDomainChange={onXDomainChange}
        onPlotFracChange={onPlotFracChange}
        selectedTimeMs={selectedTimeMs}
      />
    );
  }
);

export const BottomDockChart = withParentSize(_BottomDockChart);
BottomDockChart.displayName = "BottomDockChart";

const DEFAULT_MARGIN: Margin = { left: 20, right: 30, top: 10, bottom: 50 };

interface ChartProps {
  chartItems: readonly ChartItem[];
  xAxis: ChartAxis;
  width: number;
  height: number;
  margin?: Margin;
  /**
   * Fired with the chart's current d3 x-domain `[startMs, stopMs]` on a
   * wheel-zoom/pan (time axis only; `undefined` on reset). The caller MUST
   * pass a STABLE (memoized) callback — an inline arrow is a new function
   * identity every render, which re-fires the reset `useEffect` (keyed on
   * `onXDomainChange`) and clears the zoom. `ChartPanel` uses `useCallback`.
   */
  onXDomainChange?: (domain: [number, number] | undefined) => void;
  /**
   * Fired with the chart's plot-area extent `[leftFrac, rightFrac]` (fractions
   * of the chart width where the plotted region begins/ends), or `undefined`
   * for a non-time chart. Lets a scrubber pixel-align to the plot band rather
   * than the chart edges. As with `onXDomainChange`, the caller MUST pass a
   * STABLE (memoized) callback — an inline arrow re-fires the publishing
   * `useEffect` (which lists `onPlotFracChange` in its deps) every render.
   */
  onPlotFracChange?: (frac: [number, number] | undefined) => void;
  /** Epoch-ms of the selected timeline time → a permanent vertical marker. */
  selectedTimeMs?: number;
}

const Chart: React.FC<ChartProps> = observer(
  ({
    chartItems: propsChartItems,
    xAxis,
    width,
    height,
    margin = DEFAULT_MARGIN,
    onXDomainChange,
    onPlotFracChange,
    selectedTimeMs
  }) => {
    const [zoomedXScale, setZoomedXScale] = useState<XScale | undefined>(
      undefined
    );
    const [mouseCoords, setMouseCoords] = useState<
      { x: number; y: number } | undefined
    >(undefined);

    const processedChartItems: ChartItem[] = useMemo(() => {
      return sortChartItemsByType(propsChartItems)
        .filter((chartItem) => chartItem.points.length > 0)
        .map((chartItem) => {
          return {
            ...chartItem,
            points: chartItem.points.slice().sort((p1, p2) => +p1.x - +p2.x)
          };
        });
    }, [propsChartItems]);

    const plotHeight =
      height - margin.top - margin.bottom - Legends.maxHeightPx;

    const yAxes = useMemo(() => {
      const range = [plotHeight, 0];
      const chartItemsByUnit = groupBy(processedChartItems, "units");
      return Object.entries(chartItemsByUnit).map(([units, chartItems]) => {
        return {
          units: units === "undefined" ? undefined : units,
          scale: scaleLinear({ domain: calculateDomainY(chartItems), range }),
          color: chartItems[0].getColor()
        };
      });
    }, [plotHeight, processedChartItems]);

    // We need to consider only the left most Y-axis as its label values appear
    // outside the chart plot area. The labels of inner y-axes appear inside
    // the plot area.
    const estimatedYAxesWidth = useMemo(() => {
      const leftmostYAxis = yAxes[0];
      const maxLabelDigits = Math.max(
        0,
        ...leftmostYAxis.scale
          .ticks(Y_AXIS_NUM_TICKS)
          .map((n) => n.toString().length)
      );
      return maxLabelDigits * Y_AXIS_TICK_LABEL_FONT_SIZE;
    }, [yAxes]);

    const plotWidth = width - margin.left - margin.right - estimatedYAxesWidth;

    const adjustedMargin = useMemo(
      () => ({
        ...margin,
        left: margin.left + estimatedYAxesWidth
      }),
      [estimatedYAxesWidth, margin]
    );

    // Plot-area extent as fractions of the chart's own width: the left gutter
    // is `adjustedMargin.left` (margin.left + the y-axis label width), the
    // right edge is `adjustedMargin.left + plotWidth`. A scrubber that follows
    // the chart's zoom reads these (via `onPlotFracChange` → Terria) to inset
    // its ticks into the same plot band, so a date on the rail lines up with
    // the same date on the chart. Fall back to [0, 1] if width isn't measured.
    const leftFrac = width > 0 ? adjustedMargin.left / width : 0;
    const rightFrac = width > 0 ? (adjustedMargin.left + plotWidth) / width : 1;

    const initialXScale: XScale = useMemo(() => {
      const params = {
        domain: calculateDomainX(processedChartItems),
        range: [0, plotWidth]
      };
      if (xAxis.scale === "linear") return scaleLinear(params);
      else return scaleTime(params);
    }, [xAxis, processedChartItems, plotWidth]);

    const xScale = zoomedXScale || initialXScale;

    const initialScales: ReadonlyArray<{ x: XScale; y: YScale }> = useMemo(
      () =>
        processedChartItems.map((c: ChartItem) => ({
          x: initialXScale,
          y: yAxes.find((y) => y.units === c.units)!.scale
        })),
      [processedChartItems, initialXScale, yAxes]
    );

    const zoomedScales: ReadonlyArray<{ x: XScale; y: YScale }> = useMemo(
      () =>
        processedChartItems.map((c: ChartItem) => ({
          x: xScale,
          y: yAxes.find((y) => y.units === c.units)!.scale
        })),
      [processedChartItems, xScale, yAxes]
    );

    const pointsNearMouse = useMemo(() => {
      if (!mouseCoords) return [];
      return processedChartItems
        .map((chartItem: ChartItem) => ({
          chartItem,
          point: findNearestPoint(chartItem.points, mouseCoords, xScale, 7)
        }))
        .filter(pointNotUndefined);
    }, [processedChartItems, mouseCoords, xScale]);

    const cursorX =
      pointsNearMouse.length > 0
        ? xScale(pointsNearMouse[0].point.x)
        : mouseCoords?.x;

    // Permanent vertical marker at the timeline clock's selected time (opt-in
    // via `selectedTimeMs`; time axis only). `xScale` maps epoch-ms → plot-px
    // (scaleTime accepts a number). The selected time is a detection INSTANT
    // (carries a time-of-day), but a daily chart's domain-max is the last bar's
    // date at MIDNIGHT — so the marker for the LATEST date lands up to ~1 day
    // past the right edge and, under a strict `<= plotWidth` guard, was hidden
    // at the default (latest-date) view. Show the marker whenever the selected
    // time is within the data's date range inclusive of the last date's full
    // day (a 1-day grace at each bound), and CLAMP its x into the plot band so a
    // within-a-day instant pins to the nearest edge rather than vanishing. A
    // clock time genuinely outside the data (> a day past either bound) still
    // draws no marker.
    const selectedX =
      selectedTimeMs != null &&
      Number.isFinite(selectedTimeMs) &&
      xAxis.scale === "time"
        ? xScale(selectedTimeMs)
        : undefined;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const [domainMinMs, domainMaxMs] =
      xAxis.scale === "time"
        ? calculateDomainX(processedChartItems)
        : [NaN, NaN];
    const selectedInRange =
      selectedTimeMs != null &&
      Number.isFinite(selectedTimeMs) &&
      Number.isFinite(domainMinMs) &&
      Number.isFinite(domainMaxMs) &&
      selectedTimeMs >= domainMinMs - DAY_MS &&
      selectedTimeMs <= domainMaxMs + DAY_MS;
    const showSelectedMarker = selectedX != null && selectedInRange;
    const selectedMarkerX = showSelectedMarker
      ? Math.min(plotWidth, Math.max(0, selectedX))
      : undefined;

    const tooltip = useMemo(() => {
      const margin = adjustedMargin;
      const tooltip: {
        items: { chartItem: ChartItem; point: ChartPoint }[];
        right?: number;
        left?: number;
        bottom?: number;
      } = {
        items: pointsNearMouse
      };

      if (!mouseCoords || mouseCoords.x < plotWidth * 0.5) {
        tooltip.right = width - (plotWidth + margin.right);
      } else {
        tooltip.left = margin.left;
      }

      tooltip.bottom = height - (margin.top + plotHeight);
      return tooltip;
    }, [
      adjustedMargin,
      pointsNearMouse,
      mouseCoords,
      width,
      plotWidth,
      height,
      plotHeight
    ]);

    const setMouseCoordsFromEvent = (event: any) => {
      const coords = localPoint(
        event.target.ownerSVGElement || event.target,
        event
      );
      if (!coords) return;
      setMouseCoords({
        x: coords.x - adjustedMargin.left,
        y: coords.y - adjustedMargin.top
      });
    };

    useEffect(() => {
      setZoomedXScale(undefined);
      onXDomainChange?.(undefined);
    }, [processedChartItems, onXDomainChange]);

    // Publish the plot-area fractions for a plot-aligned scrubber. Done in an
    // effect (not during render) to avoid a mobx write-in-render when the
    // callback sets a Terria observable. Only a TIME-axis chart publishes a
    // band — this gate is correct because the al-shaheen SAR detections chart
    // is backend-configured `xAxisColumn: "date"` (a time scale); a linear-x
    // chart intentionally publishes `undefined` (no window/frac to align to).
    useEffect(() => {
      onPlotFracChange?.(
        xAxis.scale === "time" ? [leftFrac, rightFrac] : undefined
      );
    }, [leftFrac, rightFrac, xAxis.scale, onPlotFracChange]);

    if (processedChartItems.length === 0)
      return <div className={Styles.empty}>No data available</div>;

    // Bound the zoom to the plot band so the chart can never be panned off its
    // data. The zoom transform lives in #zoomSurface's LOCAL coordinate space
    // (d3 reads pointer coords via the element's CTM), where the plot band is
    // [0, plotWidth] × [0, plotHeight] — so the viewport `extent` and the
    // world `translateExtent` are BOTH that box, and with the two identical
    // d3's constraint forces the exact identity transform at k=1: a wheel
    // zoom-out always settles back on the initial view. The previous
    // [[0,0],[Infinity,Infinity]] translateExtent (+ d3's default owner-svg
    // extent) let a zoom-out anchored away from the zoom-in point settle at
    // k=1 with a residual translate — the chart stuck panned into empty space
    // past the data with no gesture able to bring it home (the 2026-07-06
    // chart↔scrubber de-sync; the defect itself is tenant-agnostic). Guarded:
    // an unmeasured/degenerate layout falls back to the unbounded behaviour
    // rather than handing d3 a negative extent.
    // LOAD-BEARING: `extent` and `translateExtent` MUST stay the SAME box —
    // both are `zoomBox` below on purpose. d3 forces identity at k=1 only
    // when the two are identical; hand them different values and zoom-out
    // silently stops returning to the initial view (the original bug).
    const zoomBounded = plotWidth > 0 && plotHeight > 0;
    const zoomBox: [[number, number], [number, number]] = [
      [0, 0],
      [plotWidth, plotHeight]
    ];

    return (
      <ZoomX
        surface="#zoomSurface"
        initialScale={initialXScale}
        scaleExtent={[1, Infinity]}
        extent={zoomBounded ? zoomBox : undefined}
        translateExtent={
          zoomBounded
            ? zoomBox
            : [
                [0, 0],
                [Infinity, Infinity]
              ]
        }
        // Wrap setZoomedXScale in a function to ensure React stores the D3 scale function as a value.
        // If passed directly, React treats functions as state updaters, causing zoom to break.
        onZoom={(newXScale) => {
          setZoomedXScale(() => newXScale);
          if (onXDomainChange && xAxis.scale === "time") {
            const dom = newXScale.domain();
            onXDomainChange([Number(dom[0]), Number(dom[1])]);
          }
        }}
      >
        <Legends width={plotWidth} chartItems={processedChartItems} />
        <div style={{ position: "relative" }}>
          <svg
            width="100%"
            height={height}
            onMouseMove={setMouseCoordsFromEvent}
            onMouseLeave={() => setMouseCoords(undefined)}
          >
            <Group left={adjustedMargin.left} top={adjustedMargin.top}>
              <RectClipPath
                id="plotClip"
                width={plotWidth}
                height={plotHeight}
              />
              <XAxis
                top={plotHeight + 1}
                scale={xScale}
                label={xAxis.units || (xAxis.scale === "time" ? "Date" : "")}
              />
              {yAxes.map((y, i) => (
                <YAxis
                  {...y}
                  key={`y-axis-${y.units}`}
                  color={yAxes.length > 1 ? y.color : DEFAULT_GRID_COLOR}
                  offset={i * 50}
                />
              ))}
              {yAxes.map((y) => (
                <GridRows
                  key={`grid-${y.units}`}
                  width={plotWidth}
                  height={plotHeight}
                  scale={y.scale}
                  numTicks={Y_AXIS_NUM_TICKS}
                  stroke={yAxes.length > 1 ? y.color : DEFAULT_GRID_COLOR}
                  lineStyle={{ opacity: 0.3 }}
                />
              ))}
              <svg
                id="zoomSurface"
                clipPath="url(#plotClip)"
                pointerEvents="all"
              >
                <rect
                  width={plotWidth}
                  height={plotHeight}
                  fill="transparent"
                />
                {showSelectedMarker && (
                  <Cursor
                    x={selectedMarkerX!}
                    stroke="#ffffff"
                    strokeWidth={2}
                    strokeOpacity={0.95}
                  />
                )}
                {cursorX && <Cursor x={cursorX} stroke={DEFAULT_GRID_COLOR} />}
                <Plot
                  chartItems={processedChartItems}
                  initialScales={initialScales}
                  zoomedScales={zoomedScales}
                />
              </svg>
            </Group>
          </svg>
          <Tooltip {...tooltip} />
          <PointsOnMap chartItems={processedChartItems} />
        </div>
      </ZoomX>
    );
  }
);

Chart.displayName = "Chart";

// Type guard to filter ChartItems that don't produce a nearestPoint
const pointNotUndefined = (itemPoint: {
  chartItem: ChartItem;
  point?: ChartPoint;
}): itemPoint is { chartItem: ChartItem; point: ChartPoint } =>
  itemPoint.point !== undefined;

/**
 * Sorts chartItems so that `momentPoints` are rendered on top then
 * `momentLines` and then any other types.
 * @param {ChartItem[]} chartItems array of chartItems to sort
 */
const sortChartItemsByType = (chartItems: readonly ChartItem[]) => {
  return chartItems.slice().sort((a, b) => {
    if (a.type === "momentPoints") return 1;
    else if (b.type === "momentPoints") return -1;
    else if (a.type === "momentLines") return 1;
    else if (b.type === "momentLines") return -1;
    return 0;
  });
};

/**
 * Calculates a combined domain of all chartItems.
 * Convert Dates to numbers
 */
const calculateDomainX = (chartItems: ChartItem[]) => {
  const xmin = Math.min(...chartItems.map((c) => +c.domain.x[0]));
  const xmax = Math.max(...chartItems.map((c) => +c.domain.x[1]));
  return [xmin, xmax];
};

const calculateDomainY = (chartItems: ChartItem[]) => {
  const ymin = Math.min(...chartItems.map((c) => c.domain.y[0]));
  const ymax = Math.max(...chartItems.map((c) => c.domain.y[1]));
  return [ymin, ymax];
};

const findNearestPoint = (
  points: readonly ChartPoint[],
  coords: ChartPoint,
  xScale: XScale,
  maxDistancePx: number
) => {
  function distance(coords: ChartPoint, point: ChartPoint) {
    // Works with numbers or Dates
    return point ? +coords.x - +xScale(point.x) : Infinity;
  }

  let left = 0;
  let right = points.length;
  let mid = 0;
  while (left !== right) {
    mid = left + Math.floor((right - left) / 2);
    const dist = distance(coords, points[mid]);
    if (dist === 0) {
      break;
    } else if (dist < 0) {
      right = mid;
    } else {
      left = mid + 1;
    }
  }

  const leftPoint = points[mid - 1];
  const midPoint = points[mid];
  const rightPoint = points[mid + 1];

  const nearestPoint = minBy([leftPoint, midPoint, rightPoint], (p) =>
    p ? Math.abs(distance(coords, p)) : Infinity
  );

  return nearestPoint !== undefined &&
    Math.abs(distance(coords, nearestPoint)) <= maxDistancePx
    ? nearestPoint
    : undefined;
};

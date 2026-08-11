import { RectClipPath } from "@visx/clip-path";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { withParentSize, WithParentSizeProvidedProps } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import groupBy from "lodash-es/groupBy";
import minBy from "lodash-es/minBy";
import { observer } from "mobx-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { columnForInstant, columnSpanMs } from "../../../Charts/barColumnSnap";
import type { ChartPoint } from "../../../Charts/ChartData";
import {
  defaultTimeWindow,
  latestPointMs
} from "../../../Charts/chartZoomWindow";
import type { ChartAxis, ChartItem } from "../../../ModelMixins/ChartableMixin";
import Styles from "./bottom-dock-chart.scss";
import { zoomIdentity } from "d3-zoom";
import { chartDataSignature } from "./chartDataSignature";
import Legends from "./Legends";
import Tooltip from "./Tooltip";
import type { XScale, YScale } from "./types";
import { Cursor, Plot, PointsOnMap, XAxis, YAxis } from "./utils";
import { ZoomX, type ZoomXApi } from "./ZoomX";

const CHART_MIN_WIDTH = 110;
/** Zoom-control button edge, px. Sized for a comfortable pointer target
 *  (the WCAG 2.5.8 minimum is 24); the first version was 22 and read as
 *  cramped against the map's own zoom stack. */
const CONTROL_SIZE = 30;
/** Must sit ABOVE any right-docked side panel. The controls live at the
 *  plot's right edge, which on a dashboard with a docked review/queue panel
 *  is underneath it — a lower value renders them perfectly and makes them
 *  unclickable. */
const Z_ABOVE_DOCKED_PANELS = 20;
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
   * Plot area in ABSOLUTE VIEWPORT pixels, `[left, right]`.
   *
   * Supersedes `onPlotFracChange` for any consumer mapping a date to a screen position.
   * Those fractions are fractions of the `width` PROP, but this component renders its root
   * `<svg width="100%">` — so when the prop and the rendered width differ (measured 1243 vs
   * 1450 on the al-Shaheen dock) a consumer multiplying the fractions by the element it
   * measures is wrong by exactly that ratio, and NO element in the DOM carries the prop's
   * value for it to find. The error is a SCALE error, so it grows with x: it was 0px at the
   * left edge and 190px at the right. Publishing absolute pixels removes the shared-base
   * assumption rather than asking each consumer to guess the base correctly.
   *
   * Same stable-callback requirement as the callbacks above.
   */
  onPlotBandChange?: (band: [number, number] | undefined) => void;
  /**
   * Optional: publishes the chart's ACTIVE x-domain — the zoomed domain when a
   * d3 zoom is applied, else the initial (data-extent-padded) domain — as
   * [startMs, stopMs], on every domain change including first mount. This is
   * the missing half of `onXDomainChange` (which only fires on ZOOM events): a
   * consumer that must map a DATE to a pixel inside the plot band (e.g. a
   * scrubber rail aligning its ticks under the bars) needs the padded initial
   * domain too — reconstructing the padding heuristically is exactly the
   * misalignment class this callback removes. Time-axis charts only; a
   * linear-x chart publishes `undefined`.
   */
  onActiveXDomainChange?: (domain: [number, number] | undefined) => void;
  /**
   * Optional epoch-ms of the timeline clock's currently-SELECTED time. When
   * provided (and the x-axis is time), the chart draws a PERMANENT vertical
   * marker at that date — always visible, distinct from the transient hover
   * cursor — so the user can see which date the bottom time slider is on
   * against the bars. `undefined` (every caller that doesn't pass it) → no
   * marker, byte-identical to before.
   */
  selectedTimeMs?: number;
  /**
   * Optional: open the chart on the last N days OF THE DATA (anchored at the
   * latest observation, never the wall clock) instead of the full extent —
   * applied as an initial zoom TRANSFORM through the same d3 behavior as the
   * wheel, so identity remains the full archive: zooming out reaches all
   * history, and the reset control returns to this window. `undefined`
   * (every caller that doesn't pass it) → full extent, byte-identical to
   * before. The VALUE is deliberately a prop, not a constant: "last 90 days"
   * is right for a monitoring feed and wrong for a 5-year trend chart, so the
   * capability lives here and each tenant supplies its own number.
   */
  defaultTimeWindowDays?: number;
  /**
   * Optional: called when the user presses the reset control, AFTER the chart
   * has restored its own time window. The chart owns its axis; the CLOCK
   * belongs to the timeline, so a consumer that wants "reset" to mean "the
   * view I had at login" restores that here.
   */
  onResetView?: () => void;
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
    onPlotBandChange,
    onActiveXDomainChange,
    selectedTimeMs,
    defaultTimeWindowDays,
    onResetView
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
        onPlotBandChange={onPlotBandChange}
        onActiveXDomainChange={onActiveXDomainChange}
        selectedTimeMs={selectedTimeMs}
        defaultTimeWindowDays={defaultTimeWindowDays}
        onResetView={onResetView}
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
  /**
   * Plot area in ABSOLUTE VIEWPORT pixels, `[left, right]`.
   *
   * Supersedes `onPlotFracChange` for any consumer mapping a date to a screen position.
   * Those fractions are fractions of the `width` PROP, but this component renders its root
   * `<svg width="100%">` — so when the prop and the rendered width differ (measured 1243 vs
   * 1450 on the al-Shaheen dock) a consumer multiplying the fractions by the element it
   * measures is wrong by exactly that ratio, and NO element in the DOM carries the prop's
   * value for it to find. The error is a SCALE error, so it grows with x: it was 0px at the
   * left edge and 190px at the right. Publishing absolute pixels removes the shared-base
   * assumption rather than asking each consumer to guess the base correctly.
   *
   * Same stable-callback requirement as the callbacks above.
   */
  onPlotBandChange?: (band: [number, number] | undefined) => void;
  /**
   * Fired with the ACTIVE x-domain [startMs, stopMs] (zoomed if zoomed, else
   * the padded initial domain), on mount and on every domain change; the same
   * stable-callback requirement as the two callbacks above.
   */
  onActiveXDomainChange?: (domain: [number, number] | undefined) => void;
  /** Epoch-ms of the selected timeline time → a permanent vertical marker. */
  selectedTimeMs?: number;
  /** Last-N-days-of-data initial window; see `BottomDockChartProps`. */
  defaultTimeWindowDays?: number;
  /** Called after the reset control restores the window; see `BottomDockChartProps`. */
  onResetView?: () => void;
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
    onPlotBandChange,
    onActiveXDomainChange,
    selectedTimeMs,
    defaultTimeWindowDays,
    onResetView
  }) => {
    const [zoomedXScale, setZoomedXScale] = useState<XScale | undefined>(
      undefined
    );
    const [mouseCoords, setMouseCoords] = useState<
      { x: number; y: number } | undefined
    >(undefined);
    // The rendered root svg — the ONLY element that knows the plot's true screen base.
    // `width="100%"` means its box is the container's, which is NOT the `width` prop the
    // margins and plotWidth were computed against; measuring it here and publishing an
    // absolute band is what saves every consumer from having to reconcile the two.
    const rootSvgRef = useRef<SVGSVGElement | null>(null);
    // Imperative handle onto the ONE d3 zoom behavior (populated by ZoomX).
    // The zoom buttons, the default window and follow-the-clock all drive the
    // behavior through this — never a parallel scale write (the de-sync
    // class #48/#59 closed).
    const zoomApiRef = useRef<ZoomXApi | null>(null);

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
      const scale =
        xAxis.scale === "linear" ? scaleLinear(params) : scaleTime(params);
      // Nice the domain ONCE, here, at construction. `XAxis` renders
      // `scale.nice()` and d3's .nice() MUTATES IN PLACE — so before this
      // line, anything computed in THIS component's render body on the FIRST
      // render (the selected-date marker's x, most visibly) used the PRE-nice
      // domain while every bar, tick and gridline drawn by the children used
      // the POST-nice one. Nothing re-rendered at boot (the timeline clock
      // pins before the chart's first paint), so the marker sat ~190px right
      // of its bar until a hover forced a re-render — the THIRD instance of
      // this mutation class, after the active-domain publish (#57) and the
      // zoom publish (#59). Nicing at construction makes the first paint
      // identical to every later paint; XAxis's render-nice becomes an
      // idempotent no-op on this scale (nicing an already-nice domain leaves
      // it unchanged) and still serves the zoomed scale exactly as before.
      scale.nice();
      return scale;
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
    // at the default (latest-date) view.
    //
    // Show the marker whenever the selected time is within the ACTIVE (possibly-
    // zoomed) domain inclusive of a 1-day grace at each bound, and CLAMP its x
    // into the plot band so a within-a-day instant pins to the nearest edge
    // rather than vanishing. Range-checking the ACTIVE `xScale.domain()` (not the
    // full un-zoomed data domain) is deliberate (guardian/sonnet #26): at the
    // un-zoomed default it IS the full data domain, so the latest-date instant
    // (≤ 1 day past the last midnight bar) shows clamped to the right edge; when
    // the user zooms into a sub-window that EXCLUDES the selected date, the date
    // falls outside the visible domain → the marker HIDES rather than pinning a
    // misleading marker to an edge. A clock time genuinely > 1 day outside the
    // visible range draws no marker.
    // A bar sits at the START of its period, so drawing the marker at the
    // instant's own x puts it up to a full period to the RIGHT of the bar it
    // belongs to — on the al-Shaheen daily chart the ~14:30Z ascending passes
    // land a median 0.61 day past their own bar. Snap to the column that
    // CONTAINS the instant, using the same predicate the bar click uses
    // (lib/Charts/barColumnSnap.ts) — see that module on why agreement rests on
    // each instant lying in its own column, not on the predicate alone. Falls back to the instant's
    // exact x when no column contains it (a non-bar chart, or a frame the
    // containment rule does not cover) — previous behaviour, unchanged.
    // Only BAR items define columns; with none (a line-only chart) the list is
    // empty, `columnForInstant` returns undefined and the marker keeps its
    // exact-instant x — byte-identical to before for every non-bar chart.
    const barColumns = useMemo(() => {
      const starts = processedChartItems
        .filter((c) => c.type === "bar")
        .flatMap((c) =>
          c.points.map((p) =>
            p.x instanceof Date ? p.x.getTime() : Number(p.x)
          )
        );
      return { starts, spanMs: columnSpanMs(starts) };
    }, [processedChartItems]);
    const markerTimeMs =
      selectedTimeMs != null && Number.isFinite(selectedTimeMs)
        ? (columnForInstant(
            selectedTimeMs,
            barColumns.starts,
            barColumns.spanMs
          ) ?? selectedTimeMs)
        : selectedTimeMs;
    const selectedX =
      markerTimeMs != null &&
      Number.isFinite(markerTimeMs) &&
      xAxis.scale === "time"
        ? xScale(markerTimeMs)
        : undefined;
    const DAY_MS = 24 * 60 * 60 * 1000;
    // `xScale.domain()` may return Date[] or number[] (scaleTime) → coerce via
    // Number. This reuses the already-built scale (no second `calculateDomainX`).
    const activeDomain =
      xAxis.scale === "time" ? xScale.domain().map(Number) : [NaN, NaN];
    const selectedInRange =
      selectedTimeMs != null &&
      Number.isFinite(selectedTimeMs) &&
      Number.isFinite(activeDomain[0]) &&
      Number.isFinite(activeDomain[1]) &&
      selectedTimeMs >= activeDomain[0] - DAY_MS &&
      selectedTimeMs <= activeDomain[1] + DAY_MS;
    // `selectedMarkerX` is defined iff the marker should render — the JSX renders
    // on `selectedMarkerX != null` (no non-null assertion needed).
    const selectedMarkerX =
      selectedX != null && selectedInRange
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

    // A zoom is a USER gesture: it must survive any re-render that does not
    // change what is plotted. This reset used to key on the `processedChartItems`
    // ARRAY IDENTITY, which is a new object on every parent render — `ChartPanel`
    // builds its `chartItems` with `.filter(...)`, and `.filter` always
    // allocates. Since `ChartPanel` is a mobx `observer` that reads the timeline
    // clock (for the selected-date marker), EVERY scrub re-rendered it and so
    // cleared the zoom. Clicking a bar scrubs the clock, so the user's own click
    // zoomed the chart back out — and `onXDomainChange?.(undefined)` fired with
    // it, resetting the published domain, which de-synced any scrubber aligned
    // to it. Reported 2026-08-10 on al-shaheen; the defect is tenant-agnostic
    // (any dashboard whose chart panel re-renders for an unrelated reason).
    //
    // Key on a stable SIGNATURE of the plotted data plus the plot geometry:
    //  - series key + point count + x-extent → a genuine data change (series
    //    added/removed, different span) still resets, which is correct: the old
    //    zoom window may no longer exist in the new domain.
    //  - `plotWidth` → a resize invalidates `zoomedXScale`, whose d3 range was
    //    built against the OLD width; without this the chart would keep drawing
    //    at the stale range. (The identity-keyed version got this for free.)
    //
    // Scope of the guarantee, stated precisely because it is easy to overclaim:
    // an unchanged key means the zoom is PRESERVED, but "y-values changed" does
    // NOT imply "no reset". `plotWidth` subtracts `estimatedYAxesWidth`, which
    // is derived from the y tick labels and therefore from the y VALUES — so a
    // y-only refresh that widens the tick labels (max 9 → ticks 0,2,4,6,8, one
    // digit; max 12 → ticks 0,5,10, two digits) shifts `plotWidth` and does
    // reset. That errs safe (resets more, never less) and is the honest
    // behaviour to document.
    //
    // Also reset d3's own transform: `ZoomX`'s cleanup only detaches listeners
    // (`selection.on(".zoom", null)`) and deliberately preserves the node's
    // `__zoom`, so clearing React state alone leaves d3 still holding e.g.
    // k=4. The chart would redraw un-zoomed and then JUMP straight back to 4×
    // on the user's next wheel tick, on a dataset it was never zoomed into.
    // Harmless while this effect fired on every render (state and `__zoom`
    // were permanently out of step anyway); now that it fires only on a real
    // data change, that path is reachable, so it is closed here.
    const chartDataKey = useMemo(
      () => chartDataSignature(processedChartItems),
      [processedChartItems]
    );

    useEffect(() => {
      setZoomedXScale(undefined);
      onXDomainChange?.(undefined);
      // `__zoom` is exactly what d3-zoom reads back as the current transform
      // (its `defaultTransform` returns `this.__zoom || identity`), so writing
      // identity onto the node is the whole reset. Guarded because the surface
      // is not mounted on the first pass or for an empty chart.
      const surface = document.getElementById("zoomSurface") as
        | (Element & { __zoom?: unknown })
        | null;
      if (surface && surface.__zoom !== undefined) {
        surface.__zoom = zoomIdentity;
      }
    }, [chartDataKey, plotWidth, onXDomainChange]);

    // The configured default window, or undefined when the caller passed no
    // window / the data has no finite x — "no window" simply means the chart
    // opens on its full extent, exactly as before this prop existed.
    const defaultWindow = useMemo(
      () =>
        xAxis.scale === "time"
          ? defaultTimeWindow(
              latestPointMs(processedChartItems),
              defaultTimeWindowDays
            )
          : undefined,
      [xAxis.scale, processedChartItems, defaultTimeWindowDays]
    );

    // Apply the default window AFTER the reset effect above (declaration
    // order is execution order): on mount, on a genuine data change, and on a
    // resize, the sequence is reset-to-identity → apply-the-window, so the
    // window is always computed against the CURRENT data and plot geometry.
    // Routed through the d3 behavior (zoomToDomain fires the "zoom" event),
    // so the zoomed scale, the post-commit domain publish and any scrubber
    // aligned to it all see it exactly like a wheel gesture.
    //
    // Keyed on a PRIMITIVE signature of the window, never the array identity.
    // `defaultWindow` is derived from `processedChartItems`, which is a fresh
    // allocation on every parent render (`ChartPanel` builds its items with
    // `.filter(...)`, and it is a mobx observer that reads the timeline
    // clock), so an identity-keyed effect would re-apply the window on EVERY
    // render — and since clicking a bar scrubs the clock, the user's own
    // click would snap the chart back to 90 days, making the zoom-out control
    // this PR ships unusable. That is the same defect class the chart's reset
    // effect already had to close (terriajs#48); it came back through a new
    // door, and an `exhaustive-deps` suppression was hiding it.
    const defaultWindowKey = defaultWindow
      ? `${defaultWindow[0]}:${defaultWindow[1]}`
      : "";
    useEffect(() => {
      if (!defaultWindowKey) return;
      const [start, stop] = defaultWindowKey.split(":").map(Number);
      zoomApiRef.current?.zoomToDomain([start, stop]);
      // `chartDataKey` + `plotWidth` mirror the reset effect's deps so this
      // fires right after a reset; `defaultWindowKey` is a string, so an
      // unchanged window across re-renders is a stable dep.
    }, [chartDataKey, plotWidth, defaultWindowKey]);

    // Follow the timeline clock while windowed/zoomed: when the selected
    // instant moves OUTSIDE the visible window (a ◀/▶ step, a bar click far
    // away, an external scrub), pan — constrained, same k — to keep it in
    // view. Without this, a windowed chart's marker and rail tick silently
    // vanish off-window on the first step past the edge. At identity
    // (zoomedXScale undefined) everything is already visible: no-op. No
    // feedback loop: the pan changes zoomedXScale, the re-run then finds the
    // instant IN view and does nothing.
    useEffect(() => {
      if (selectedTimeMs == null || !Number.isFinite(selectedTimeMs)) return;
      if (xAxis.scale !== "time") return;
      if (zoomedXScale === undefined) return;
      const [d0, d1] = zoomedXScale.domain().map(Number);
      if (!Number.isFinite(d0) || !Number.isFinite(d1)) return;
      if (selectedTimeMs >= d0 && selectedTimeMs <= d1) return;
      zoomApiRef.current?.centerOn(selectedTimeMs);
    }, [selectedTimeMs, zoomedXScale, xAxis.scale]);

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

    // Zoom WINDOW, published post-nice and post-render for the same reason as the active
    // domain: `.nice()` mutates the scale during `XAxis`'s render, so the value handed to
    // the d3 event handler is not the one drawn. Keyed on `zoomedXScale` so it fires once
    // per zoom change; `undefined` at rest is the contract consumers use to mean "not
    // zoomed", and is preserved — the reset effect still publishes `undefined` directly.
    useLayoutEffect(() => {
      if (!onXDomainChange || xAxis.scale !== "time") return;
      if (zoomedXScale === undefined) return; // rest state: owned by the reset effect
      const dom = zoomedXScale.domain().map(Number);
      if (Number.isFinite(dom[0]) && Number.isFinite(dom[1])) {
        onXDomainChange([dom[0], dom[1]]);
      }
    }, [zoomedXScale, xAxis.scale, onXDomainChange]);

    // Absolute plot band, in VIEWPORT pixels (getBoundingClientRect). Measured AFTER layout (useLayoutEffect) from the
    // rendered svg, then offset by the same `adjustedMargin.left` / `plotWidth` the plot is
    // actually drawn with — user units map 1:1 to CSS px here (no viewBox), so this is the
    // exact band, not an estimate. Recomputed whenever anything that can move it changes,
    // including a window resize, which shifts the box without re-rendering this component.
    useLayoutEffect(() => {
      if (!onPlotBandChange) return;
      const publish = () => {
        const el = rootSvgRef.current;
        if (!el || xAxis.scale !== "time" || !(plotWidth > 0)) {
          onPlotBandChange(undefined);
          return;
        }
        const left = el.getBoundingClientRect().left + adjustedMargin.left;
        onPlotBandChange([left, left + plotWidth]);
      };
      publish();
      window.addEventListener("resize", publish);
      return () => window.removeEventListener("resize", publish);
    }, [onPlotBandChange, adjustedMargin.left, plotWidth, height, xAxis.scale]);

    // Publish the ACTIVE x-domain (zoomed if zoomed, else the padded initial
    // domain) for date→pixel consumers — the missing half of onXDomainChange,
    // which only fires on zoom EVENTS and so never carries the initial padded
    // domain. Same effect-not-render rule as onPlotFracChange above; primitive
    // deps so an identical domain re-render never re-publishes. `activeDomain`
    // is [NaN, NaN] for a non-time axis → publishes undefined.
    const activeDomainStart = Number.isFinite(activeDomain[0])
      ? activeDomain[0]
      : undefined;
    const activeDomainStop = Number.isFinite(activeDomain[1])
      ? activeDomain[1]
      : undefined;
    useLayoutEffect(() => {
      // Read the domain AFTER layout, from the scale object itself, rather than
      // publishing the values captured during render.
      //
      // d3's `.nice()` MUTATES a scale in place, and the domain read during render is
      // taken before the axis renders — so the published domain was the pre-nice one
      // while every bar, tick and gridline was positioned with the post-nice one.
      // Measured on the deployed al-Shaheen chart: data ran 2025-01-02..2026-07-03 (547
      // days) but the rendered axis ran 2025-01-01..2026-10-01 (638 days) — d3 rounds a
      // time domain out to whole tick intervals. A consumer mapping a date to a pixel
      // with the published domain is then wrong by 638/547 = a 16.6% SCALE error: 0px at
      // the left edge and 190px at the right, which is exactly what the discrete tick
      // rail showed.
      //
      // Reading in a layout effect makes this correct whoever mutates the scale and
      // whenever, instead of racing whatever nices it.
      const rendered =
        xAxis.scale === "time" ? xScale.domain().map(Number) : [NaN, NaN];
      const start = Number.isFinite(rendered[0]) ? rendered[0] : undefined;
      const stop = Number.isFinite(rendered[1]) ? rendered[1] : undefined;
      onActiveXDomainChange?.(
        start !== undefined && stop !== undefined ? [start, stop] : undefined
      );
      // `activeDomainStart`/`Stop` stay in the deps as the CHANGE SIGNAL: they are the
      // render-time values, so they still move whenever the underlying data or zoom
      // changes, which is what should trigger a re-publish. They are deliberately no
      // longer the values published.
      // `plotWidth` is in the deps for a case none of the others cover: a resize WHILE
      // ZOOMED changes plotWidth, which rebuilds `initialXScale` — but `xScale` is still
      // the old `zoomedXScale` object, so its identity does not move and this effect
      // would not fire. The zoom reset that clears it is a PASSIVE effect, so for one
      // commit the consumer would hold the new band (published from a layout effect that
      // does list plotWidth) paired with the old domain — a mismatch in exactly the
      // pairing a scrubber uses. Listing it here re-publishes in the same commit.
    }, [
      activeDomainStart,
      activeDomainStop,
      xScale,
      plotWidth,
      xAxis.scale,
      onActiveXDomainChange
    ]);

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
        apiRef={zoomApiRef}
        // Wrap setZoomedXScale in a function to ensure React stores the D3 scale function as a value.
        // If passed directly, React treats functions as state updaters, causing zoom to break.
        onZoom={(newXScale) => {
          // Nice the zoomed scale HERE, where it is created — the second half
          // of the nice-at-construction fix. `transform.rescaleX()` derives a
          // scale from the initial one but does NOT nice it, and `XAxis`
          // renders `scale.nice()`, which MUTATES IN PLACE. So without this,
          // render N computes the marker's x from the pre-nice zoomed domain
          // while the bars and ticks that render after it use the post-nice
          // one — the identical defect this PR fixes for `initialXScale`,
          // re-opened on the path a WINDOWED tenant actually takes. Measured
          // against real d3 on the al-shaheen window: 90.00d -> 91.00d, a
          // 9.3px marker drift, healed only by an unrelated re-render (i.e. a
          // hover), which is exactly the reported symptom at smaller
          // magnitude. Nicing at creation makes XAxis's own nice idempotent
          // and preserves today's rendered domain exactly.
          newXScale.nice();
          // State only. The domain is published from a layout effect below, NOT here:
          // `newXScale` has not been rendered yet, so `XAxis`'s `scale.nice()` has not
          // widened it, and publishing from the event hands consumers a domain narrower
          // than the one every bar and tick is drawn with. Same defect that made the
          // discrete rail 190px out at the right edge before it was fixed for the ACTIVE
          // domain; this is its twin on the zoom path.
          setZoomedXScale(() => newXScale);
        }}
      >
        <Legends width={plotWidth} chartItems={processedChartItems} />
        <div style={{ position: "relative" }}>
          <svg
            ref={rootSvgRef}
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
                {selectedMarkerX != null && (
                  <Cursor
                    x={selectedMarkerX}
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
          {zoomBounded && (
            <ChartZoomControls
              /* RIGHT edge of the plot band (owner call, 2026-08-11).
               *
               * History worth keeping, because the right side is CONTESTED:
               * these first sat in the right MARGIN and were invisible to a
               * real mouse — the expert-review queue panel is `z-index: 10`
               * across x 1548–1850 on al-shaheen, so the buttons rendered
               * with a correct bounding box while `elementsFromPoint`
               * returned the panel. A programmatic `.click()` still drove the
               * zoom, which is exactly how that hides from any test not using
               * a real pointer. They then moved left; the owner asked for
               * right, larger.
               *
               * So they come back to the right WITH the z-index that makes
               * them reachable — the one thing the earlier placement lacked.
               * `Z_ABOVE_DOCKED_PANELS` must stay above any right-docked
               * panel or this silently regresses to unclickable. Verify with
               * `elementsFromPoint`, never with `.click()`. */
              left={adjustedMargin.left + plotWidth - CONTROL_SIZE - 4}
              top={adjustedMargin.top + 4}
              hasDefaultWindow={!!defaultWindow}
              onZoomIn={() => zoomApiRef.current?.scaleBy(1.6)}
              onZoomOut={() => zoomApiRef.current?.scaleBy(1 / 1.6)}
              onReset={() => {
                if (defaultWindow)
                  zoomApiRef.current?.zoomToDomain(defaultWindow);
                else zoomApiRef.current?.resetIdentity();
                // The chart owns its axis; the CLOCK belongs to the timeline.
                // Restoring both is what makes "reset" mean the view you had
                // at login rather than only the axis you had at login.
                onResetView?.();
              }}
            />
          )}
        </div>
      </ZoomX>
    );
  }
);

Chart.displayName = "Chart";

/**
 * Vertical ＋/－/reset stack overlaying the plot's top-right corner — the map
 * zoom-control convention, applied to the chart. Every action drives the ONE
 * d3 zoom behavior (via the ZoomX api), so a button zoom is indistinguishable
 * from a wheel gesture to every consumer downstream (zoomed scale, published
 * domains, any scrubber aligned to them). Positioned in the chart's own
 * prop-coordinate px (like everything drawn in the svg), so it stays glued to
 * the plot band regardless of how the root svg's CSS width relates to the
 * `width` prop. Unconditional: the wheel-zoom it makes discoverable exists on
 * every tenant's chart.
 */
const ChartZoomControls: React.FC<{
  left: number;
  top: number;
  hasDefaultWindow: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}> = ({ left, top, hasDefaultWindow, onZoomIn, onZoomOut, onReset }) => {
  const button: React.CSSProperties = {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    padding: 0,
    border: "1px solid rgba(255,255,255,0.35)",
    borderRadius: 4,
    // Opaque enough to stay legible over bars AND over a docked panel it may
    // overlap — a translucent button on a busy background reads as an artifact.
    background: "rgba(0,0,0,0.72)",
    color: "#ffffff",
    font: "18px/1 Arial, sans-serif",
    cursor: "pointer",
    display: "block"
  };
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        zIndex: Z_ABOVE_DOCKED_PANELS
      }}
    >
      <button
        type="button"
        style={button}
        title="Zoom in"
        aria-label="Zoom in on the chart's time axis"
        onClick={onZoomIn}
      >
        +
      </button>
      <button
        type="button"
        style={button}
        title="Zoom out"
        aria-label="Zoom out on the chart's time axis"
        onClick={onZoomOut}
      >
        −
      </button>
      <button
        type="button"
        style={{ ...button, fontSize: 15 }}
        /* Name what it actually does. `⟲` conventionally reads as "fit all",
         * but with a default window configured this zooms IN to that window
         * from a fully zoomed-out view — surprising unless the label says so. */
        title={hasDefaultWindow ? "Reset to the default time window" : "Reset view"}
        aria-label={
          hasDefaultWindow
            ? "Reset the chart's time axis to its default time window"
            : "Reset the chart's time axis to show all data"
        }
        onClick={onReset}
      >
        ⟲
      </button>
    </div>
  );
};

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
  // Bar charts must be ZERO-BASED: a non-zero baseline misrepresents magnitude
  // (on a [dataMin, dataMax] domain a small-count bar renders at near-zero
  // height, so the bar lengths no longer read as proportional to their values).
  // Floor the shared y-domain at 0 only when a bar item is present; `Math.min(0,
  // ymin)` still admits genuinely-negative data. A line-only panel (every
  // non-bar tenant, e.g. the QE methane chart) keeps the data-driven min, so its
  // domain is byte-identical to before.
  const hasBar = chartItems.some((c) => c.type === "bar");
  return [hasBar ? Math.min(0, ymin) : ymin, ymax];
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

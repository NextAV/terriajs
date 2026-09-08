import { action } from "mobx";
import { observer } from "mobx-react";
import { FC, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
import ChartView from "../../../Charts/ChartView";
import { latestPointMs, stalenessDays } from "../../../Charts/chartZoomWindow";
import {
  nextExpectedObservationMs,
  observationCaption
} from "../../../Charts/observationCadence";
import Result from "../../../Core/Result";
import DiscretelyTimeVaryingMixin from "../../../ModelMixins/DiscretelyTimeVaryingMixin";
import MappableMixin from "../../../ModelMixins/MappableMixin";
import Icon from "../../../Styled/Icon";
import { useViewState } from "../../Context";
import Loader from "../../Loader";
import { BottomDockChart } from "./BottomDockChart";
import Styles from "./chart-panel.scss";
import { ChartPanelDownloadButton } from "./ChartPanelDownloadButton";

const CHART_PANEL_HEIGHT = 300;
const CHART_LEGEND_HEIGHT = 34;

interface ChartPanelProps {
  onHeightChange?: () => void;
  /**
   * Opt-in (the viewer passes it for al-shaheen): replace the static "Charts"
   * section label with the timeline clock's live SELECTED DATE (big + bold) and
   * draw a permanent vertical marker at that date on the chart. Absent/false
   * (every other tenant) → the stock "Charts" label + no marker, byte-identical.
   */
  showSelectedDate?: boolean;
  /**
   * Optional per-tenant value for the chart's initial time window: open on
   * the last N days OF THE DATA instead of the full extent (see
   * `BottomDockChartProps.defaultTimeWindowDays`). The CAPABILITY is
   * unconditional in the chart; this prop is only the tenant's NUMBER —
   * absent (every caller that doesn't pass it) → full extent, byte-identical.
   */
  defaultTimeWindowDays?: number;
  /**
   * Optional noun for the staleness caption, e.g. "pass" renders
   * "last pass: 2026-07-03 (39 days ago)". Absent (every caller that does
   * not pass it) → NO caption at all, byte-identical to before.
   *
   * The caption exists because a chart windowed onto the last N days of its
   * own DATA is always full — which is what makes it readable, and also what
   * makes a stalled feed look current. Rather than move the anchor to the
   * wall clock (which would open the chart on empty space), the window keeps
   * its anchor and the gap is stated.
   */
  stalenessLabel?: string;
  /**
   * Optional: also state when the next observation is EXPECTED, inferred from
   * the timeline's own revisit cadence -- "last pass 7 Sep 2026, 02:30 UTC
   * (36 h ago) · next expected 10 Sep 2026, 14:41 UTC (in 3 days)".
   *
   * Opt-in, so every caller that does not pass it keeps the existing
   * staleness-only caption byte-identically. Two things change when it is on,
   * and both are deliberate:
   *
   * - the caption no longer SUPPRESSES itself on a fresh feed. That was right
   *   while the line was purely a staleness warning, but on a product whose
   *   revisit gaps run 24-84 hours it meant the line vanished for roughly
   *   half of every cycle and read as a glitch rather than as a deliberate
   *   silence. "When did we last look, and when do we look next" is useful
   *   precisely when the feed is healthy.
   * - instants come from the TIMELINE DRIVER rather than the chart's points,
   *   so they carry the observation's time of day. A daily chart plots at
   *   midnight, which cannot distinguish a 14:40 ascending pass from a 02:30
   *   descending one -- and the gap between those is the thing being stated.
   *
   * The second half is a PREDICTION and is worded as one. Backtested over 120
   * days of real Sentinel-1 acquisitions: 28 of 28 within 24 seconds in a
   * settled constellation; across the Sentinel-1A retirement it was wrong by
   * up to ~36 hours and re-converged within one cycle.
   */
  showNextExpected?: boolean;
  /**
   * Optional: called when the user presses the chart's reset control, AFTER
   * the chart has restored its own time window. Lets the consumer restore
   * anything the chart does not own — notably the timeline CLOCK, so "reset"
   * means the view you had at login rather than only the axis you had at
   * login.
   */
  onResetView?: () => void;
}

const ChartPanel: FC<ChartPanelProps> = observer(
  ({
    onHeightChange,
    showSelectedDate,
    defaultTimeWindowDays,
    stalenessLabel,
    showNextExpected,
    onResetView
  }) => {
    const { t } = useTranslation();
    const viewState = useViewState();

    const chartView = useMemo(
      () => new ChartView(viewState.terria),
      [viewState.terria]
    );

    const setChartXDomain = useCallback(
      (domain: [number, number] | undefined) =>
        viewState.terria.setBottomChartXDomain(domain),
      [viewState.terria]
    );

    const setChartPlotFrac = useCallback(
      (frac: [number, number] | undefined) =>
        viewState.terria.setBottomChartPlotFrac(frac),
      [viewState.terria]
    );

    const setChartPlotBand = useCallback(
      (band: [number, number] | undefined) =>
        viewState.terria.setBottomChartPlotBand(band),
      [viewState.terria]
    );

    const setChartActiveXDomain = useCallback(
      (domain: [number, number] | undefined) =>
        viewState.terria.setBottomChartActiveXDomain(domain),
      [viewState.terria]
    );

    // Clear the shared chart x-domain window + plot-frac + active domain when
    // the panel unmounts, so a stale zoom/gutter/domain can't linger and
    // mis-place a later scrubber.
    useEffect(
      () => () => {
        viewState.terria.setBottomChartXDomain(undefined);
        viewState.terria.setBottomChartPlotFrac(undefined);
        viewState.terria.setBottomChartPlotBand(undefined);
        viewState.terria.setBottomChartActiveXDomain(undefined);
      },
      [viewState.terria]
    );

    useEffect(() => {
      // Required so that components like the splitter that depend on screen
      // height will re-adjust.
      viewState.triggerResizeEvent();
      if (onHeightChange) {
        onHeightChange();
      }
    }, [onHeightChange, viewState]);

    useEffect(() => {
      // Repaint on every render
      viewState.terria.currentViewer.notifyRepaintRequired();
    });

    const closePanel = action(() => {
      chartView.chartItems.forEach((chartItem) => {
        chartItem.updateIsSelectedInWorkbench(false);
      });
    });

    const chartableCatalogItems = chartView.chartableItems;
    const chartItems = chartView.chartItems.filter((c) => c.showInChartPanel);

    const xAxis = chartView.xAxis!; // Guaranteed by non-empty chartItems with showInChartPanel=true

    const isLoading = false;
    // const isLoading =
    //   chartableItems.length > 0 &&
    //   chartableItems[chartableItems.length - 1].isLoading;

    // Live selected date (opt-in, al-shaheen): epoch-ms + a YYYY-MM-DD label.
    // Source MUST be the MobX-observable timeline time — the DRIVER item's
    // `currentTimeAsJulianDate` (a `@computed` on DiscretelyTimeVaryingMixin,
    // and the same reactive source the discrete scrubber tracks) — NOT
    // `terria.timelineClock.currentTime`. `timelineClock` is a plain Cesium
    // `Clock` (Terria.ts: `new Clock(...)`); its `currentTime` is NOT a MobX
    // observable, so reading it in this observer creates no reactive
    // dependency: the header label refreshes only when some OTHER observable
    // happens to re-render ChartPanel (flaky — it can stay on the previous
    // date/"Charts" through a scrub), and the memoized `BottomDockChart` never
    // re-runs with a fresh `selectedTimeMs`, so the permanent marker never
    // draws at all. Reading `timelineStack.top.currentTimeAsJulianDate` makes
    // both the header AND the marker update on every scrub.
    // NOTE: the label is UTC (`toISOString`), matching how the chart's time axis
    // + the discrete scrubber read the (UTC) detection instants — so the header
    // date and the marker agree on the same calendar day for a UTC-instant tenant
    // like al-shaheen. A tenant whose instants sit near a UTC midnight boundary in
    // a non-UTC display would want a locale-aware format before opting in.
    // Gate the reactive read on `showSelectedDate` so a NON-opted-in ChartPanel
    // (every tenant but al-shaheen, incl. the QE Priority-1 demo) takes no
    // MobX dependency on the timeline time at all — provably byte-identical, not
    // just behaviorally so (guardian #25 NIT-1).
    const selectedJulianDate = showSelectedDate
      ? viewState.terria.timelineStack.top?.currentTimeAsJulianDate
      : undefined;
    const selectedTimeMs = selectedJulianDate
      ? JulianDate.toDate(selectedJulianDate).getTime()
      : undefined;
    const selectedDateLabel =
      selectedTimeMs !== undefined && Number.isFinite(selectedTimeMs)
        ? new Date(selectedTimeMs).toISOString().slice(0, 10)
        : undefined;

    // Staleness caption (opt-in). A chart windowed onto the last N days of
    // its own DATA is always full — readable, but it also makes a feed that
    // stopped updating look current, because the right edge is still the
    // newest bar. The window keeps its data anchor (moving it to the wall
    // clock would open the chart on empty space) and the gap is SAID instead.
    // Silent when the feed is current, so a healthy dashboard carries no
    // extra noise.
    const lastDataMs = stalenessLabel ? latestPointMs(chartItems) : undefined;
    const staleDays = stalenessLabel
      ? stalenessDays(lastDataMs, Date.now())
      : undefined;
    const legacyStalenessCaption =
      staleDays !== undefined && lastDataMs !== undefined
        ? `last ${stalenessLabel}: ${new Date(lastDataMs)
            .toISOString()
            .slice(0, 10)} (${staleDays} day${staleDays === 1 ? "" : "s"} ago)`
        : undefined;

    // Opt-in richer caption: last observation AND the next expected one.
    // Instants come from the timeline DRIVER, not from `chartItems`: a daily
    // series plots at midnight, and the time of day is exactly what
    // distinguishes a 14:40 ascending pass from a 02:30 descending one.
    // Computed inline, NOT memoised. `discreteTimesAsSortedJulianDates` is a
    // MobX @computed whose VALUE changes without `timelineStack.top` changing
    // identity -- the pass-instant union is stamped onto the members after
    // boot and the model reloads underneath. A `useMemo` keyed on `top` would
    // skip the read on those renders, so the observer would never take a
    // dependency on it and the caption would sit on the boot-time list.
    const observationInstants = ((): number[] | undefined => {
      if (!showNextExpected) return undefined;
      // `timelineStack.top` is typed `TimeVarying`, which carries only the
      // three JulianDate getters -- the discrete list lives on the
      // DiscretelyTimeVarying mixin, so narrow before reaching for it. A
      // driver without discrete times (a continuous layer) yields undefined
      // and the caption falls back to its staleness-only half.
      const top = viewState.terria.timelineStack.top;
      const dates = DiscretelyTimeVaryingMixin.isMixedInto(top)
        ? top.discreteTimesAsSortedJulianDates
        : undefined;
      // `AsJulian` is `{ time: JulianDate; tag: string }` -- read `.time`
      // explicitly rather than accepting either shape, so a future change to
      // that type is a compile error here instead of a silent NaN.
      return dates?.map((d) => JulianDate.toDate(d.time).getTime());
    })();

    const richCaption =
      showNextExpected && stalenessLabel
        ? observationCaption({
            label: stalenessLabel,
            lastMs:
              observationInstants && observationInstants.length > 0
                ? observationInstants[observationInstants.length - 1]
                : lastDataMs,
            nextMs: observationInstants
              ? nextExpectedObservationMs(observationInstants, Date.now())
              : undefined,
            nowMs: Date.now()
          })
        : undefined;

    const stalenessCaption = richCaption ?? legacyStalenessCaption;

    const chart = useMemo(() => {
      const items = viewState.terria.workbench.items;
      if (items.length === 0) return;

      // Load all items
      Promise.all(
        items
          .filter((item) => MappableMixin.isMixedInto(item))
          .map((item) => item.loadMapItems())
      ).then((results) =>
        Result.combine(results, {
          message: "Failed to load chart items",
          importance: -1
        }).raiseError(viewState.terria)
      );

      return (
        <BottomDockChart
          chartItems={chartItems}
          xAxis={xAxis}
          height={CHART_PANEL_HEIGHT - CHART_LEGEND_HEIGHT}
          onXDomainChange={setChartXDomain}
          onPlotFracChange={setChartPlotFrac}
          onPlotBandChange={setChartPlotBand}
          onActiveXDomainChange={setChartActiveXDomain}
          selectedTimeMs={selectedTimeMs}
          defaultTimeWindowDays={defaultTimeWindowDays}
          onResetView={onResetView}
        />
      );
      // `selectedTimeMs` is a dep so the marker moves on scrub. This re-runs the
      // memo body — including the `loadMapItems()` Promise.all — on every scrub,
      // but `loadMapItems` is internally load-cached/deduped (returns instantly
      // once loaded), so the cost is a throwaway Promise per scrub, not re-loading
      // data. Kept inline rather than restructuring the shared loader into a
      // useEffect, to keep this fork change minimal + byte-identical for every
      // caller that doesn't opt in (selectedTimeMs stays undefined → memo never
      // re-runs more often for them).
    }, [
      chartItems,
      xAxis,
      viewState.terria,
      setChartXDomain,
      setChartPlotFrac,
      setChartPlotBand,
      setChartActiveXDomain,
      selectedTimeMs,
      defaultTimeWindowDays,
      onResetView
    ]);

    if (chartItems.length === 0) {
      return null;
    }

    return (
      <div className={Styles.holder}>
        <div className={Styles.inner}>
          <div
            className={Styles.chartPanel}
            style={{ height: CHART_PANEL_HEIGHT }}
          >
            <div>
              <div className={Styles.header}>
                <label className={Styles.sectionLabel}>
                  {isLoading ? (
                    <Loader />
                  ) : showSelectedDate && selectedDateLabel ? (
                    // Opt-in (al-shaheen): the live selected date, bold + larger,
                    // replaces the static "Charts" label so the header reads as
                    // the date the bottom time slider is on.
                    <span style={{ fontSize: "16px", fontWeight: 700 }}>
                      {selectedDateLabel}
                    </span>
                  ) : (
                    t("chart.sectionLabel")
                  )}
                  {stalenessCaption && (
                    /* Subordinate to the selected date, and deliberately not
                     * an alarm colour: this states a fact about the feed, it
                     * does not assert a fault. */
                    <span
                      style={{
                        marginLeft: 10,
                        fontSize: "12px",
                        fontWeight: 400,
                        opacity: 0.75
                      }}
                      title="The newest observation in this chart. The view is anchored to the data, not to the current date."
                    >
                      {stalenessCaption}
                    </span>
                  )}
                </label>
                <ChartPanelDownloadButton
                  chartableItems={chartableCatalogItems}
                />
                <button
                  type="button"
                  title={t("chart.closePanel")}
                  className={Styles.btnCloseChartPanel}
                  onClick={closePanel}
                >
                  <Icon glyph={Icon.GLYPHS.close} />
                </button>
              </div>
              <div className={Styles.chart}>{chart}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ChartPanel.displayName = "ChartPanel";

export default ChartPanel;

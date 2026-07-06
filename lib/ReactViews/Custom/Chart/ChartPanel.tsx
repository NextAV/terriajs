import { action } from "mobx";
import { observer } from "mobx-react";
import { FC, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
import ChartView from "../../../Charts/ChartView";
import Result from "../../../Core/Result";
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
}

const ChartPanel: FC<ChartPanelProps> = observer(
  ({ onHeightChange, showSelectedDate }) => {
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

    // Clear the shared chart x-domain window + plot-frac when the panel unmounts,
    // so a stale zoom/gutter can't linger and mis-inset a later scrubber.
    useEffect(
      () => () => {
        viewState.terria.setBottomChartXDomain(undefined);
        viewState.terria.setBottomChartPlotFrac(undefined);
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
    const selectedJulianDate =
      viewState.terria.timelineStack.top?.currentTimeAsJulianDate;
    const selectedTimeMs =
      showSelectedDate && selectedJulianDate
        ? JulianDate.toDate(selectedJulianDate).getTime()
        : undefined;
    const selectedDateLabel =
      selectedTimeMs !== undefined && Number.isFinite(selectedTimeMs)
        ? new Date(selectedTimeMs).toISOString().slice(0, 10)
        : undefined;

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
          selectedTimeMs={selectedTimeMs}
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
      selectedTimeMs
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

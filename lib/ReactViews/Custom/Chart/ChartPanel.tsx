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

    // Live selected date (opt-in, al-shaheen): epoch-ms + a YYYY-MM-DD label from
    // the timeline clock. Reading `currentTime` in this observer makes the header
    // label + the chart's permanent marker reactive to every scrub. undefined
    // when not opted in → the stock "Charts" label + no marker (byte-identical).
    const selectedTimeMs =
      showSelectedDate && viewState.terria.timelineClock?.currentTime
        ? JulianDate.toDate(
            viewState.terria.timelineClock.currentTime
          ).getTime()
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

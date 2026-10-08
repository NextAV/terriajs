import { http, HttpResponse } from "msw";
import { runInAction } from "mobx";
import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
import { ChartPoint } from "../../lib/Charts/ChartData";
import CsvCatalogItem from "../../lib/Models/Catalog/CatalogItems/CsvCatalogItem";
import CommonStrata from "../../lib/Models/Definition/CommonStrata";
import updateModelFromJson from "../../lib/Models/Definition/updateModelFromJson";
import Terria from "../../lib/Models/Terria";
import TimeVarying from "../../lib/ModelMixins/TimeVarying";
import { worker } from "../mocks/browser";

import regionMapping from "../../wwwroot/data/regionMapping.json";

// Three half-month periods; the bar is drawn at each period's MIDDLE and the
// period itself is declared by `period_start` / `period_end` (exclusive).
const HALF_MONTHS_CSV = [
  "x,period_start,period_end,period,decline_ha,clear_passes,note",
  "2026-06-08T12:00:00Z,2026-06-01,2026-06-16,1-15 Jun 2026,1.25,3,4 clusters newly flagged",
  "2026-06-23T12:00:00Z,2026-06-16,2026-07-01,16-30 Jun 2026,,2,",
  "2026-07-08T12:00:00Z,2026-07-01,2026-07-16,1-15 Jul 2026,0.50,1,1 cluster newly flagged"
].join("\n");

const FRAME_MS = Date.parse("2026-06-03T07:22:00Z");

function chartJson(extra: Record<string, unknown>) {
  return {
    csvString: HALF_MONTHS_CSV,
    chartType: "bar",
    columns: [
      { name: "x", type: "time" },
      { name: "period_start", type: "time" },
      { name: "period_end", type: "time" },
      { name: "period", type: "text" },
      { name: "decline_ha", type: "scalar", title: "Decline", units: "ha" },
      {
        name: "clear_passes",
        type: "scalar",
        title: "Passes",
        units: "passes"
      },
      { name: "note", type: "text", title: "In this half-month" }
    ],
    defaultStyle: {
      chart: {
        xAxisColumn: "x",
        lines: [
          { yAxisColumn: "decline_ha", isSelectedInWorkbench: true },
          { yAxisColumn: "clear_passes", isSelectedInWorkbench: true }
        ]
      }
    },
    ...extra
  };
}

describe("TableMixin declared bar periods", function () {
  let terria: Terria;
  let item: CsvCatalogItem;

  beforeEach(function () {
    terria = new Terria({ baseUrl: "./" });
    item = new CsvCatalogItem("declared", terria, undefined);
    // A table item reads the region-mapping registry while it loads, even when
    // (as here) no column names a region; served the same way TableMixinSpec does.
    worker.use(
      http.get("*/build/TerriaJS/data/regionMapping.json", () =>
        HttpResponse.json(regionMapping)
      )
    );
  });

  async function load(extra: Record<string, unknown>) {
    updateModelFromJson(
      item,
      CommonStrata.user,
      chartJson(extra)
    ).throwIfError();
    (await item.loadMapItems()).throwIfError();
    return item.chartItems.filter((c) => c.type === "bar");
  }

  it("attaches nothing when no declared-period or tooltip trait is set", async function () {
    const [decline] = await load({});
    const p = decline.points[0];
    expect(p.periodEndMs).toBeUndefined();
    expect(p.periodStartMs).toBeUndefined();
    expect(p.tooltipTitle).toBeUndefined();
    expect(p.tooltipRows).toBeUndefined();
  });

  it("reads each row's declared period, title and tooltip rows", async function () {
    const [decline, passes] = await load({
      chartPeriodStartColumn: "period_start",
      chartPeriodEndColumn: "period_end",
      chartTooltipTitleColumn: "period",
      chartTooltipColumns: ["note"]
    });
    // A blank decline cell is not a point; the passes series has all three.
    expect(decline.points.length).toBe(2);
    expect(passes.points.length).toBe(3);
    const p = decline.points[0];
    expect(p.periodStartMs).toBe(Date.parse("2026-06-01"));
    expect(p.periodEndMs).toBe(Date.parse("2026-06-16"));
    expect(p.tooltipTitle).toBe("1-15 Jun 2026");
    expect(p.tooltipRows).toEqual([
      {
        name: "In this half-month",
        value: "4 clusters newly flagged",
        units: undefined
      }
    ]);
    // A blank tooltip cell lists nothing rather than an empty row.
    expect(passes.points[1].tooltipRows).toBeUndefined();
  });

  describe("clicking a bar", function () {
    beforeEach(function () {
      const frames = [
        { time: JulianDate.fromDate(new Date(FRAME_MS)), tag: "" }
      ];
      const driver = {
        name: "True colour (1 m)",
        uniqueId: "driver",
        currentTimeAsJulianDate: frames[0].time,
        startTimeAsJulianDate: frames[0].time,
        stopTimeAsJulianDate: frames[0].time,
        isPaused: true,
        multiplier: undefined,
        discreteTimesAsSortedJulianDates: frames,
        setTrait() {}
      } as unknown as TimeVarying;
      runInAction(() => terria.timelineStack.addToTop(driver));
      terria.timelineClock.currentTime = JulianDate.fromDate(
        new Date(FRAME_MS)
      );
    });

    function click(
      series: { points: readonly ChartPoint[]; onClick?: any },
      i: number
    ) {
      series.onClick(series.points[i]);
    }

    it("moves the clock to the frame inside the declared period", async function () {
      const [decline] = await load({
        chartPeriodEndColumn: "period_end",
        chartPeriodStartColumn: "period_start"
      });
      terria.timelineClock.currentTime = JulianDate.fromDate(
        new Date("2026-01-01T00:00:00Z")
      );
      click(decline, 0);
      expect(
        JulianDate.toDate(terria.timelineClock.currentTime).getTime()
      ).toBe(FRAME_MS);
      expect(terria.bottomChartNotice).toBeUndefined();
    });

    it("does NOT jump to the nearest frame from an empty declared period, and says so", async function () {
      const [decline] = await load({
        chartPeriodStartColumn: "period_start",
        chartPeriodEndColumn: "period_end",
        chartTooltipTitleColumn: "period"
      });
      click(decline, 1); // 1-15 Jul: no frame; the nearest is 3 Jun
      expect(
        JulianDate.toDate(terria.timelineClock.currentTime).getTime()
      ).toBe(FRAME_MS);
      expect(terria.bottomChartNotice?.message).toBe(
        "No “True colour (1 m)” date in 1-15 Jul 2026; the map stays on 2026-06-03."
      );
      expect(terria.bottomChartNotice?.atMs).toBe(FRAME_MS);
    });

    it("keeps the nearest fallback when the period is NOT declared", async function () {
      const [decline] = await load({});
      terria.timelineClock.currentTime = JulianDate.fromDate(
        new Date("2026-01-01T00:00:00Z")
      );
      click(decline, 1); // July bar, undeclared: falls back to 3 Jun
      expect(
        JulianDate.toDate(terria.timelineClock.currentTime).getTime()
      ).toBe(FRAME_MS);
      expect(terria.bottomChartNotice).toBeUndefined();
    });
  });
});

import { ChartItemType } from "../../ModelMixins/ChartableMixin";
import Glyphs, { GlyphStyle } from "../../ReactViews/Custom/Chart/Glyphs";
import primitiveArrayTrait from "../Decorators/primitiveArrayTrait";
import primitiveTrait from "../Decorators/primitiveTrait";
import mixTraits from "../mixTraits";
import MappableTraits from "./MappableTraits";

const availableChartGlyphStyles = Object.keys(Glyphs).join(", ");

export default class ChartTraits extends mixTraits(MappableTraits) {
  @primitiveTrait({
    type: "string",
    name: "Chart type",
    description:
      "Type determines how the data availibility will be plotted on chart. eg: momentLines, momentPoints"
  })
  chartType?: ChartItemType;

  // This trait proabably doesn't belong here and should instead be on a new
  //  trait class ChartTraits, however there are complexities to changing
  //  chart-related traits, mixins and interfaces to support this change.
  @primitiveTrait({
    type: "string",
    name: "Chart Disclaimer",
    description: "A HTML string to show above the chart as a disclaimer"
  })
  chartDisclaimer?: string;

  @primitiveTrait({
    type: "string",
    name: "Chart color",
    description:
      "The color to use when the data set is displayed on the chart. The value can be any html color string, eg: 'cyan' or '#00ffff' or 'rgba(0, 255, 255, 1)' for the color cyan."
  })
  chartColor?: string;

  @primitiveTrait({
    type: "string",
    name: "Chart glyph style",
    description: `The glyph style to use for points plotted on the chart. Allowed values include ${availableChartGlyphStyles}. Default is "circle".`
  })
  chartGlyphStyle?: GlyphStyle;

  // The four traits below are opt-in and inert when unset: a chart that sets
  // none of them renders, hovers and clicks exactly as before. They let a
  // per-PERIOD bar chart (one bar per half-month, say) say which period each
  // bar stands for, instead of the chart inferring it from the smallest gap.

  @primitiveTrait({
    type: "string",
    name: "Chart period start column",
    description:
      "Name of a time column holding the START of the period each row stands for. Optional: when unset the x value is the start. Only read when `chartPeriodEndColumn` is also set."
  })
  chartPeriodStartColumn?: string;

  @primitiveTrait({
    type: "string",
    name: "Chart period end column",
    description:
      "Name of a time column holding the END (exclusive) of the period each row stands for. When set, clicking a bar moves the timeline to the earliest timeline date INSIDE that period; a period holding none leaves the timeline where it is and says so in the chart panel, rather than jumping to the nearest date, which may be in another period."
  })
  chartPeriodEndColumn?: string;

  @primitiveTrait({
    type: "string",
    name: "Chart tooltip title column",
    description:
      "Name of a column whose value titles the chart tooltip for that row (e.g. '1-15 Jul 2026'), in place of the formatted x value."
  })
  chartTooltipTitleColumn?: string;

  @primitiveArrayTrait({
    type: "string",
    name: "Chart tooltip columns",
    description:
      "Names of columns listed once in the chart tooltip beneath its title, each as '<column title>: <value> <units>'. A blank value is not listed."
  })
  chartTooltipColumns?: string[];
}

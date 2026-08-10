import primitiveTrait from "../Decorators/primitiveTrait";
import mixTraits from "../mixTraits";
import ChartTraits from "./ChartTraits";
import TimeVaryingTraits from "./TimeVaryingTraits";

export default class DiscretelyTimeVaryingTraits extends mixTraits(
  ChartTraits,
  TimeVaryingTraits
) {
  @primitiveTrait({
    name: "Mapping from Continuous Time",
    description:
      "Specifies how a continuous time (e.g. the timeline control) is mapped to a discrete time for this dataset. Valid values are: <br/>" +
      " * `nearest` - the nearest available discrete time to the current continuous time is used. <br/>" +
      " * `next` - the discrete time equal to or after the current continuous time is used. <br/>" +
      " * `previous` - the discrete time equal to or before the current continuous time is used.",
    type: "string"
  })
  fromContinuous: string = "nearest";

  @primitiveTrait({
    type: "boolean",
    name: "Show in chart",
    description: "Whether to plot data availability on a chart."
  })
  showInChartPanel = false;

  @primitiveTrait({
    type: "boolean",
    name: "Disable date time selector",
    description: "When true, disables the date time selector in the workbench"
  })
  disableDateTimeSelector = false;

  @primitiveTrait({
    name: "Time Multiplier",
    description:
      "The multiplierDefaultDeltaStep is used to set the default multiplier (see `TimeVaryingTraits.multiplier` trait) - it represents the average number of (real-time) seconds between (dataset) time steps. For example, a value of five would set the `multiplier` so that a new time step (of this dataset) would appear every five seconds (on average) if the timeline is playing. This trait will only take effect if `multiplier` is **not** explicitly set.",
    type: "number"
  })
  multiplierDefaultDeltaStep?: number = 2;

  @primitiveTrait({
    type: "boolean",
    name: "Hide outside own discrete times",
    description:
      "When true, this layer renders NOTHING at a clock instant that is not one of its own discrete times, instead of falling back to the `fromContinuous` neighbour. " +
      "Default false — every layer keeps the historical nearest/next/previous behaviour. " +
      "Turn it on for a CONTEXT raster whose instants are a strict SUBSET of the timeline driver's: the driver can then land on an instant this layer has no frame for, and the honest answer is an empty backdrop, not a frame from another date. " +
      "The al-shaheen case that motivated it: the SAR candidate layer's time model was unioned with every satellite pass (233 instants) while the radar backdrop still rendered 34 frames, so stepping to a no-detection pass painted the radar frame from a DIFFERENT date — one that visibly contained slicks — under a map that correctly showed no detections. " +
      "Comparison is at SECOND granularity, so the sub-second spelling differences between independently-produced instant lists do not cause a spurious hide. " +
      "FAIL-OPEN: a layer with no discrete times, or no resolved current time, is never hidden by this trait."
  })
  hideOutsideDiscreteTimes: boolean = false;
}

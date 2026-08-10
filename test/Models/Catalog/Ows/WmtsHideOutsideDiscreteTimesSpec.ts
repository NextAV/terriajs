import { runInAction } from "mobx";
import WebMapTileServiceCatalogItem from "../../../../lib/Models/Catalog/Ows/WebMapTileServiceCatalogItem";
import CommonStrata from "../../../../lib/Models/Definition/CommonStrata";
import createStratumInstance from "../../../../lib/Models/Definition/createStratumInstance";
import Terria from "../../../../lib/Models/Terria";
import { WebMapTileServiceTimeTraits } from "../../../../lib/Traits/TraitsClasses/WebMapTileServiceCatalogItemTraits";

/**
 * `hideOutsideDiscreteTimes`: a sparse CONTEXT raster must not paint a frame
 * from another date when the timeline lands on an instant it has no frame for.
 *
 * The al-shaheen regression this locks: the SAR candidate layer's time model
 * was unioned with all 233 satellite-pass instants while the radar backdrop
 * still had 34 frames, so stepping to a no-detection pass painted the radar
 * image from a DIFFERENT acquisition — one that visibly contained slicks —
 * beneath a map that correctly showed no detections.
 */
describe("WebMapTileServiceCatalogItem hideOutsideDiscreteTimes", function () {
  let terria: Terria;
  let wmts: WebMapTileServiceCatalogItem;

  // Two frames, deliberately carrying a time-of-day (the al-shaheen radar
  // advertises detection instants, not midnights).
  const FRAME_A = "2026-01-13T14:33:45Z";
  const FRAME_B = "2026-02-08T02:30:40Z";
  // A pass instant BETWEEN the two frames: this is what the unioned driver can
  // now land on, and what used to resolve to FRAME_B via `fromContinuous`.
  const PASS_WITH_NO_FRAME = "2026-01-27T02:30:40Z";

  beforeEach(function () {
    terria = new Terria();
    wmts = new WebMapTileServiceCatalogItem("test", terria);
    runInAction(() => {
      wmts.setTrait(CommonStrata.definition, "url", "http://example.com/wmts");
      wmts.setTrait(CommonStrata.definition, "layer", "radar");
      wmts.setTrait(
        CommonStrata.definition,
        "time",
        createStratumInstance(WebMapTileServiceTimeTraits, {
          values: [FRAME_A, FRAME_B]
        })
      );
    });
  });

  it("advertises exactly its own two frames", function () {
    expect(wmts.discreteTimes?.length).toBe(2);
  });

  it("is not outside its own times when the trait is OFF (default)", function () {
    runInAction(() => {
      wmts.setTrait(CommonStrata.user, "currentTime", PASS_WITH_NO_FRAME);
    });
    expect(wmts.hideOutsideDiscreteTimes).toBe(false);
    expect(wmts.isOutsideOwnDiscreteTimes).toBe(false);
  });

  it("resolves a foreign frame at a non-matching instant when OFF — the defect", function () {
    // Falsification anchor: this is the behaviour the trait exists to suppress.
    // If this expectation ever fails, `fromContinuous` changed and the gate's
    // premise needs re-checking.
    runInAction(() => {
      wmts.setTrait(CommonStrata.user, "currentTime", PASS_WITH_NO_FRAME);
    });
    expect(wmts.currentDiscreteTimeTag).toBeDefined();
    expect(wmts.currentDiscreteTimeTag).not.toBe(PASS_WITH_NO_FRAME);
  });

  it("reports outside-own-times at a non-matching instant when ON", function () {
    runInAction(() => {
      wmts.setTrait(CommonStrata.user, "hideOutsideDiscreteTimes", true);
      wmts.setTrait(CommonStrata.user, "currentTime", PASS_WITH_NO_FRAME);
    });
    // THIS is the real lock. `mapItems` is deliberately not asserted here —
    // see the control below for why such an assertion would be vacuous.
    expect(wmts.isOutsideOwnDiscreteTimes).toBe(true);
  });

  it("CONTROL: mapItems is already empty without a capabilities stratum", function () {
    // Guards against a false-green that this spec originally shipped with.
    // `_createImageryProvider` early-returns undefined when the GetCapabilities
    // stratum or `style` is missing — both are load-supplied — so `mapItems` is
    // [] here whether or not the gate exists. An `expect(mapItems.length)
    // .toBe(0)` in the test above therefore passed with the gate DELETED, and
    // in a repo with no CI that assertion was the only thing standing between
    // the gate and production.
    //
    // This control makes the vacuity explicit and permanent: it asserts the
    // empty-without-the-gate baseline with the trait OFF, so anyone who later
    // adds a `mapItems` assertion to the ON case can see immediately that it
    // proves nothing without a stubbed provider. The behavioural lock lives on
    // `isOutsideOwnDiscreteTimes`; that `mapItems` consumes it is a one-line
    // early return verified by reading, and end-to-end in a real browser at
    // Stage-5.
    runInAction(() => {
      wmts.setTrait(CommonStrata.user, "hideOutsideDiscreteTimes", false);
      wmts.setTrait(CommonStrata.user, "currentTime", FRAME_B);
    });
    expect(wmts.isOutsideOwnDiscreteTimes).toBe(false);
    expect(wmts.mapItems.length).toBe(0);
  });

  it("is fromContinuous-independent: a 0.4s skew under `next` does not hide", function () {
    // The resolved discrete time is NOT the nearest one under `next`/`previous`.
    // With frames at A and B and the clock 0.4s past A, `next` resolves to B —
    // twelve days away — so comparing against the resolved time alone would
    // hide a layer that genuinely has the frame. The neighbour scan covers it.
    runInAction(() => {
      wmts.setTrait(CommonStrata.definition, "fromContinuous", "next");
      wmts.setTrait(CommonStrata.user, "hideOutsideDiscreteTimes", true);
      wmts.setTrait(CommonStrata.user, "currentTime", "2026-01-13T14:33:45.4Z");
    });
    expect(wmts.isOutsideOwnDiscreteTimes).toBe(false);
  });

  it("still hides under `next` when there is genuinely no nearby frame", function () {
    runInAction(() => {
      wmts.setTrait(CommonStrata.definition, "fromContinuous", "next");
      wmts.setTrait(CommonStrata.user, "hideOutsideDiscreteTimes", true);
      wmts.setTrait(CommonStrata.user, "currentTime", PASS_WITH_NO_FRAME);
    });
    expect(wmts.isOutsideOwnDiscreteTimes).toBe(true);
  });

  it("still renders ON its own frames when the trait is ON", function () {
    runInAction(() => {
      wmts.setTrait(CommonStrata.user, "hideOutsideDiscreteTimes", true);
      wmts.setTrait(CommonStrata.user, "currentTime", FRAME_B);
    });
    expect(wmts.isOutsideOwnDiscreteTimes).toBe(false);
  });

  it("tolerates a sub-second spelling difference for the same instant", function () {
    // Two independently-produced instant lists routinely differ below the
    // second for the SAME acquisition; that must not blank a layer that does
    // have the frame.
    runInAction(() => {
      wmts.setTrait(CommonStrata.user, "hideOutsideDiscreteTimes", true);
      wmts.setTrait(CommonStrata.user, "currentTime", "2026-02-08T02:30:40.4Z");
    });
    expect(wmts.isOutsideOwnDiscreteTimes).toBe(false);
  });

  it("fails OPEN when the layer has no discrete times", function () {
    const bare = new WebMapTileServiceCatalogItem("bare", terria);
    runInAction(() => {
      bare.setTrait(CommonStrata.user, "hideOutsideDiscreteTimes", true);
      bare.setTrait(CommonStrata.user, "currentTime", PASS_WITH_NO_FRAME);
    });
    expect(bare.isOutsideOwnDiscreteTimes).toBe(false);
  });

  it("fails OPEN when there is no current time", function () {
    runInAction(() => {
      wmts.setTrait(CommonStrata.user, "hideOutsideDiscreteTimes", true);
    });
    expect(wmts.currentTime).toBeUndefined();
    expect(wmts.isOutsideOwnDiscreteTimes).toBe(false);
  });
});

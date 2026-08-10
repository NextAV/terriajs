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
    expect(wmts.isOutsideOwnDiscreteTimes).toBe(true);
    expect(wmts.mapItems.length).toBe(0);
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

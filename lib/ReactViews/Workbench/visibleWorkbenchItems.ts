import { BaseModel } from "../../Models/Definition/Model";
import Terria from "../../Models/Terria";

/**
 * The workbench items that render as ROWS in the workbench list UI — i.e.
 * every item except `hideInWorkbench`-opted-in "visibility group" children
 * (NextAV/terriajs#44), which stay REAL workbench items (their map/chart
 * surfaces, timeline participation, and z-order slots are untouched) but
 * show no row.
 *
 * Single source of truth for the list render, the drag-sort index
 * translation, the header badge count, and the enable-all predicate — one
 * predicate, so the surfaces can never drift (NextAV/terriajs#45 review
 * finding: the badge counted hidden children over a shorter list).
 */
export default function visibleWorkbenchItems(terria: Terria): BaseModel[] {
  return terria.workbench.items.filter(
    (item) =>
      (item as { hideInWorkbench?: boolean }).hideInWorkbench !== true
  );
}

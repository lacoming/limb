/**
 * Cell selection overlay rendering.
 * Draws selection highlight and neighbor hints (add/remove).
 */
import { Container, Graphics, Rectangle, FederatedPointerEvent } from "pixi.js";
import type { LibraryGrid, CellId } from "../../lib/libraryGrid";
import type { ShelfMetrics } from "../../lib/shelfMetrics";
import { cellKey } from "../../lib/cellKeys";

const SELECTION_COLOR = 0x4a90e2;
const SELECTION_ALPHA = 0.3;
const ADD_HINT_COLOR = 0x4ade80; // green
const REMOVE_HINT_COLOR = 0xef4444; // red
const HINT_ALPHA = 0.4;
const HINT_SIZE = 20;
const DEV_OVERLAY_LOG = false;

function cellToLocal(
  gx: number,
  gy: number,
  gridOriginX: number,
  gridOriginY: number,
  CELL_W: number,
  CELL_H: number
): { x: number; y: number } {
  return {
    x: gridOriginX + gx * CELL_W,
    y: gridOriginY + gy * CELL_H,
  };
}

export function updateSelectionOverlay(
  overlay: Container,
  selectedKey: string | null,
  grid: LibraryGrid,
  metrics: ShelfMetrics,
  gridOriginX: number,
  gridOriginY: number,
  onAddCell?: (gx: number, gy: number) => void,
  onRemoveCell?: (gx: number, gy: number) => void
): void {
  overlay.removeChildren();

  if (!selectedKey) return;

  const selectedCell = grid.getCell(selectedKey);
  if (!selectedCell) return;

  const { CELL_W, CELL_H } = metrics;

  const sel = cellToLocal(
    selectedCell.gx,
    selectedCell.gy,
    gridOriginX,
    gridOriginY,
    CELL_W,
    CELL_H
  );
  const selX = sel.x;
  const selY = sel.y;

  if (process.env.NODE_ENV === "development" && DEV_OVERLAY_LOG) {
    console.log("[overlay] selected", {
      gx: selectedCell.gx,
      gy: selectedCell.gy,
      localX: selX,
      localY: selY,
    });
  }

  // Draw selection highlight
  const selectionG = new Graphics();
  selectionG.rect(selX, selY, CELL_W, CELL_H);
  selectionG.fill({ color: SELECTION_COLOR, alpha: SELECTION_ALPHA });
  overlay.addChild(selectionG);

  // Get neighbors
  const neighbors = [
    { gx: selectedCell.gx + 1, gy: selectedCell.gy, dir: "R" },
    { gx: selectedCell.gx - 1, gy: selectedCell.gy, dir: "L" },
    { gx: selectedCell.gx, gy: selectedCell.gy - 1, dir: "U" },
    { gx: selectedCell.gx, gy: selectedCell.gy + 1, dir: "D" },
  ];

  for (const neighbor of neighbors) {
    const isOccupied = grid.isOccupied(neighbor.gx, neighbor.gy);
    const n = cellToLocal(
      neighbor.gx,
      neighbor.gy,
      gridOriginX,
      gridOriginY,
      CELL_W,
      CELL_H
    );
    const nx = n.x;
    const ny = n.y;
    const centerX = nx + CELL_W / 2;
    const centerY = ny + CELL_H / 2;

    const hintG = new Graphics();

    if (isOccupied) {
      // Red hint for removal
      hintG.circle(centerX, centerY, HINT_SIZE / 2);
      hintG.fill({ color: REMOVE_HINT_COLOR, alpha: HINT_ALPHA });
      // Draw minus/cross
      hintG.setStrokeStyle({ width: 3, color: 0xffffff });
      hintG.moveTo(centerX - HINT_SIZE / 3, centerY);
      hintG.lineTo(centerX + HINT_SIZE / 3, centerY);
      hintG.stroke();
    } else {
      // Green hint for addition
      hintG.circle(centerX, centerY, HINT_SIZE / 2);
      hintG.fill({ color: ADD_HINT_COLOR, alpha: HINT_ALPHA });
      // Draw plus
      hintG.setStrokeStyle({ width: 3, color: 0xffffff });
      hintG.moveTo(centerX - HINT_SIZE / 3, centerY);
      hintG.lineTo(centerX + HINT_SIZE / 3, centerY);
      hintG.moveTo(centerX, centerY - HINT_SIZE / 3);
      hintG.lineTo(centerX, centerY + HINT_SIZE / 3);
      hintG.stroke();
    }

    // Make marker interactive
    hintG.eventMode = "static";
    hintG.cursor = "pointer";
    hintG.hitArea = new Rectangle(
      centerX - HINT_SIZE / 2,
      centerY - HINT_SIZE / 2,
      HINT_SIZE,
      HINT_SIZE
    );

    // Store neighbor coordinates for handler
    (hintG as any).neighborGX = neighbor.gx;
    (hintG as any).neighborGY = neighbor.gy;
    (hintG as any).isOccupied = isOccupied;

    // Add click handler
    hintG.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (isOccupied && onRemoveCell) {
        onRemoveCell(neighbor.gx, neighbor.gy);
      } else if (!isOccupied && onAddCell) {
        onAddCell(neighbor.gx, neighbor.gy);
      }
    });

    overlay.addChild(hintG);
  }
}

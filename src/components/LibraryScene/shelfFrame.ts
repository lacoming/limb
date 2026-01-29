/**
 * Shelf frame layer: shared edges. Draws only external edges per cell;
 * internal edges between adjacent cells are skipped (no double walls).
 */

import { type Graphics } from "pixi.js";
import type { LibraryGrid } from "../../lib/libraryGrid";

export const FRAME_T = 12;
export const FRAME_COLOR = 0x4a3728;

export function redrawShelfFrame(
  g: Graphics,
  grid: LibraryGrid,
  cellSizeX: number,
  cellSizeY: number,
  frameT: number,
  frameColor: number
): void {
  g.clear();
  const halfX = cellSizeX / 2;
  const halfY = cellSizeY / 2;

  for (const cell of grid.getAllCells()) {
    const { gx, gy } = cell;
    const cx = gx * cellSizeX;
    const cy = gy * cellSizeY;

    const hasLeft = grid.isOccupied(gx - 1, gy);
    const hasRight = grid.isOccupied(gx + 1, gy);
    const hasUp = grid.isOccupied(gx, gy - 1);
    const hasDown = grid.isOccupied(gx, gy + 1);

    if (!hasLeft) {
      g.rect(cx - halfX, cy - halfY, frameT, cellSizeY).fill({
        color: frameColor,
        alpha: 1,
      });
    }
    if (!hasRight) {
      g.rect(cx + halfX - frameT, cy - halfY, frameT, cellSizeY).fill({
        color: frameColor,
        alpha: 1,
      });
    }
    if (!hasUp) {
      g.rect(cx - halfX, cy - halfY, cellSizeX, frameT).fill({
        color: frameColor,
        alpha: 1,
      });
    }
    if (!hasDown) {
      g.rect(cx - halfX, cy + halfY - frameT, cellSizeX, frameT).fill({
        color: frameColor,
        alpha: 1,
      });
    }
  }
}

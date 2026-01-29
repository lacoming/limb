/**
 * Grid-based library cell management.
 * Stores cells in a grid coordinate system (gx, gy) with efficient lookup.
 */
import { cellKey } from "./cellKeys";

export type CellId = string;

export interface Cell {
  id: CellId;
  gx: number;
  gy: number;
}

export const CELL_SIZE_X = 300;
export const CELL_SIZE_Y = 300;

/**
 * Grid storage for library cells.
 * Provides O(1) lookup for both cell-by-id and position-occupancy checks.
 */
export class LibraryGrid {
  private cellsById = new Map<CellId, Cell>();
  private occupancy = new Map<string, CellId>(); // key: "gx,gy"

  /**
   * Generates a unique cell ID.
   */
  private generateCellId(): CellId {
    return `cell_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Adds a cell at the specified grid coordinates.
   * Returns the cell ID if successful, null if the position is occupied.
   */
  addCellAt(gx: number, gy: number): CellId | null {
    const key = cellKey(gx, gy);
    if (this.occupancy.has(key)) {
      return null; // Position already occupied
    }

    const id = this.generateCellId();
    const cell: Cell = { id, gx, gy };
    
    this.cellsById.set(id, cell);
    this.occupancy.set(key, id);
    
    return id;
  }

  /**
   * Checks if a grid position is occupied.
   */
  isOccupied(gx: number, gy: number): boolean {
    return this.occupancy.has(cellKey(gx, gy));
  }

  /**
   * Gets a cell by ID.
   */
  getCell(id: CellId): Cell | null {
    return this.cellsById.get(id) ?? null;
  }

  /**
   * Gets all cells.
   */
  getAllCells(): Cell[] {
    return Array.from(this.cellsById.values());
  }

  /**
   * Removes a cell by ID.
   * Returns true if the cell was found and removed.
   */
  removeCell(id: CellId): boolean {
    const cell = this.cellsById.get(id);
    if (!cell) return false;

    const key = cellKey(cell.gx, cell.gy);
    this.cellsById.delete(id);
    this.occupancy.delete(key);
    
    return true;
  }

  /**
   * Gets the grid bounds (min/max gx, gy).
   * Returns null if there are no cells.
   */
  getBounds(): { minGX: number; maxGX: number; minGY: number; maxGY: number } | null {
    if (this.cellsById.size === 0) {
      return null;
    }

    let minGX = Infinity;
    let maxGX = -Infinity;
    let minGY = Infinity;
    let maxGY = -Infinity;

    for (const cell of this.cellsById.values()) {
      minGX = Math.min(minGX, cell.gx);
      maxGX = Math.max(maxGX, cell.gx);
      minGY = Math.min(minGY, cell.gy);
      maxGY = Math.max(maxGY, cell.gy);
    }

    return { minGX, maxGX, minGY, maxGY };
  }

  /**
   * Gets neighboring grid positions (4-directional) for a cell.
   * Returns only positions that are currently free.
   */
  neighbors(cellId: CellId): Array<{ gx: number; gy: number }> {
    const cell = this.cellsById.get(cellId);
    if (!cell) return [];

    const neighbors: Array<{ gx: number; gy: number }> = [];
    const directions = [
      { gx: cell.gx + 1, gy: cell.gy }, // Right
      { gx: cell.gx - 1, gy: cell.gy }, // Left
      { gx: cell.gx, gy: cell.gy - 1 }, // Up
      { gx: cell.gx, gy: cell.gy + 1 }, // Down
    ];

    for (const pos of directions) {
      if (!this.isOccupied(pos.gx, pos.gy)) {
        neighbors.push(pos);
      }
    }

    return neighbors;
  }

  /**
   * Gets the total number of cells.
   */
  getCellCount(): number {
    return this.cellsById.size;
  }

  /**
   * Removes all cells.
   */
  clear(): void {
    this.cellsById.clear();
    this.occupancy.clear();
  }
}

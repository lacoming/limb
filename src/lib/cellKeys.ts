/**
 * Unified cell key format and neighbor helpers.
 * Use everywhere for occupiedCells keys and parsing.
 *
 * Neighbors: L = (gx-1, gy), R = (gx+1, gy), U = (gx, gy-1), D = (gx, gy+1).
 * Y increases downward.
 */
export function cellKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

export function parseCellKey(key: string): { gx: number; gy: number } {
  const [a, b] = key.split(",").map(Number);
  return { gx: a, gy: b };
}

export function hasCell(
  occupied: Set<string>,
  gx: number,
  gy: number
): boolean {
  return occupied.has(cellKey(gx, gy));
}

/**
 * Dev-only: asserts that for cell (gx, gy) only the neighbor (ngx, ngy)
 * is present in that direction. Run only when (gx, gy) has exactly one
 * neighbor (the one just added). dx = ngx - gx, dy = ngy - gy must be
 * exactly one of (1,0), (-1,0), (0,1), (0,-1).
 */
export function devAssertNeighborDirection(
  occupied: Set<string>,
  gx: number,
  gy: number,
  ngx: number,
  ngy: number
): void {
  if (process.env.NODE_ENV !== "development") return;

  const dx = ngx - gx;
  const dy = ngy - gy;
  const dir =
    dx === 1 && dy === 0
      ? "R"
      : dx === -1 && dy === 0
        ? "L"
        : dx === 0 && dy === 1
          ? "D"
          : dx === 0 && dy === -1
            ? "U"
            : null;
  if (dir === null) {
    console.warn(
      "[cellKeys] devAssertNeighborDirection: invalid neighbor offset",
      { gx, gy, ngx, ngy, dx, dy }
    );
    return;
  }

  const hasL = hasCell(occupied, gx - 1, gy);
  const hasR = hasCell(occupied, gx + 1, gy);
  const hasU = hasCell(occupied, gx, gy - 1);
  const hasD = hasCell(occupied, gx, gy + 1);
  const count = [hasL, hasR, hasU, hasD].filter(Boolean).length;
  if (count !== 1) return; /* skip when multiple neighbors */

  const ok =
    (dir === "L" && hasL) ||
    (dir === "R" && hasR) ||
    (dir === "U" && hasU) ||
    (dir === "D" && hasD);

  if (!ok) {
    console.error("[cellKeys] devAssertNeighborDirection failed", {
      cell: { gx, gy },
      neighbor: { ngx, ngy },
      dir,
      hasL,
      hasR,
      hasU,
      hasD,
    });
  }
}

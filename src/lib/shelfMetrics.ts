/**
 * Shelf layout constants and tunable offsets.
 * Metrics are computed dynamically from textures.
 */
import type { Texture } from "pixi.js";
import type { ShelfTextureKey } from "./shelfAssets";

export interface ShelfMetrics {
  CELL_W: number;
  CELL_H: number;
  BACK_FILL_OFFSET_X: number;
  BACK_FILL_OFFSET_Y: number;
}

/**
 * Computes shelf metrics from loaded textures.
 * CELL_W/CELL_H are derived from texture dimensions.
 * Uses backFill as base, or max of components if needed.
 */
export function computeShelfMetrics(
  textures: Record<ShelfTextureKey, Texture>
): ShelfMetrics {
  const backFill = textures.backFill;
  const edgeTop = textures.edgeTop;
  const edgeBottom = textures.edgeBottom;
  const edgeLeft = textures.edgeLeft;
  const edgeRight = textures.edgeRight;
  const cornerTL = textures.cornerTL;
  const cornerTR = textures.cornerTR;
  const cornerBL = textures.cornerBL;
  const cornerBR = textures.cornerBR;

  // CELL_W = max of:
  // - backFill width
  // - edgeLeft + edgeRight (if they span full width)
  // - cornerTL + cornerTR (if they span full width)
  const cellW = Math.max(
    backFill.width,
    edgeLeft.width + edgeRight.width,
    cornerTL.width + cornerTR.width
  );

  // CELL_H = max of:
  // - backFill height
  // - edgeTop + edgeBottom (if they span full height)
  // - cornerTL + cornerBL (if they span full height)
  const cellH = Math.max(
    backFill.height,
    edgeTop.height + edgeBottom.height,
    cornerTL.height + cornerBL.height
  );

  // Offsets: if backFill is smaller than cell, center it
  const BACK_FILL_OFFSET_X = (cellW - backFill.width) / 2;
  const BACK_FILL_OFFSET_Y = (cellH - backFill.height) / 2;

  return {
    CELL_W: cellW,
    CELL_H: cellH,
    BACK_FILL_OFFSET_X,
    BACK_FILL_OFFSET_Y,
  };
}

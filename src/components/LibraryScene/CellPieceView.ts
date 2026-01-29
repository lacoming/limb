/**
 * Cell piece-based view: assembles a cell from corner/edge/fill/shadow/divider pieces.
 * Handles neighbor-based visibility (no double frames) and tension-based 2.5D effects.
 */
import { Container, Sprite } from "pixi.js";
import type { CellSkinTextures, CellSkinMetrics } from "../../lib/cellSkin";

interface CellPieceViewState {
  backFill: Sprite;
  innerShadow: Sprite;
  cornerTL: Sprite;
  cornerTR: Sprite;
  cornerBL: Sprite;
  cornerBR: Sprite;
  edgeTop: Sprite;
  edgeBottom: Sprite;
  edgeLeft: Sprite;
  edgeRight: Sprite;
  dividerRight: Sprite;
  dividerBottom: Sprite;
  metrics: CellSkinMetrics;
  prevAxis: 'x' | 'y' | null;
  baseShadowX: number;
  baseShadowY: number;
}

const CELL_PIECE_VIEW_STATE = Symbol("cellPieceViewState");

type CellPieceViewContainer = Container &
  Record<typeof CELL_PIECE_VIEW_STATE, CellPieceViewState>;

const AXIS_LOCK_DELTA = 10; // px - same as in cellFrames.ts
const MAX_ROTATION_RAD = (5 * Math.PI) / 180; // 5 degrees
const PARALLAX_MAX_PX = 12; // S parameter: 8-16px range, using 12

/**
 * Creates a cell container assembled from piece textures.
 * All sprites are created once and only visibility/position/scale/rotation change.
 */
export function createCellPieceView(
  textures: CellSkinTextures,
  metrics: CellSkinMetrics
): Container {
  const container = new Container();

  // Inner content (always visible)
  const backFill = new Sprite({ texture: textures.backFill });
  const innerShadow = new Sprite({ texture: textures.innerShadow });

  // Outer frame corners
  const cornerTL = new Sprite({ texture: textures.cornerTL });
  const cornerTR = new Sprite({ texture: textures.cornerTR });
  const cornerBL = new Sprite({ texture: textures.cornerBL });
  const cornerBR = new Sprite({ texture: textures.cornerBR });

  // Outer frame edges
  const edgeTop = new Sprite({ texture: textures.edgeTop });
  const edgeBottom = new Sprite({ texture: textures.edgeBottom });
  const edgeLeft = new Sprite({ texture: textures.edgeLeft });
  const edgeRight = new Sprite({ texture: textures.edgeRight });

  // Dividers (only shown when neighbor exists)
  const dividerRight = new Sprite({ texture: textures.dividerV });
  const dividerBottom = new Sprite({ texture: textures.dividerH });

  // Position inner content
  const innerOriginX = metrics.frameLeftW;
  const innerOriginY = metrics.frameTopH;
  backFill.position.set(innerOriginX, innerOriginY);
  innerShadow.position.set(innerOriginX, innerOriginY);

  // Position corners
  cornerTL.position.set(0, 0);
  cornerTR.position.set(metrics.frameLeftW + metrics.innerW, 0);
  cornerBL.position.set(0, metrics.frameTopH + metrics.innerH);
  cornerBR.position.set(
    metrics.frameLeftW + metrics.innerW,
    metrics.frameTopH + metrics.innerH
  );

  // Position edges
  edgeTop.position.set(innerOriginX, 0);
  edgeBottom.position.set(innerOriginX, metrics.frameTopH + metrics.innerH);
  edgeLeft.position.set(0, innerOriginY);
  edgeRight.position.set(metrics.frameLeftW + metrics.innerW, innerOriginY);

  // Scale edges to match inner dimensions
  // Top/bottom edges stretch horizontally to innerW
  edgeTop.scale.x = metrics.innerW / textures.edgeTop.width;
  edgeBottom.scale.x = metrics.innerW / textures.edgeBottom.width;

  // Left/right edges stretch vertically to innerH
  edgeLeft.scale.y = metrics.innerH / textures.edgeLeft.height;
  edgeRight.scale.y = metrics.innerH / textures.edgeRight.height;

  // Position dividers
  dividerRight.position.set(
    metrics.frameLeftW + metrics.innerW,
    innerOriginY
  );
  dividerRight.scale.y = metrics.innerH / textures.dividerV.height;

  dividerBottom.position.set(
    innerOriginX,
    metrics.frameTopH + metrics.innerH
  );
  dividerBottom.scale.x = metrics.innerW / textures.dividerH.width;

  // Initially hide all conditional elements
  cornerTL.visible = false;
  cornerTR.visible = false;
  cornerBL.visible = false;
  cornerBR.visible = false;
  edgeTop.visible = false;
  edgeBottom.visible = false;
  edgeLeft.visible = false;
  edgeRight.visible = false;
  dividerRight.visible = false;
  dividerBottom.visible = false;

  // Add all children in render order (back to front)
  container.addChild(
    backFill,
    innerShadow,
    edgeLeft,
    edgeRight,
    edgeTop,
    edgeBottom,
    cornerTL,
    cornerTR,
    cornerBL,
    cornerBR,
    dividerRight,
    dividerBottom
  );

  const state: CellPieceViewState = {
    backFill,
    innerShadow,
    cornerTL,
    cornerTR,
    cornerBL,
    cornerBR,
    edgeTop,
    edgeBottom,
    edgeLeft,
    edgeRight,
    dividerRight,
    dividerBottom,
    metrics,
    prevAxis: null,
    baseShadowX: innerOriginX,
    baseShadowY: innerOriginY,
  };

  (container as CellPieceViewContainer)[CELL_PIECE_VIEW_STATE] = state;

  return container;
}

/**
 * Updates neighbor-based visibility of frame edges, corners, and dividers.
 * Called when grid changes (cell added/removed) to update affected cells.
 */
export function setCellNeighbors(
  container: Container,
  neighbors: { top: boolean; bottom: boolean; left: boolean; right: boolean }
): void {
  const state = (container as CellPieceViewContainer)[CELL_PIECE_VIEW_STATE];
  if (!state) return;

  // Corners: visible only when both adjacent edges are external
  state.cornerTL.visible = !neighbors.top && !neighbors.left;
  state.cornerTR.visible = !neighbors.top && !neighbors.right;
  state.cornerBL.visible = !neighbors.bottom && !neighbors.left;
  state.cornerBR.visible = !neighbors.bottom && !neighbors.right;

  // Edges: visible only when no neighbor on that side
  state.edgeTop.visible = !neighbors.top;
  state.edgeBottom.visible = !neighbors.bottom;
  state.edgeLeft.visible = !neighbors.left;
  state.edgeRight.visible = !neighbors.right;

  // Dividers: only the "owner" cell draws them on its right/bottom edge
  state.dividerRight.visible = neighbors.right;
  state.dividerBottom.visible = neighbors.bottom;
}

/**
 * Updates tension-based 2.5D effects (rotation and parallax).
 * vecX, vecY are screen-space offsets from center (as in current drag logic).
 * Returns step (0..9) and axis for debug purposes.
 */
export function setCellTension(
  container: Container,
  vecX: number,
  vecY: number
): { step: number; axis: 'x' | 'y' | null } {
  const state = (container as CellPieceViewContainer)[CELL_PIECE_VIEW_STATE];
  if (!state) return { step: 0, axis: null };

  const absX = Math.abs(vecX);
  const absY = Math.abs(vecY);
  const mag = Math.max(absX, absY);
  const clampMag = Math.min(mag, 150);
  const step = Math.round((clampMag / 150) * 9); // 0..9

  // Axis selection with hysteresis (same logic as computeFrameState)
  let axis: 'x' | 'y' | null;
  if (state.prevAxis !== null) {
    const prevAxisVal = state.prevAxis === 'x' ? absX : absY;
    const otherAxisVal = state.prevAxis === 'x' ? absY : absX;
    if (prevAxisVal >= otherAxisVal - AXIS_LOCK_DELTA) {
      axis = state.prevAxis;
    } else {
      axis = absX >= absY ? 'x' : 'y';
    }
  } else {
    axis = absX >= absY ? 'x' : 'y';
  }

  state.prevAxis = axis;

  // Apply rotation (up to 5 degrees)
  if (mag > 0 && axis !== null) {
    const rotationFactor = clampMag / 150; // 0..1
    const rotationSign =
      axis === 'x' ? (vecX >= 0 ? 1 : -1) : vecY >= 0 ? 1 : -1;
    container.rotation = rotationFactor * MAX_ROTATION_RAD * rotationSign;
  } else {
    container.rotation = 0;
  }

  // Apply parallax to innerShadow (opposite to drag direction)
  const parallaxFactor = step / 9; // 0..1
  const parallaxX =
    vecX !== 0 ? -(vecX / Math.abs(vecX)) * parallaxFactor * PARALLAX_MAX_PX : 0;
  const parallaxY =
    vecY !== 0 ? -(vecY / Math.abs(vecY)) * parallaxFactor * PARALLAX_MAX_PX : 0;

  state.innerShadow.position.set(
    state.baseShadowX + parallaxX,
    state.baseShadowY + parallaxY
  );

  return { step, axis };
}

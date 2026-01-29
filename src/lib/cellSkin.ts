/**
 * Cell skin texture loader and metrics calculator.
 * Loads all piece-based assets (corners, edges, fill, shadow, dividers) and computes cell dimensions.
 */
import { Assets, Texture } from "pixi.js";

export interface CellSkinTextures {
  backFill: Texture;
  innerShadow: Texture;
  dividerH: Texture;
  dividerV: Texture;
  cornerTL: Texture;
  cornerTR: Texture;
  cornerBL: Texture;
  cornerBR: Texture;
  edgeTop: Texture;
  edgeBottom: Texture;
  edgeLeft: Texture;
  edgeRight: Texture;
}

export interface CellSkinMetrics {
  frameLeftW: number;
  frameRightW: number;
  frameTopH: number;
  frameBottomH: number;
  innerW: number;
  innerH: number;
  cellW: number;
  cellH: number;
  dividerVw: number;
  dividerHh: number;
}

let cachedTextures: CellSkinTextures | null = null;
let loadPromise: Promise<CellSkinTextures> | null = null;

/**
 * Loads all cell skin textures from /sprites/cell/assets/.
 * Caches result and returns the same promise on subsequent calls.
 */
export async function loadCellSkinTextures(): Promise<CellSkinTextures> {
  if (cachedTextures) {
    return cachedTextures;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const [
      backFill,
      innerShadow,
      dividerH,
      dividerV,
      cornerTL,
      cornerTR,
      cornerBL,
      cornerBR,
      edgeTop,
      edgeBottom,
      edgeLeft,
      edgeRight,
    ] = await Promise.all([
      Assets.load("/sprites/cell/assets/back_fill.png"),
      Assets.load("/sprites/cell/assets/inner_shadow.png"),
      Assets.load("/sprites/cell/assets/divider_horizontal.png"),
      Assets.load("/sprites/cell/assets/divider_vertical.png"),
      Assets.load("/sprites/cell/assets/outer_frame_corner_tl.png"),
      Assets.load("/sprites/cell/assets/outer_frame_corner_tr.png"),
      Assets.load("/sprites/cell/assets/outer_frame_corner_bl.png"),
      Assets.load("/sprites/cell/assets/outer_frame_corner_br.png"),
      Assets.load("/sprites/cell/assets/outer_frame_edge_top.png"),
      Assets.load("/sprites/cell/assets/outer_frame_edge_bottom.png"),
      Assets.load("/sprites/cell/assets/outer_frame_edge_left.png"),
      Assets.load("/sprites/cell/assets/outer_frame_edge_right.png"),
    ]);

    const textures: CellSkinTextures = {
      backFill: backFill as Texture,
      innerShadow: innerShadow as Texture,
      dividerH: dividerH as Texture,
      dividerV: dividerV as Texture,
      cornerTL: cornerTL as Texture,
      cornerTR: cornerTR as Texture,
      cornerBL: cornerBL as Texture,
      cornerBR: cornerBR as Texture,
      edgeTop: edgeTop as Texture,
      edgeBottom: edgeBottom as Texture,
      edgeLeft: edgeLeft as Texture,
      edgeRight: edgeRight as Texture,
    };

    cachedTextures = textures;
    loadPromise = null;
    return textures;
  })();

  return loadPromise;
}

/**
 * Computes cell skin metrics from loaded textures.
 * All dimensions are derived from texture sizes - no hardcoded values.
 */
export function computeCellSkinMetrics(
  textures: CellSkinTextures
): CellSkinMetrics {
  const frameLeftW = textures.edgeLeft.width;
  const frameRightW = textures.edgeRight.width;
  const frameTopH = textures.edgeTop.height;
  const frameBottomH = textures.edgeBottom.height;

  // Use inner_shadow as the reference for inner dimensions
  const innerW = textures.innerShadow.width;
  const innerH = textures.innerShadow.height;

  const cellW = frameLeftW + innerW + frameRightW;
  const cellH = frameTopH + innerH + frameBottomH;

  const dividerVw = textures.dividerV.width;
  const dividerHh = textures.dividerH.height;

  return {
    frameLeftW,
    frameRightW,
    frameTopH,
    frameBottomH,
    innerW,
    innerH,
    cellW,
    cellH,
    dividerVw,
    dividerHh,
  };
}

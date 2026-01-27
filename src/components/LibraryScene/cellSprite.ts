/**
 * 2.5D cell: turntable (N frames by yaw) or legacy front/right crossfade.
 * No allocations in update functions (state stored on container).
 */
import { Container, Graphics, Sprite, type Texture } from "pixi.js";

const DEFAULT_TARGET_HEIGHT = 300;
const CELL_W = 300;
const CELL_H = 300;
const TURNTABLE_DEG_PER_FRAME = 15;
const OFFSET_FRONT_X = 0;
const OFFSET_FRONT_Y = 0;
const OFFSET_RIGHT_X = 0;
const OFFSET_RIGHT_Y = 0;
const THRESHOLD_IN = 80;
const THRESHOLD_OUT = 50;
const LERP_K = 10;
const SHIFT_X = 18;
const FRONT_SCALE_X_END = 0.88;
const RIGHT_SCALE_X_START = 1.1;
const SHADOW_WIDTH = 24;
const SHADOW_X = 12;
const SHADOW_ALPHA_PEAK = 0.2;

interface CellViewState {
  smoothFactor: number;
  front: Sprite;
  right: Sprite;
  shadow: Graphics;
  frontScaleXBase: number;
  frontScaleYBase: number;
  rightScaleXBase: number;
  rightScaleYBase: number;
}

const CELL_VIEW_STATE = Symbol("cellViewState");

export interface CreateCellContainerOptions {
  targetHeight?: number;
}

/**
 * Creates a container with front and right sprites. Both use anchor (0.5, 0.5)
 * at (0,0) so the "cell center" aligns and switching view doesn't jump.
 * Both sprites use the same CELL_W x CELL_H for normalized visual size.
 */
export function createCellContainer(
  textureFront: Texture,
  textureRight: Texture,
  options?: CreateCellContainerOptions
): Container {
  const cellH = options?.targetHeight ?? CELL_H;
  const cellW = options?.targetHeight ?? CELL_W;

  const frontSprite = new Sprite({
    texture: textureFront,
    anchor: 0.5,
  });
  const rightSprite = new Sprite({
    texture: textureRight,
    anchor: 0.5,
  });

  const frontScaleXBase = cellW / textureFront.width;
  const frontScaleYBase = cellH / textureFront.height;
  const rightScaleXBase = cellW / textureRight.width;
  const rightScaleYBase = cellH / textureRight.height;

  frontSprite.scale.set(frontScaleXBase, frontScaleYBase);
  rightSprite.scale.set(rightScaleXBase, rightScaleYBase);

  frontSprite.position.set(OFFSET_FRONT_X, OFFSET_FRONT_Y);
  rightSprite.position.set(OFFSET_RIGHT_X, OFFSET_RIGHT_Y);

  frontSprite.alpha = 1;
  rightSprite.alpha = 0;

  const shadow = new Graphics();

  const cell = new Container();
  cell.addChild(shadow, frontSprite, rightSprite);

  const viewState: CellViewState = {
    smoothFactor: 0,
    front: frontSprite,
    right: rightSprite,
    shadow,
    frontScaleXBase,
    frontScaleYBase,
    rightScaleXBase,
    rightScaleYBase,
  };
  (cell as Container & { [CELL_VIEW_STATE]: CellViewState })[
    CELL_VIEW_STATE
  ] = viewState;

  return cell;
}

/**
 * Updates front/right alpha, pseudo-rotation (scale.x, x-shift), and inner
 * shadow from offsetXScreen (positive = cell to the right of viewport center).
 * Uses hysteresis and lerp; no allocations.
 */
export function updateCellViewOffset(
  cell: Container,
  offsetXScreen: number,
  deltaMS: number
): void {
  const viewState = (cell as Container & { [CELL_VIEW_STATE]?: CellViewState })[
    CELL_VIEW_STATE
  ];
  if (!viewState) return;

  let rawFactor: number;
  if (offsetXScreen >= THRESHOLD_IN) {
    rawFactor = 1;
  } else if (offsetXScreen <= THRESHOLD_OUT) {
    rawFactor = 0;
  } else {
    rawFactor =
      (offsetXScreen - THRESHOLD_OUT) / (THRESHOLD_IN - THRESHOLD_OUT);
  }

  const lerpK = 1 - Math.exp(-LERP_K * (deltaMS / 1000));
  viewState.smoothFactor += lerpK * (rawFactor - viewState.smoothFactor);

  const t = viewState.smoothFactor;
  const { front, right, shadow } = viewState;

  front.scale.x = viewState.frontScaleXBase * (1 + t * (FRONT_SCALE_X_END - 1));
  front.scale.y = viewState.frontScaleYBase;
  right.scale.x =
    viewState.rightScaleXBase *
    (RIGHT_SCALE_X_START + t * (1 - RIGHT_SCALE_X_START));
  right.scale.y = viewState.rightScaleYBase;

  front.position.x = OFFSET_FRONT_X + t * -SHIFT_X;
  front.position.y = OFFSET_FRONT_Y;
  right.position.x = OFFSET_RIGHT_X + (1 - t) * SHIFT_X;
  right.position.y = OFFSET_RIGHT_Y;

  front.alpha = 1 - t;
  right.alpha = t;

  shadow.x = -SHADOW_X + t * (2 * SHADOW_X);
  shadow.alpha = SHADOW_ALPHA_PEAK * 4 * t * (1 - t);
  shadow.clear();
  shadow.rect(-SHADOW_WIDTH / 2, -CELL_H / 2, SHADOW_WIDTH, CELL_H).fill({
    color: 0x000000,
    alpha: 1,
  });
}

// --- Three-view (strict front, ±5° yaw on strong pull) ---

const MAX_YAW_RAD = Math.PI / 36;
const ENTER_SIDE_PX = 120;
const EXIT_SIDE_PX = 70;
const THREE_VIEW_LERP_K = 10;

export type ViewMode = "front" | "left" | "right";

interface ThreeViewState {
  smoothOffsetX: number;
  yaw: number;
  viewMode: ViewMode;
  front: Sprite;
  right: Sprite;
  left: Sprite;
}

const THREE_VIEW_STATE = Symbol("threeViewState");

type CellWithThreeViewState = Container &
  Record<typeof THREE_VIEW_STATE, ThreeViewState | undefined>;

/**
 * Creates a container with front, right, and left sprites. In rest: front only, yaw=0.
 * On strong pull (|offsetX| > ENTER_SIDE_PX): left/right view and up to ±5° yaw.
 * If leftTexture is omitted, left uses rightTexture with scale.x = -1.
 * All sprites anchor 0.5, same visual size, position (0,0).
 */
export function createCellContainerThreeView(
  frontTexture: Texture,
  rightTexture: Texture,
  leftTexture?: Texture,
  options?: CreateCellContainerOptions
): Container {
  const cellH = options?.targetHeight ?? CELL_H;
  const cellW = options?.targetHeight ?? CELL_W;
  const leftTex = leftTexture ?? rightTexture;

  const front = new Sprite({ texture: frontTexture, anchor: 0.5 });
  const right = new Sprite({ texture: rightTexture, anchor: 0.5 });
  const left = new Sprite({ texture: leftTex, anchor: 0.5 });

  const frontScaleX = cellW / frontTexture.width;
  const frontScaleY = cellH / frontTexture.height;
  const rightScaleX = cellW / rightTexture.width;
  const rightScaleY = cellH / rightTexture.height;
  const leftScaleX = cellW / leftTex.width;
  const leftScaleY = cellH / leftTex.height;

  front.scale.set(frontScaleX, frontScaleY);
  right.scale.set(rightScaleX, rightScaleY);
  left.scale.set(leftTexture ? leftScaleX : -leftScaleX, leftScaleY);

  front.position.set(0, 0);
  right.position.set(0, 0);
  left.position.set(0, 0);

  front.alpha = 1;
  right.alpha = 0;
  left.alpha = 0;

  const cell = new Container();
  cell.addChild(front, right, left);

  const viewState: ThreeViewState = {
    smoothOffsetX: 0,
    yaw: 0,
    viewMode: "front",
    front,
    right,
    left,
  };
  (cell as CellWithThreeViewState)[THREE_VIEW_STATE] = viewState;

  return cell;
}

/**
 * Updates three-view cell from offsetXScreen (cell center X - viewport center X).
 * When !isDragging, target offset is 0 so view and yaw spring back to front.
 * No allocations.
 */
export function updateCellThreeView(
  cell: Container,
  offsetXScreen: number,
  isDragging: boolean,
  deltaMS: number
): void {
  const viewState = (cell as CellWithThreeViewState)[THREE_VIEW_STATE];
  if (!viewState) return;

  const targetOffset = isDragging ? offsetXScreen : 0;
  const lerpK = 1 - Math.exp(-THREE_VIEW_LERP_K * (deltaMS / 1000));
  viewState.smoothOffsetX += lerpK * (targetOffset - viewState.smoothOffsetX);

  const sx = viewState.smoothOffsetX;
  const absSx = Math.abs(sx);

  if (viewState.viewMode === "front" && absSx > ENTER_SIDE_PX) {
    viewState.viewMode = sx > 0 ? "right" : "left";
  } else if (viewState.viewMode !== "front" && absSx < EXIT_SIDE_PX) {
    viewState.viewMode = "front";
  }

  const yawTarget = Math.max(
    -MAX_YAW_RAD,
    Math.min(MAX_YAW_RAD, (sx / ENTER_SIDE_PX) * MAX_YAW_RAD)
  );
  viewState.yaw += lerpK * (yawTarget - viewState.yaw);

  cell.rotation = viewState.yaw;

  const { front, right, left } = viewState;
  const mode = viewState.viewMode;

  if (mode === "front") {
    front.alpha = 1;
    right.alpha = 0;
    left.alpha = 0;
  } else if (mode === "right") {
    const t = Math.min(1, (absSx - EXIT_SIDE_PX) / (ENTER_SIDE_PX - EXIT_SIDE_PX));
    front.alpha = 1 - t;
    right.alpha = t;
    left.alpha = 0;
  } else {
    const t = Math.min(1, (absSx - EXIT_SIDE_PX) / (ENTER_SIDE_PX - EXIT_SIDE_PX));
    front.alpha = 1 - t;
    right.alpha = 0;
    left.alpha = t;
  }
}

// --- Front-only + shadow layers (cell_main always, no turntable) ---

const SHADOW_ENTER_PX = 120;
const SHADOW_MAX_PX = 240;
const SHADOW_STRIP_WIDTH = 48;
const SHADOW_LERP_K = 10;
const KINETIC_SCALE_MIN = 0.98;
const KINETIC_SHIFT_PX = 6;

interface FrontWithShadowsState {
  smoothOffsetX: number;
  smoothFactor: number;
  front: Sprite;
  rightShadow: Graphics;
  leftShadow: Graphics;
  frontScaleXBase: number;
  frontScaleYBase: number;
}

const FRONT_WITH_SHADOWS_STATE = Symbol("frontWithShadowsState");

type CellWithFrontShadowsState = Container &
  Record<typeof FRONT_WITH_SHADOWS_STATE, FrontWithShadowsState | undefined>;

/**
 * Front always uses one texture (e.g. cell_main.png). No turntable/frame swap.
 * Two shadow layers (Graphics) drawn once; only alpha/transform updated in tick.
 */
export function createCellContainerFrontWithShadows(
  frontTexture: Texture,
  options?: CreateCellContainerOptions
): Container {
  const cellH = options?.targetHeight ?? CELL_H;
  const cellW = options?.targetHeight ?? CELL_W;

  const front = new Sprite({ texture: frontTexture, anchor: 0.5 });
  const frontScaleXBase = cellW / frontTexture.width;
  const frontScaleYBase = cellH / frontTexture.height;
  front.scale.set(frontScaleXBase, frontScaleYBase);
  front.position.set(0, 0);
  front.alpha = 1;

  const rightShadow = new Graphics();
  rightShadow.rect(cellW / 2, -cellH / 2, SHADOW_STRIP_WIDTH, cellH).fill({
    color: 0x000000,
    alpha: 1,
  });
  rightShadow.alpha = 0;

  const leftShadow = new Graphics();
  leftShadow
    .rect(-cellW / 2 - SHADOW_STRIP_WIDTH, -cellH / 2, SHADOW_STRIP_WIDTH, cellH)
    .fill({ color: 0x000000, alpha: 1 });
  leftShadow.alpha = 0;

  const cell = new Container();
  cell.addChild(front, rightShadow, leftShadow);

  const viewState: FrontWithShadowsState = {
    smoothOffsetX: 0,
    smoothFactor: 0,
    front,
    rightShadow,
    leftShadow,
    frontScaleXBase,
    frontScaleYBase,
  };
  (cell as CellWithFrontShadowsState)[FRONT_WITH_SHADOWS_STATE] = viewState;

  return cell;
}

/**
 * Updates front+shadows from offsetXScreen. No allocations; only alpha/transform.
 */
export function updateCellFrontWithShadows(
  cell: Container,
  offsetXScreen: number,
  isDragging: boolean,
  deltaMS: number
): void {
  const viewState = (cell as CellWithFrontShadowsState)[FRONT_WITH_SHADOWS_STATE];
  if (!viewState) return;

  const targetOffset = isDragging ? offsetXScreen : 0;
  const lerpK = 1 - Math.exp(-SHADOW_LERP_K * (deltaMS / 1000));
  viewState.smoothOffsetX += lerpK * (targetOffset - viewState.smoothOffsetX);

  const sx = viewState.smoothOffsetX;
  const absSx = Math.abs(sx);
  const rawFactor = Math.max(
    0,
    Math.min(1, (absSx - SHADOW_ENTER_PX) / (SHADOW_MAX_PX - SHADOW_ENTER_PX))
  );
  viewState.smoothFactor += lerpK * (rawFactor - viewState.smoothFactor);

  const f = viewState.smoothFactor;
  const { front, rightShadow, leftShadow, frontScaleXBase, frontScaleYBase } =
    viewState;

  rightShadow.alpha = sx > 0 ? f : 0;
  leftShadow.alpha = sx < 0 ? f : 0;

  const scaleX =
    frontScaleXBase * (1 + f * (KINETIC_SCALE_MIN - 1));
  front.scale.set(scaleX, frontScaleYBase);
  front.position.x =
    sx > 0 ? -KINETIC_SHIFT_PX * f : sx < 0 ? KINETIC_SHIFT_PX * f : 0;
}

// --- Turntable (2.5D from pre-rendered frames) ---

interface TurntableViewState {
  textures: Texture[];
  sprite: Sprite;
  shadow: Graphics;
  scaleX: number;
  scaleY: number;
}

const TURNTABLE_VIEW_STATE = Symbol("turntableViewState");

type CellWithTurntableState = Container & Record<typeof TURNTABLE_VIEW_STATE, TurntableViewState | undefined>;

/**
 * Creates a container with one sprite that shows the turntable frame for the current yaw.
 * textures[i] = frame at angle i * 15° (0° = front).
 */
export function createCellContainerTurntable(
  textures: Texture[],
  options?: CreateCellContainerOptions
): Container {
  if (textures.length === 0) throw new Error("createCellContainerTurntable needs at least one texture");
  const cellH = options?.targetHeight ?? CELL_H;
  const cellW = options?.targetHeight ?? CELL_W;
  const tex = textures[0];
  const scaleX = cellW / tex.width;
  const scaleY = cellH / tex.height;

  const sprite = new Sprite({
    texture: tex,
    anchor: 0.5,
  });
  sprite.scale.set(scaleX, scaleY);
  sprite.position.set(0, 0);

  const shadow = new Graphics();

  const cell = new Container();
  cell.addChild(shadow, sprite);

  const viewState: TurntableViewState = {
    textures,
    sprite,
    shadow,
    scaleX,
    scaleY,
  };
  (cell as CellWithTurntableState)[TURNTABLE_VIEW_STATE] = viewState;

  return cell;
}

/**
 * Updates the visible turntable frame from yaw (degrees), clamped to ±30° UX range.
 * frameIndex = (24 + round(yaw / 15)) % 24. No allocations.
 */
export function updateCellTurntable(
  cell: Container,
  yawDeg: number,
  _deltaMS?: number
): void {
  const viewState = (cell as CellWithTurntableState)[TURNTABLE_VIEW_STATE];
  if (!viewState) return;

  const n = viewState.textures.length;
  const idx =
    ((n + Math.round(yawDeg / TURNTABLE_DEG_PER_FRAME)) % n + n) % n;
  viewState.sprite.texture = viewState.textures[idx];
}

// --- Turntable frames (2.5D from direction-based frames) ---

import {
  Direction,
  type FrameState,
  computeFrameState,
  getCachedTextures,
} from "./cellFrames";

interface TurntableFramesState {
  sprite: Sprite;
  currentDir: Direction;
  currentFrameIndex: number;
  t: number; // smoothed t value (0..1) for frame interpolation
  prevAxis: 'x' | 'y' | null; // previous winning axis for hysteresis
  scaleX: number;
  scaleY: number;
}

const TURNTABLE_FRAMES_STATE = Symbol("turntableFramesState");

type CellWithTurntableFramesState = Container &
  Record<typeof TURNTABLE_FRAMES_STATE, TurntableFramesState | undefined>;

/**
 * Creates a container with one sprite that shows turntable frames based on drag offset.
 * Initially shows idle frame (frame 1 from any direction).
 * Textures must be preloaded before calling this function - uses only cached textures.
 */
export async function createCellContainerTurntableFrames(
  options?: CreateCellContainerOptions
): Promise<Container> {
  const cellH = options?.targetHeight ?? CELL_H;
  const cellW = options?.targetHeight ?? CELL_W;

  // Get idle frame (frame 1 from left direction, which is the same in all directions)
  // Atlases should be preloaded before this is called
  const idleTextures = getCachedTextures(Direction.Left);
  if (!idleTextures || idleTextures.length === 0) {
    throw new Error(
      "Atlases must be preloaded before creating cell container. Left direction textures not found in cache."
    );
  }
  const initialTexture = idleTextures[0]; // frame 1

  const sprite = new Sprite({
    texture: initialTexture,
    anchor: 0.5,
  });
  const scaleX = cellW / initialTexture.width;
  const scaleY = cellH / initialTexture.height;
  sprite.scale.set(scaleX, scaleY);
  sprite.position.set(0, 0);

  const cell = new Container();
  cell.addChild(sprite);

  const viewState: TurntableFramesState = {
    sprite,
    currentDir: Direction.Idle,
    currentFrameIndex: 1,
    t: 0,
    prevAxis: null,
    scaleX,
    scaleY,
  };
  (cell as CellWithTurntableFramesState)[TURNTABLE_FRAMES_STATE] = viewState;

  return cell;
}

/**
 * Updates turntable frames from screen offset (offsetX, offsetY).
 * When !isDragging, offset should be 0 so it smoothly returns to idle.
 * No allocations - reuses state objects.
 * Textures should be preloaded before use - only uses cached textures.
 * If atlasesReady is false, always shows idle frame (frame 1) regardless of offset.
 * Returns the computed frame state for debug purposes.
 */
export function updateCellTurntableFrames(
  cell: Container,
  offsetX: number,
  offsetY: number,
  isDragging: boolean,
  deltaMS: number,
  atlasesReady: boolean = true
): FrameState | null {
  const viewState = (cell as CellWithTurntableFramesState)[
    TURNTABLE_FRAMES_STATE
  ];
  if (!viewState) return null;

  // Gate: if atlases not ready, always show idle frame
  if (!atlasesReady) {
    const idleDir = Direction.Idle;
    const idleFrameIndex = 1;
    
    if (
      viewState.currentDir !== idleDir ||
      viewState.currentFrameIndex !== idleFrameIndex
    ) {
      viewState.currentDir = idleDir;
      viewState.currentFrameIndex = idleFrameIndex;
      
      // Show idle frame (frame 1 from left direction)
      const textures = getCachedTextures(Direction.Left);
      if (textures && textures.length > 0) {
        viewState.sprite.texture = textures[0]; // frame_01 (index 0)
      }
    }
    
    // Return idle state
    return {
      dir: idleDir,
      frameIndex: idleFrameIndex,
      t: 0,
      mag: 0,
      offsetX: 0,
      offsetY: 0,
      absX: 0,
      absY: 0,
      axis: null,
    };
  }

  // When not dragging, offset should already be approaching 0 via spring
  const effectiveOffsetX = isDragging ? offsetX : 0;
  const effectiveOffsetY = isDragging ? offsetY : 0;

  // Compute frame state
  const frameState = computeFrameState(
    effectiveOffsetX,
    effectiveOffsetY,
    viewState.t,
    deltaMS,
    viewState.prevAxis
  );

  // Update state
  viewState.t = frameState.t;
  viewState.prevAxis = frameState.axis;
  const newDir = frameState.dir;
  const newFrameIndex = frameState.frameIndex;

  // Update sprite texture if direction or frame changed
  // Textures should be preloaded, so we only use cached textures (no async loading)
  if (
    newDir !== viewState.currentDir ||
    newFrameIndex !== viewState.currentFrameIndex
  ) {
    viewState.currentDir = newDir;
    viewState.currentFrameIndex = newFrameIndex;

    // Get textures for current direction (idle uses left)
    const dirForTextures =
      newDir === Direction.Idle ? Direction.Left : newDir;
    const textures = getCachedTextures(dirForTextures);
    
    if (textures) {
      // frameIndex is 1-based, array index is 0-based
      const textureIndex = newFrameIndex - 1;
      if (textureIndex >= 0 && textureIndex < textures.length) {
        viewState.sprite.texture = textures[textureIndex];
      }
    }
    // If textures not loaded yet (shouldn't happen if preloaded), sprite keeps showing previous frame
  }

  return frameState;
}

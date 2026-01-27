/**
 * 2D camera math: pan, zoom-about-point, world↔screen, content bounds, rubber-band.
 * Origin: camera at center (cx, cy = world under screen center).
 */

export interface CameraState {
  cx: number;
  cy: number;
  s: number;
}

export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** AABB of one cell at (0,0) in 2D isometric space (drawCell w=80,d=50,h=40). x'∈[-65,65], y'∈[-72.5,32.5]. */
const CELL_2D_MIN_X = -65;
const CELL_2D_MIN_Y = -72.5;
const CELL_2D_MAX_X = 65;
const CELL_2D_MAX_Y = 32.5;
const CONTENT_PADDING = 32;

export const CONTENT_BOUNDS: ContentBounds = {
  minX: CELL_2D_MIN_X - CONTENT_PADDING,
  minY: CELL_2D_MIN_Y - CONTENT_PADDING,
  maxX: CELL_2D_MAX_X + CONTENT_PADDING,
  maxY: CELL_2D_MAX_Y + CONTENT_PADDING,
};

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;

/** Fraction of half-screen (in world units) with no resistance; ~25% = can drag noticeably. */
export const freeRadiusFactor = 0.25;
/** Overshoot compression beyond free radius (0 = wall, 1 = no resistance). */
export const rubberConstant = 0.9;
export const springStiffness = 180;
export const springDamping = 22;

export function getSingleCellCenterTarget(
  bounds: ContentBounds
): { cx: number; cy: number } {
  return {
    cx: (bounds.minX + bounds.maxX) / 2,
    cy: (bounds.minY + bounds.maxY) / 2,
  };
}

export function createInitialCamera(): CameraState {
  return { cx: 0, cy: 0, s: 1 };
}

export function screenToWorld(
  sx: number,
  sy: number,
  state: CameraState,
  screenW: number,
  screenH: number
): { x: number; y: number } {
  return {
    x: (sx - screenW / 2) / state.s + state.cx,
    y: (sy - screenH / 2) / state.s + state.cy,
  };
}

export function worldToScreen(
  wx: number,
  wy: number,
  state: CameraState,
  screenW: number,
  screenH: number
): { x: number; y: number } {
  return {
    x: (wx - state.cx) * state.s + screenW / 2,
    y: (wy - state.cy) * state.s + screenH / 2,
  };
}

export function pan(state: CameraState, dxWorld: number, dyWorld: number): void {
  state.cx += dxWorld;
  state.cy += dyWorld;
}

export function clampZoom(state: CameraState): void {
  state.s = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.s));
}

export function zoomAboutScreenPoint(
  state: CameraState,
  sx: number,
  sy: number,
  factor: number,
  screenW: number,
  screenH: number
): void {
  const { x: wx, y: wy } = screenToWorld(sx, sy, state, screenW, screenH);
  state.s *= factor;
  clampZoom(state);
  state.cx = wx - (sx - screenW / 2) / state.s;
  state.cy = wy - (sy - screenH / 2) / state.s;
}

/** Returns position and scale for the world container (camera-at-center). */
export function getWorldTransform(
  state: CameraState,
  screenW: number,
  screenH: number
): { x: number; y: number; scale: number } {
  return {
    x: -state.cx * state.s + screenW / 2,
    y: -state.cy * state.s + screenH / 2,
    scale: state.s,
  };
}

/** Writes transform into out (no allocation). Use in ticker. */
export function getWorldTransformInto(
  state: CameraState,
  screenW: number,
  screenH: number,
  out: { x: number; y: number; scale: number }
): void {
  out.x = -state.cx * state.s + screenW / 2;
  out.y = -state.cy * state.s + screenH / 2;
  out.scale = state.s;
}

/** Nearest valid camera position so the view rect stays inside bounds. View = [cx ± screenW/(2s), cy ± screenH/(2s)]. */
export function getClampedCameraPosition(
  state: CameraState,
  screenW: number,
  screenH: number,
  bounds: ContentBounds
): { cx: number; cy: number } {
  const hw = screenW / (2 * state.s);
  const hh = screenH / (2 * state.s);
  const cxMin = bounds.minX + hw;
  const cxMax = bounds.maxX - hw;
  const cyMin = bounds.minY + hh;
  const cyMax = bounds.maxY - hh;
  const cx =
    cxMin <= cxMax
      ? Math.max(cxMin, Math.min(cxMax, state.cx))
      : (bounds.minX + bounds.maxX) / 2;
  const cy =
    cyMin <= cyMax
      ? Math.max(cyMin, Math.min(cyMax, state.cy))
      : (bounds.minY + bounds.maxY) / 2;
  return { cx, cy };
}

/**
 * Pan by screen delta with rubber-from-center only (no clamp).
 * Within freeRadius of center: 1:1 follow; beyond: increasing resistance.
 */
export function applyPanWithRubber(
  state: CameraState,
  dScreenX: number,
  dScreenY: number,
  screenW: number,
  screenH: number,
  centerWorld: { cx: number; cy: number }
): void {
  const dxWorld = -dScreenX / state.s;
  const dyWorld = -dScreenY / state.s;
  const rawCx = state.cx + dxWorld;
  const rawCy = state.cy + dyWorld;
  const offX = rawCx - centerWorld.cx;
  const offY = rawCy - centerWorld.cy;
  const freeRadiusX = freeRadiusFactor * (screenW / 2) / state.s;
  const freeRadiusY = freeRadiusFactor * (screenH / 2) / state.s;

  const applyRubber = (
    raw: number,
    center: number,
    freeR: number
  ): number => {
    const off = raw - center;
    const abs = Math.abs(off);
    if (abs <= freeR) return raw;
    const sign = off < 0 ? -1 : 1;
    return center + sign * (freeR + (abs - freeR) * rubberConstant);
  };

  state.cx = applyRubber(rawCx, centerWorld.cx, freeRadiusX);
  state.cy = applyRubber(rawCy, centerWorld.cy, freeRadiusY);
}

const SPRING_DONE_DIST = 0.5;
const SPRING_DONE_V = 0.5;

/**
 * One step of spring toward (targetCx, targetCy). Mutates state and velocity; no allocations.
 * Returns true when settled (dist and velocity below threshold).
 */
export function advanceSpring(
  state: CameraState,
  velocity: { vx: number; vy: number },
  targetCx: number,
  targetCy: number,
  dt: number
): boolean {
  const ax =
    -springStiffness * (state.cx - targetCx) - springDamping * velocity.vx;
  const ay =
    -springStiffness * (state.cy - targetCy) - springDamping * velocity.vy;
  velocity.vx += ax * dt;
  velocity.vy += ay * dt;
  state.cx += velocity.vx * dt;
  state.cy += velocity.vy * dt;
  const dist = Math.hypot(state.cx - targetCx, state.cy - targetCy);
  const v = Math.hypot(velocity.vx, velocity.vy);
  return dist < SPRING_DONE_DIST && v < SPRING_DONE_V;
}

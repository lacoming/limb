/**
 * 2.5D turntable frame management for cell sprites.
 * Handles loading, caching, and frame selection based on drag offset.
 * Uses atlases (spritesheets) for efficient loading.
 */
import { Texture } from "pixi.js";
import {
  loadAtlas,
  getCachedAtlas,
  hasAtlas,
  unloadAllAtlases,
} from "../../lib/cellAtlas";

export enum Direction {
  Idle = "idle",
  Left = "left",
  Right = "right",
  Up = "up",
  Down = "down",
}

export const FRAME_COUNT = 9;
export const STRETCH_MAX_PX = 150;
// Deadzone: 2px on desktop, 3-4px on mobile (touch devices)
export const DEADZONE_PX =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches
    ? 3
    : 2;
export const ENTER_PX = 120;
export const MAX_PX = 300;
export const EXIT_PX = 70;
const K_RISE = 35; // быстро тянем к 9 кадру
const K_FALL = 14; // мягче возвращаемся к 1 кадру
export const AXIS_LOCK_DELTA = 10; // px - порог для анти-дребезга при близких значениях осей

/**
 * Returns the paths to a frame file for a given direction and frame index.
 * Frame indices are 1-based (1..9).
 * Returns both webp and png paths for fallback support.
 * @deprecated Frames are now loaded from atlases, but kept for compatibility.
 */
export function getFramePaths(
  dir: Direction,
  frameIndex: number
): { webp: string; png: string } {
  if (frameIndex < 1 || frameIndex > FRAME_COUNT) {
    throw new Error(`Frame index must be between 1 and ${FRAME_COUNT}`);
  }
  const frameName = `frame_${String(frameIndex).padStart(2, "0")}`;
  const basePath = `/sprites/cell/${dir}/${frameName}`;
  return {
    webp: `${basePath}.webp`,
    png: `${basePath}.png`,
  };
}

/**
 * Returns the path to a frame file for a given direction and frame index.
 * Frame indices are 1-based (1..9).
 * Prefers webp, falls back to png.
 * @deprecated Frames are now loaded from atlases, but kept for compatibility.
 */
export function getFramePath(dir: Direction, frameIndex: number): string {
  const paths = getFramePaths(dir, frameIndex);
  return paths.webp;
}

/**
 * Loads all textures for a direction using atlas (spritesheet).
 * Caches results to avoid reloading.
 * Returns textures array (indices 0..8 correspond to frame indices 1..9).
 */
export async function loadFrameTextures(dir: Direction): Promise<Texture[]> {
  if (dir === Direction.Idle) {
    // Idle uses frame 1 from any direction (they're all the same)
    dir = Direction.Left;
  }

  // Use atlas loader
  return await loadAtlas(dir);
}

export interface FrameState {
  dir: Direction;
  frameIndex: number;
  t: number; // smoothed value 0..1
  mag: number; // magnitude of stretch (only from winning axis)
  // Debug fields
  offsetX: number;
  offsetY: number;
  absX: number;
  absY: number;
  axis: 'x' | 'y' | null; // winning axis
}

/**
 * Computes frame state from screen offset and previous t value.
 * Uses axis priority: compares absolute values, winner axis determines direction and magnitude.
 * Includes hysteresis to prevent flickering when axes are close.
 * Returns direction, frame index (1..9), smoothed t (0..1), and magnitude.
 * No allocations - reuses state object if provided.
 */
export function computeFrameState(
  offsetX: number,
  offsetY: number,
  prevT: number,
  deltaMS: number,
  prevAxis: 'x' | 'y' | null
): FrameState {
  const absX = Math.abs(offsetX);
  const absY = Math.abs(offsetY);

  // Axis selection with hysteresis (anti-flicker)
  let axis: 'x' | 'y' | null;
  if (prevAxis !== null) {
    const prevAxisVal = prevAxis === 'x' ? absX : absY;
    const otherAxisVal = prevAxis === 'x' ? absY : absX;
    // Keep previous axis if it's still winning or within lock delta
    if (prevAxisVal >= otherAxisVal - AXIS_LOCK_DELTA) {
      axis = prevAxis;
    } else {
      // Switch to new winner
      axis = absX >= absY ? 'x' : 'y';
    }
  } else {
    // First selection: pick winner
    axis = absX >= absY ? 'x' : 'y';
  }

  // Magnitude only from winning axis
  const mag = axis === 'x' ? absX : absY;

  // Deadzone: if magnitude is too small, return idle
  if (mag <= DEADZONE_PX) {
    return {
      dir: Direction.Idle,
      frameIndex: 1,
      t: 0,
      mag,
      offsetX,
      offsetY,
      absX,
      absY,
      axis: null,
    };
  }

  // Determine direction based on winning axis
  let dir: Direction;
  if (axis === 'x') {
    dir = offsetX >= 0 ? Direction.Right : Direction.Left;
  } else {
    dir = offsetY >= 0 ? Direction.Down : Direction.Up;
  }

  // Compute raw t (0..1) based on magnitude (only from winning axis)
  const tRaw = Math.min(1, mag / STRETCH_MAX_PX);

  // Smooth t with lerp - choose coefficient based on direction
  const k = tRaw > prevT ? K_RISE : K_FALL;
  const lerpK = 1 - Math.exp(-k * (deltaMS / 1000));
  let tSmoothed = prevT + lerpK * (tRaw - prevT);
  // Clamp tSmoothed to [0, 1]
  tSmoothed = Math.max(0, Math.min(1, tSmoothed));

  // Map tSmoothed to frame index (1..9)
  // Use floor with small epsilon to ensure proper rounding
  const frameIndex = Math.max(1, Math.min(9, 1 + Math.floor(tSmoothed * (FRAME_COUNT - 1) + 1e-6)));

  return {
    dir,
    frameIndex,
    t: tSmoothed,
    mag,
    offsetX,
    offsetY,
    absX,
    absY,
    axis,
  };
}

/**
 * Checks if textures for a direction are already loaded.
 */
export function hasTextures(dir: Direction): boolean {
  if (dir === Direction.Idle) {
    dir = Direction.Left;
  }
  return hasAtlas(dir);
}

/**
 * Gets cached textures for a direction, or null if not loaded yet.
 */
export function getCachedTextures(dir: Direction): Texture[] | null {
  if (dir === Direction.Idle) {
    dir = Direction.Left;
  }
  return getCachedAtlas(dir);
}

/**
 * Unloads all cached textures. Call on cleanup.
 */
export function unloadAllTextures(): void {
  unloadAllAtlases();
}

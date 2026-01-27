/**
 * Preloads cell frame atlases for critical directions (right, left) immediately.
 * Other directions (up, down) are loaded lazily via requestIdleCallback.
 */
import { Direction, loadFrameTextures, hasTextures } from "../components/LibraryScene/cellFrames";

/**
 * Preloads atlases for the specified directions and waits for all to complete.
 * @param dirs Array of directions to preload
 */
export async function preloadAtlases(dirs: Direction[]): Promise<void> {
  await Promise.all(dirs.map((dir) => loadFrameTextures(dir)));
}

/**
 * Preloads critical atlases (right and left) immediately.
 * These are needed for the most common drag interactions.
 */
export async function preloadCriticalCellFrames(): Promise<void> {
  await Promise.all([
    loadFrameTextures(Direction.Right),
    loadFrameTextures(Direction.Left),
  ]);
}

/**
 * Lazy-loads remaining atlases (up and down) in idle time.
 * Should be called after first render via requestIdleCallback.
 */
export function lazyLoadRemainingCellFrames(): void {
  if (typeof window === "undefined") return;

  const loadRemaining = () => {
    if (!hasTextures(Direction.Up)) {
      void loadFrameTextures(Direction.Up);
    }
    if (!hasTextures(Direction.Down)) {
      void loadFrameTextures(Direction.Down);
    }
  };

  // Use requestIdleCallback if available, fallback to setTimeout
  if ("requestIdleCallback" in window) {
    requestIdleCallback(loadRemaining, { timeout: 2000 });
  } else {
    setTimeout(loadRemaining, 0);
  }
}

/**
 * Preloads all cell frame atlases for all directions.
 * @deprecated Use preloadCriticalCellFrames() + lazyLoadRemainingCellFrames() instead.
 */
export async function preloadCellFrames(): Promise<void> {
  await preloadCriticalCellFrames();
  // Don't await lazy load - it happens in background
  lazyLoadRemainingCellFrames();
}

/**
 * Checks if all cell frames are preloaded.
 */
export function isPreloaded(): boolean {
  const directions: Direction[] = [
    Direction.Left,
    Direction.Right,
    Direction.Up,
    Direction.Down,
  ];

  return directions.every((dir) => hasTextures(dir));
}

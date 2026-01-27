/**
 * Atlas loader for cell frame spritesheets.
 * Loads atlas images and JSON metadata, creates textures and slices into individual frame textures.
 */
import { Assets, Texture, Rectangle } from "pixi.js";
import { Direction } from "../components/LibraryScene/cellFrames";

interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasData {
  frames: Record<string, AtlasFrame>;
}

interface AtlasCache {
  baseTexture: Texture; // Keep full texture for reference
  frames: Texture[];
}

const atlasCache = new Map<Direction, AtlasCache>();
const atlasPromises = new Map<Direction, Promise<Texture[]>>();

/**
 * Gets the path to atlas files for a direction.
 */
function getAtlasPaths(dir: Direction): { image: string; json: string } {
  const basePath = `/sprites/cell/${dir}/atlas_512`;
  return {
    image: `${basePath}.webp`,
    json: `${basePath}.json`,
  };
}

/**
 * Loads an atlas for a direction and caches the result.
 * Returns array of 9 textures (indices 0..8 correspond to frame_01..frame_09).
 * Uses promise cache to prevent parallel loads of the same atlas.
 */
export async function loadAtlas(dir: Direction): Promise<Texture[]> {
  // Check cache first - return resolved promise with cached textures
  const cached = atlasCache.get(dir);
  if (cached) {
    return Promise.resolve(cached.frames);
  }

  // Check if there's already a loading promise for this direction
  const existingPromise = atlasPromises.get(dir);
  if (existingPromise) {
    return existingPromise;
  }

  // Create new loading promise
  const loadPromise = (async () => {
    // Load image and JSON in parallel
    const paths = getAtlasPaths(dir);
    const [imageAsset, jsonAsset] = await Promise.all([
      Assets.load(paths.image),
      fetch(paths.json).then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load atlas JSON: ${res.statusText}`);
        }
        return res.json() as Promise<AtlasData>;
      }),
    ]);

    // Assets.load() returns Texture
    if (!(imageAsset instanceof Texture)) {
      throw new Error(`Failed to load atlas image: ${paths.image}`);
    }
    const baseTexture = imageAsset;

    // Create textures for each frame
    const frames: Texture[] = [];
    const frameNames = [
      "frame_01",
      "frame_02",
      "frame_03",
      "frame_04",
      "frame_05",
      "frame_06",
      "frame_07",
      "frame_08",
      "frame_09",
    ];

    for (const frameName of frameNames) {
      const frameData = jsonAsset.frames[frameName];
      if (!frameData) {
        throw new Error(
          `Frame ${frameName} not found in atlas JSON for ${dir}`
        );
      }

      const rect = new Rectangle(
        frameData.x,
        frameData.y,
        frameData.w,
        frameData.h
      );
      // In v8, create a new Texture with the same source but different frame
      const texture = new Texture({
        source: baseTexture.source,
        frame: rect,
      });
      frames.push(texture);
    }

    // Cache the result
    atlasCache.set(dir, { baseTexture, frames });

    // Remove from promises cache
    atlasPromises.delete(dir);

    return frames;
  })();

  // Store promise in cache
  atlasPromises.set(dir, loadPromise);

  return loadPromise;
}

/**
 * Gets cached atlas textures for a direction, or null if not loaded yet.
 */
export function getCachedAtlas(dir: Direction): Texture[] | null {
  const cached = atlasCache.get(dir);
  return cached?.frames ?? null;
}

/**
 * Checks if an atlas for a direction is already loaded.
 */
export function hasAtlas(dir: Direction): boolean {
  return atlasCache.has(dir);
}

/**
 * Unloads all cached atlases. Call on cleanup.
 */
export function unloadAllAtlases(): void {
  const urls: string[] = [];
  for (const cached of atlasCache.values()) {
    // Get URL from base texture if available
    const baseTex = cached.baseTexture;
    // Try to get URL from texture's source
    const source = baseTex.source;
    if (source && 'resource' in source) {
      const resource = (source as any).resource;
      if (resource && resource.url) {
        urls.push(resource.url);
      }
    }
    // Destroy frame textures
    for (const texture of cached.frames) {
      texture.destroy();
    }
    // Base texture will be destroyed when unloaded via Assets
  }
  atlasCache.clear();
  atlasPromises.clear();
  if (urls.length > 0) {
    void Assets.unload(urls);
  }
}

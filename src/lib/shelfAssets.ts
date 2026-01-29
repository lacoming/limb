/**
 * Shelf asset loader. Loads 9 PNGs from /sprites/cell/assets/, caches by promise, reuses textures.
 */
import { Assets, Texture } from "pixi.js";

export type ShelfTextureKey =
  | "backFill"
  | "cornerTL"
  | "cornerTR"
  | "cornerBL"
  | "cornerBR"
  | "edgeTop"
  | "edgeBottom"
  | "edgeLeft"
  | "edgeRight";

const KEYS: ShelfTextureKey[] = [
  "backFill",
  "cornerTL",
  "cornerTR",
  "cornerBL",
  "cornerBR",
  "edgeTop",
  "edgeBottom",
  "edgeLeft",
  "edgeRight",
];

const BASE = "/sprites/cell/assets";

// Маппинг ключей на имена файлов
const KEY_TO_FILE: Record<ShelfTextureKey, string> = {
  backFill: "back_fill",
  cornerTL: "corner_tl",
  cornerTR: "corner_tr",
  cornerBL: "corner_bl",
  cornerBR: "corner_br",
  edgeTop: "horizontal_u",
  edgeBottom: "horizontal_d",
  edgeLeft: "vertical_l",
  edgeRight: "vertical_r",
};

let cached: Record<ShelfTextureKey, Texture> | null = null;
let loadPromise: Promise<Record<ShelfTextureKey, Texture>> | null = null;

export async function preloadShelfAssets(): Promise<
  Record<ShelfTextureKey, Texture>
> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const entries = await Promise.all(
      KEYS.map(async (key) => {
        const fileName = KEY_TO_FILE[key];
        const texture = (await Assets.load(
          `${BASE}/${fileName}.png`
        )) as Texture;
        return [key, texture] as const;
      })
    );
    const record = Object.fromEntries(entries) as Record<
      ShelfTextureKey,
      Texture
    >;
    cached = record;
    loadPromise = null;
    return record;
  })();

  return loadPromise;
}

/**
 * Bakes a shelf Container to a RenderTexture and returns a Sprite + world bounds.
 * Re-bake only when occupiedCells change (add/remove/reset).
 */
import {
  Container,
  Rectangle,
  Sprite,
  type Renderer,
  type Texture,
} from "pixi.js";
import type { ShelfMetrics } from "./shelfMetrics";

export interface BakeResult {
  sprite: Sprite;
  bounds: Rectangle;
}

/**
 * Renders shelfContainer to a RenderTexture and returns a Sprite using it.
 * Container is built with normalized coords (0,0 = top-left of shelf). We use
 * minGX, minGY to compute world-space bounds.
 */
export function bakeShelf(
  renderer: Renderer,
  shelfContainer: Container,
  minGX: number,
  minGY: number,
  metrics: ShelfMetrics
): BakeResult {
  const local = shelfContainer.getBounds();
  const w = Math.max(1, Math.ceil(local.width));
  const h = Math.max(1, Math.ceil(local.height));
  const frame = new Rectangle(0, 0, w, h);

  const texture = renderer.generateTexture({
    target: shelfContainer,
    frame,
  }) as Texture;

  const sprite = new Sprite({ texture });
  sprite.position.set(minGX * metrics.CELL_W, minGY * metrics.CELL_H);

  const bounds = new Rectangle(
    minGX * metrics.CELL_W,
    minGY * metrics.CELL_H,
    frame.width,
    frame.height
  );

  return { sprite, bounds };
}

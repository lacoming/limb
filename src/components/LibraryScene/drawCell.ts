/**
 * Draws one isometric library cell (top + left/right faces + outline).
 * (x, y) = center of the top face in world coordinates.
 * Isometry 2:1: right vector (1, 0.5), depth vector (-1, 0.5).
 */
import { Container, Graphics } from 'pixi.js';

const DEFAULT_W = 80;
const DEFAULT_D = 50;
const DEFAULT_H = 40;

/** Top face fill, left/right face fill, outline */
const TOP_COLOR = 0xe8e4dc;
const LEFT_COLOR = 0xd4cfc4;
const RIGHT_COLOR = 0xddd8cc;
const STROKE_COLOR = 0x6b6560;
const STROKE_WIDTH = 1.5;

/** Project 3D (wx, wy, z) to 2D isometric: x' = wx - wy, y' = (wx + wy) * 0.5 - z */
function iso(wx: number, wy: number, z: number): [number, number] {
  return [wx - wy, (wx + wy) * 0.5 - z];
}

export function drawCell(
  parent: Container,
  x: number,
  y: number,
  w: number = DEFAULT_W,
  d: number = DEFAULT_D,
  h: number = DEFAULT_H
): void {
  const W = w / 2;
  const D = d / 2;

  const [c0x, c0y] = iso(x + W, y + D, h);
  const [c1x, c1y] = iso(x + W, y - D, h);
  const [c2x, c2y] = iso(x - W, y - D, h);
  const [c3x, c3y] = iso(x - W, y + D, h);
  const [b0x, b0y] = iso(x + W, y + D, 0);
  const [b1x, b1y] = iso(x + W, y - D, 0);
  const [b2x, b2y] = iso(x - W, y - D, 0);
  const [b3x, b3y] = iso(x - W, y + D, 0);

  const g = new Graphics();

  // Top face (parallelogram)
  g.poly([c0x, c0y, c1x, c1y, c2x, c2y, c3x, c3y], true)
    .fill({ color: TOP_COLOR });

  // Left face (c2, c3, b3, b2)
  g.poly([c2x, c2y, c3x, c3y, b3x, b3y, b2x, b2y], true)
    .fill({ color: LEFT_COLOR });

  // Right face (c0, c1, b1, b0)
  g.poly([c0x, c0y, c1x, c1y, b1x, b1y, b0x, b0y], true)
    .fill({ color: RIGHT_COLOR });

  // Outline
  g.setStrokeStyle({ width: STROKE_WIDTH, color: STROKE_COLOR });
  g.poly([c0x, c0y, c1x, c1y, c2x, c2y, c3x, c3y], true).stroke();
  g.poly([c2x, c2y, c3x, c3y, b3x, b3y, b2x, b2y], true).stroke();
  g.poly([c0x, c0y, c1x, c1y, b1x, b1y, b0x, b0y], true).stroke();

  parent.addChild(g);
}

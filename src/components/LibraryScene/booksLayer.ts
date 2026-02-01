/**
 * Books layer: renders user books as Graphics in worldContent.
 * Does not trigger shelf rebuild/bake.
 */
import { Container, Graphics } from "pixi.js";
import type { ShelfMetrics } from "../../lib/shelfMetrics";
import type { UserCopyWithEdition } from "../../lib/books/types";

const COMPARTMENT_HEIGHT_MM = 240;
const BOOK_PADDING_PX = 3;

const BOOK_COLORS = [
  0xe74c3c, // red
  0x3498db, // blue
  0x2ecc71, // green
  0xf39c12, // orange
  0x9b59b6, // purple
];

export function renderBooksLayer(
  container: Container,
  metrics: ShelfMetrics,
  books: UserCopyWithEdition[],
  anchorGX: number,
  anchorGY: number
): void {
  container.removeChildren();
  if (books.length === 0) return;

  const { CELL_W, CELL_H, INSET_LEFT, INSET_RIGHT, INSET_TOP, INSET_BOTTOM } =
    metrics;
  const gridOriginX = 0;
  const gridOriginY = 0;

  const cellX = gridOriginX + anchorGX * CELL_W;
  const cellY = gridOriginY + anchorGY * CELL_H;
  const innerLeft = cellX + INSET_LEFT;
  const innerRight = cellX + CELL_W - INSET_RIGHT;
  const innerTop = cellY + INSET_TOP;
  const innerBottom = cellY + CELL_H - INSET_BOTTOM;
  const innerHeight = innerBottom - innerTop;

  const PX_PER_MM = innerHeight / COMPARTMENT_HEIGHT_MM;

  let bookX = innerLeft + BOOK_PADDING_PX;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const { dimensionsMm } = book.edition;
    const thicknessPx = dimensionsMm.thickness * PX_PER_MM;
    const bookHeightPx = dimensionsMm.height * PX_PER_MM;
    const scaleUniform = Math.min(1, innerHeight / bookHeightPx);
    const w = thicknessPx * scaleUniform;
    const h = bookHeightPx * scaleUniform;

    if (bookX + w > innerRight) break;

    const g = new Graphics();
    const color = BOOK_COLORS[i % BOOK_COLORS.length];
    g.roundRect(0, 0, w, h, 4).fill({ color });
    g.position.set(bookX, innerBottom - h);
    container.addChild(g);

    bookX += w;
  }
}

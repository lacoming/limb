/**
 * Books layer: renders user books as Graphics in worldContent.
 * Does not trigger shelf rebuild/bake.
 */
import { Container, Graphics, Text, TextStyle } from "pixi.js";
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

const TITLE_PADDING = 4;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 64;
const LINE_HEIGHT = 1.1;
const MAX_LINES = 4;

const TITLE_STYLE_BASE = {
  fontFamily: "ui-serif, Georgia, 'Times New Roman', serif",
  fontWeight: "600" as const,
  fill: 0x111111,
};

function splitIntoLines(title: string, lineCount: number): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [title];
  if (lineCount === 1 || words.length === 1) return [words.join(" ")];

  const lines: string[] = [];
  const wordsPerLine = Math.ceil(words.length / lineCount);
  for (let i = 0; i < lineCount; i++) {
    const start = i * wordsPerLine;
    const end = Math.min(start + wordsPerLine, words.length);
    if (start < words.length) {
      lines.push(words.slice(start, end).join(" "));
    }
  }
  return lines;
}

function fitTitle(
  title: string,
  availH: number,
  availW: number,
  measureText: (text: string, fontSize: number) => { width: number; height: number }
): { text: string; fontSize: number } | null {
  const normalized = title.trim();
  if (!normalized || availH < MIN_FONT_SIZE || availW < MIN_FONT_SIZE) return null;

  for (let lineCount = 1; lineCount <= MAX_LINES; lineCount++) {
    const lines = splitIntoLines(normalized, lineCount);
    const maxFontForWidth = Math.floor(availW / (lineCount * LINE_HEIGHT));
    const startFont = Math.min(MAX_FONT_SIZE, maxFontForWidth);

    for (let fontSize = startFont; fontSize >= MIN_FONT_SIZE; fontSize--) {
      const measured = measureText(lines.join("\n"), fontSize);
      if (measured.width <= availH && measured.height <= availW) {
        return { text: lines.join("\n"), fontSize };
      }
    }
  }

  // Fallback: 2 lines with ellipsis
  const lines = splitIntoLines(normalized, 2);
  for (let fontSize = Math.min(MAX_FONT_SIZE, Math.floor(availW / (2 * LINE_HEIGHT))); fontSize >= MIN_FONT_SIZE; fontSize--) {
    let lastLine = lines[lines.length - 1];
    while (lastLine.length > 1) {
      const tryText = lines.length > 1 ? lines[0] + "\n" + lastLine + "…" : lastLine + "…";
      const measured = measureText(tryText, fontSize);
      if (measured.width <= availH && measured.height <= availW) {
        return { text: tryText, fontSize };
      }
      lastLine = lastLine.slice(0, -1);
    }
  }

  return null;
}

export function renderBooksLayer(
  container: Container,
  metrics: ShelfMetrics,
  books: UserCopyWithEdition[],
  _anchorGX: number,
  _anchorGY: number
): void {
  container.removeChildren();
  if (books.length === 0) return;

  const { CELL_W, CELL_H, INSET_LEFT, INSET_RIGHT, INSET_TOP, INSET_BOTTOM } =
    metrics;

  // Group books by placement cell
  const booksByCell = new Map<string, UserCopyWithEdition[]>();
  for (const book of books) {
    const { gx, gy } = book.placement ?? { gx: 0, gy: 0 };
    const key = `${gx},${gy}`;
    if (!booksByCell.has(key)) booksByCell.set(key, []);
    booksByCell.get(key)!.push(book);
  }

  // Render books for each cell
  for (const [key, cellBooks] of booksByCell) {
    const [gxStr, gyStr] = key.split(",");
    const gx = parseInt(gxStr, 10);
    const gy = parseInt(gyStr, 10);

    const cellX = gx * CELL_W;
    const cellY = gy * CELL_H;
    const innerLeft = cellX + INSET_LEFT;
    const innerRight = cellX + CELL_W - INSET_RIGHT;
    const innerTop = cellY + INSET_TOP;
    const innerBottom = cellY + CELL_H - INSET_BOTTOM;
    const innerHeight = innerBottom - innerTop;
    const innerWidth = innerRight - innerLeft;

    const PX_PER_MM = innerHeight / COMPARTMENT_HEIGHT_MM;

    let bookX = innerLeft + BOOK_PADDING_PX;

    for (let i = 0; i < cellBooks.length; i++) {
      const book = cellBooks[i];
      const { dimensionsMm, pageCount } = book.edition;
      const thicknessMm = dimensionsMm.thickness ?? (pageCount ? pageCount * 0.05 : 25);
      const heightMm = dimensionsMm.height ?? 210;
      const thicknessPx = thicknessMm * PX_PER_MM;
      const bookHeightPx = heightMm * PX_PER_MM;
      const scaleH = Math.min(1, innerHeight / bookHeightPx);
      const w = Math.max(2, Math.min(thicknessPx, innerWidth));
      const h = bookHeightPx * scaleH;

      if (bookX + w > innerRight) break;

      const bookContainer = new Container();
      bookContainer.position.set(bookX, innerBottom - h);

      const g = new Graphics();
      const color = BOOK_COLORS[i % BOOK_COLORS.length];
      g.roundRect(0, 0, w, h, 4).fill({ color });
      bookContainer.addChild(g);

      const title = book.work?.title ?? "";
      const availH = h - TITLE_PADDING * 2;
      const availW = w - TITLE_PADDING * 2;

      const measureText = (txt: string, fontSize: number) => {
        const style = new TextStyle({
          ...TITLE_STYLE_BASE,
          fontSize,
          lineHeight: fontSize * LINE_HEIGHT,
          align: "center",
        });
        const t = new Text({ text: txt, style });
        const result = { width: t.width, height: t.height };
        t.destroy();
        return result;
      };

      const fit = fitTitle(title, availH, availW, measureText);

      if (fit) {
        const style = new TextStyle({
          ...TITLE_STYLE_BASE,
          fontSize: fit.fontSize,
          lineHeight: fit.fontSize * LINE_HEIGHT,
          align: "center",
        });
        const text = new Text({ text: fit.text, style });
        text.anchor.set(0.5, 0.5);
        text.rotation = -Math.PI / 2;
        text.position.set(w / 2, h / 2);

        const mask = new Graphics();
        mask.rect(TITLE_PADDING, TITLE_PADDING, availW, availH).fill({ color: 0xffffff });
        bookContainer.addChild(mask);
        text.mask = mask;

        bookContainer.addChild(text);
      }

      container.addChild(bookContainer);

      bookX += w;
    }
  }
}

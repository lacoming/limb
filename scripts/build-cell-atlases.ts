/**
 * Builds cell frame atlases (spritesheets) from individual frame files.
 * Combines 9 frames (frame_01..frame_09) into a 3x3 grid atlas per direction.
 * Run: pnpm frames:atlas
 */
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CELL_SPRITES_DIR = path.join(ROOT, "public", "sprites", "cell");
const DIRECTIONS = ["left", "right", "up", "down"] as const;
const FRAME_COUNT = 9;
const GRID_COLS = 3;
const GRID_ROWS = 3;
const FRAME_SIZE = 512;
const ATLAS_WIDTH = FRAME_SIZE * GRID_COLS; // 1536
const ATLAS_HEIGHT = FRAME_SIZE * GRID_ROWS; // 1536
const QUALITY = 82; // 80-85 range, using 82

interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasData {
  frames: Record<string, AtlasFrame>;
}

/**
 * Finds frame file (prefers webp, falls back to png).
 */
async function findFrameFile(
  dirPath: string,
  frameName: string
): Promise<string | null> {
  const webpPath = path.join(dirPath, `${frameName}.webp`);
  const pngPath = path.join(dirPath, `${frameName}.png`);

  try {
    await fs.access(webpPath);
    return webpPath;
  } catch {
    try {
      await fs.access(pngPath);
      return pngPath;
    } catch {
      return null;
    }
  }
}

/**
 * Builds an atlas for a single direction.
 */
async function buildAtlasForDirection(dir: string): Promise<void> {
  const dirPath = path.join(CELL_SPRITES_DIR, dir);
  
  try {
    await fs.access(dirPath);
  } catch {
    console.error(`  ✗ Directory ${dirPath} not found`);
    return;
  }

  console.log(`Processing ${dir}/:`);

  // Load all 9 frames
  const frameImages: sharp.Sharp[] = [];
  const frameNames: string[] = [];

  for (let i = 1; i <= FRAME_COUNT; i++) {
    const frameName = `frame_${String(i).padStart(2, "0")}`;
    const framePath = await findFrameFile(dirPath, frameName);

    if (!framePath) {
      console.error(`  ✗ ${frameName} not found (neither .webp nor .png)`);
      return;
    }

    // Resize to 512x512 with contain (transparent background)
    const resized = sharp(framePath)
      .resize(FRAME_SIZE, FRAME_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });

    frameImages.push(resized);
    frameNames.push(frameName);
  }

  // Create composite operations for 3x3 grid
  const composites: sharp.OverlayOptions[] = [];
  const atlasData: AtlasData = { frames: {} };

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const frameIndex = row * GRID_COLS + col;
      const frameName = frameNames[frameIndex];
      const x = col * FRAME_SIZE;
      const y = row * FRAME_SIZE;

      composites.push({
        input: await frameImages[frameIndex].toBuffer(),
        left: x,
        top: y,
      });

      atlasData.frames[frameName] = {
        x,
        y,
        w: FRAME_SIZE,
        h: FRAME_SIZE,
      };
    }
  }

  // Create base canvas (transparent)
  const atlasBuffer = await sharp({
    create: {
      width: ATLAS_WIDTH,
      height: ATLAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality: QUALITY })
    .toBuffer();

  // Save atlas image
  const atlasImagePath = path.join(dirPath, "atlas_512.webp");
  await fs.writeFile(atlasImagePath, atlasBuffer);
  console.log(`  ✓ atlas_512.webp (${ATLAS_WIDTH}x${ATLAS_HEIGHT})`);

  // Save JSON metadata
  const atlasJsonPath = path.join(dirPath, "atlas_512.json");
  await fs.writeFile(
    atlasJsonPath,
    JSON.stringify(atlasData, null, 2),
    "utf-8"
  );
  console.log(`  ✓ atlas_512.json`);
}

async function main(): Promise<void> {
  console.log(`Building cell frame atlases in ${CELL_SPRITES_DIR}`);
  console.log(
    `Target: ${GRID_COLS}x${GRID_ROWS} grid, ${FRAME_SIZE}x${FRAME_SIZE} per frame, WebP quality ${QUALITY}\n`
  );

  for (const dir of DIRECTIONS) {
    try {
      await buildAtlasForDirection(dir);
      console.log("");
    } catch (err) {
      console.error(`  Error processing ${dir}:`, err);
    }
  }

  console.log(`Done. ${DIRECTIONS.length} atlases built.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

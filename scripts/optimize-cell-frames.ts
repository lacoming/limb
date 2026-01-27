/**
 * Optimizes cell frame PNGs to WebP format.
 * Converts all PNG files in public/sprites/cell/{left,right,up,down}/ to WebP 512x512.
 * Run: pnpm frames:optimize
 */
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CELL_SPRITES_DIR = path.join(ROOT, "public", "sprites", "cell");
const DIRECTIONS = ["left", "right", "up", "down"] as const;
const CONCURRENT_CONVERSIONS = 4;
const TARGET_SIZE = 512;
const QUALITY = 82; // 80-85 range, using 82

interface ConversionTask {
  inputPath: string;
  outputPath: string;
  dir: string;
  filename: string;
}

async function convertToWebP(
  inputPath: string,
  outputPath: string
): Promise<void> {
  await sharp(inputPath)
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent background
    })
    .webp({ quality: QUALITY })
    .toFile(outputPath);
}

async function processBatch(tasks: ConversionTask[]): Promise<void> {
  await Promise.all(
    tasks.map(async ({ inputPath, outputPath, filename }) => {
      try {
        await convertToWebP(inputPath, outputPath);
        console.log(`  ✓ ${filename}`);
      } catch (error) {
        console.error(`  ✗ ${filename}:`, error);
        throw error;
      }
    })
  );
}

async function optimizeFramesInDir(dirPath: string, dir: string): Promise<void> {
  const files = await fs.readdir(dirPath);
  const pngFiles = files.filter((f) => f.endsWith(".png") && f.startsWith("frame_"));

  if (pngFiles.length === 0) {
    console.log(`  No PNG files found`);
    return;
  }

  const tasks: ConversionTask[] = [];
  for (const file of pngFiles) {
    const inputPath = path.join(dirPath, file);
    const outputPath = path.join(dirPath, file.replace(/\.png$/, ".webp"));

    // Skip if webp already exists and is newer than png
    try {
      const inputStat = await fs.stat(inputPath);
      const outputStat = await fs.stat(outputPath);
      if (outputStat.mtime >= inputStat.mtime) {
        console.log(`  ⊘ ${file.replace(/\.png$/, ".webp")} (already optimized)`);
        continue;
      }
    } catch {
      // Output doesn't exist, need to create it
    }

    tasks.push({
      inputPath,
      outputPath,
      dir,
      filename: file.replace(/\.png$/, ".webp"),
    });
  }

  if (tasks.length === 0) {
    console.log(`  All files already optimized`);
    return;
  }

  // Process in batches
  for (let i = 0; i < tasks.length; i += CONCURRENT_CONVERSIONS) {
    const batch = tasks.slice(i, i + CONCURRENT_CONVERSIONS);
    await processBatch(batch);
  }
}

async function main(): Promise<void> {
  console.log(`Optimizing cell frames in ${CELL_SPRITES_DIR}`);
  console.log(`Target: ${TARGET_SIZE}x${TARGET_SIZE} WebP, quality ${QUALITY}\n`);

  let totalProcessed = 0;
  let totalSkipped = 0;

  for (const dir of DIRECTIONS) {
    const dirPath = path.join(CELL_SPRITES_DIR, dir);
    try {
      await fs.access(dirPath);
      console.log(`Processing ${dir}/:`);
      const beforeCount = (await fs.readdir(dirPath)).filter((f) =>
        f.endsWith(".webp")
      ).length;
      await optimizeFramesInDir(dirPath, dir);
      const afterCount = (await fs.readdir(dirPath)).filter((f) =>
        f.endsWith(".webp")
      ).length;
      const processed = afterCount - beforeCount;
      totalProcessed += processed;
      console.log(`  → ${processed} files converted\n`);
    } catch (err) {
      console.error(`  Error accessing ${dirPath}:`, err);
    }
  }

  console.log(`Done. ${totalProcessed} files converted.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

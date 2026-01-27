/**
 * Renames cell frame files from cell_195.png0001.png format to frame_01.png format.
 * Safe: skips files that are already renamed.
 * Run: pnpm frames:rename
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CELL_SPRITES_DIR = path.join(ROOT, "public", "sprites", "cell");
const DIRECTIONS = ["left", "right", "up", "down"] as const;

async function renameFramesInDir(dirPath: string, dirName: string): Promise<void> {
  const files = await fs.readdir(dirPath);
  
  for (const file of files) {
    // Skip if already renamed
    if (file.startsWith("frame_") && file.endsWith(".png")) {
      console.log(`  Skipping ${file} (already renamed)`);
      continue;
    }
    
    // Match pattern: cell_195.png0001.png ... cell_195.png0009.png
    const match = file.match(/^cell_195\.png(\d{4})\.png$/);
    if (!match) {
      console.log(`  Skipping ${file} (doesn't match pattern)`);
      continue;
    }
    
    const frameNum = parseInt(match[1], 10);
    if (frameNum < 1 || frameNum > 9) {
      console.log(`  Skipping ${file} (frame number out of range)`);
      continue;
    }
    
    const oldPath = path.join(dirPath, file);
    const newName = `frame_${String(frameNum).padStart(2, "0")}.png`;
    const newPath = path.join(dirPath, newName);
    
    // Check if target already exists
    try {
      await fs.access(newPath);
      console.log(`  Skipping ${file} -> ${newName} (target exists)`);
      continue;
    } catch {
      // Target doesn't exist, safe to rename
    }
    
    await fs.rename(oldPath, newPath);
    console.log(`  Renamed ${file} -> ${newName}`);
  }
}

async function main(): Promise<void> {
  console.log(`Renaming cell frames in ${CELL_SPRITES_DIR}`);
  
  for (const dir of DIRECTIONS) {
    const dirPath = path.join(CELL_SPRITES_DIR, dir);
    try {
      await fs.access(dirPath);
      console.log(`\nProcessing ${dir}/:`);
      await renameFramesInDir(dirPath, dir);
    } catch (err) {
      console.error(`  Error accessing ${dirPath}:`, err);
    }
  }
  
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

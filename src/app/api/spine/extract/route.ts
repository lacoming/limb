import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "public/uploads/spines");
const MIN_ASPECT_RATIO = 1.2;
const ANALYSIS_HEIGHT = 600;
const MIN_WIDTH_RATIO = 0.06;
const MAX_WIDTH_RATIO = 0.25;
const SCORE_THRESHOLD = 1.5;
const SMOOTH_WINDOW = 15;

type SharpModule = typeof import("sharp");

async function tryLoadSharp(): Promise<SharpModule | null> {
  try {
    const sharp = await import("sharp");
    return sharp.default as unknown as SharpModule;
  } catch {
    return null;
  }
}

function computeColumnBrightness(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number
): number[] {
  const brightness: number[] = new Array(width).fill(0);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * channels;
      // Grayscale approximation: 0.299R + 0.587G + 0.114B
      const r = pixels[idx] ?? 0;
      const g = pixels[idx + 1] ?? r;
      const b = pixels[idx + 2] ?? r;
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
    }
    brightness[x] = sum / height;
  }
  return brightness;
}

function computeGradient(brightness: number[]): number[] {
  const gradient: number[] = [0];
  for (let i = 1; i < brightness.length; i++) {
    gradient.push(Math.abs(brightness[i] - brightness[i - 1]));
  }
  return gradient;
}

function smoothArray(arr: number[], window: number): number[] {
  const result: number[] = [];
  const half = Math.floor(window / 2);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < arr.length) {
        sum += arr[j];
        count++;
      }
    }
    result.push(sum / count);
  }
  return result;
}

function findBestSpineRange(
  gradient: number[],
  width: number
): { x1: number; x2: number; score: number } | null {
  const minW = Math.floor(width * MIN_WIDTH_RATIO);
  const maxW = Math.floor(width * MAX_WIDTH_RATIO);

  let best: { x1: number; x2: number; score: number } | null = null;

  for (let w = minW; w <= maxW; w++) {
    for (let x1 = 0; x1 <= width - w; x1++) {
      const x2 = x1 + w;
      // Score = edge strength at boundaries
      const leftEdge = gradient[x1] ?? 0;
      const rightEdge = gradient[x2] ?? 0;
      const score = leftEdge + rightEdge;

      if (!best || score > best.score) {
        best = { x1, x2, score };
      }
    }
  }

  return best;
}

function validateSpineRange(
  gradient: number[],
  range: { x1: number; x2: number; score: number },
  height: number
): boolean {
  const avgGradient =
    gradient.reduce((a, b) => a + b, 0) / gradient.length;

  if (range.score < avgGradient * SCORE_THRESHOLD) {
    return false;
  }

  const cropWidth = range.x2 - range.x1;
  const aspectRatio = height / cropWidth;
  if (aspectRatio < MIN_ASPECT_RATIO) {
    return false;
  }

  return true;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "No file provided" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sharp = await tryLoadSharp();

    let width: number;
    let height: number;
    let outputBuffer: Buffer;
    let ext: string;

    if (sharp) {
      // Auto-orient first
      const oriented = await sharp(buffer).rotate().toBuffer();
      const meta = await sharp(oriented).metadata();
      const origWidth = meta.width ?? 0;
      const origHeight = meta.height ?? 0;

      if (!origWidth || !origHeight) {
        return NextResponse.json(
          { ok: false, error: "К сожалению корешка не обнаружено" },
          { status: 200 }
        );
      }

      // Resize for analysis (smaller for faster processing)
      const scale = Math.min(1, ANALYSIS_HEIGHT / origHeight);
      const analysisWidth = Math.round(origWidth * scale);
      const analysisHeight = Math.round(origHeight * scale);

      const analysisBuffer = await sharp(oriented)
        .resize({ width: analysisWidth, height: analysisHeight })
        .raw()
        .toBuffer();

      const channels = 3;
      const brightness = computeColumnBrightness(
        analysisBuffer,
        analysisWidth,
        analysisHeight,
        channels
      );
      const gradient = computeGradient(brightness);
      const smoothedGradient = smoothArray(gradient, SMOOTH_WINDOW);

      const range = findBestSpineRange(smoothedGradient, analysisWidth);

      if (!range || !validateSpineRange(smoothedGradient, range, analysisHeight)) {
        return NextResponse.json(
          { ok: false, error: "К сожалению корешка не обнаружено" },
          { status: 200 }
        );
      }

      // Scale back to original dimensions
      const cropX1 = Math.round(range.x1 / scale);
      const cropX2 = Math.round(range.x2 / scale);
      const cropWidth = cropX2 - cropX1;

      // Crop the spine region from original
      let pipeline = sharp(oriented).extract({
        left: cropX1,
        top: 0,
        width: cropWidth,
        height: origHeight,
      });

      // Resize height to max 1200, don't upscale
      if (origHeight > 1200) {
        pipeline = pipeline.resize({ height: 1200, withoutEnlargement: true });
      }

      // Slightly enhance contrast/brightness
      pipeline = pipeline.modulate({ brightness: 1.02 }).sharpen({ sigma: 0.5 });

      outputBuffer = await pipeline.webp({ quality: 80 }).toBuffer();
      const outputMeta = await sharp(outputBuffer).metadata();
      width = outputMeta.width ?? cropWidth;
      height = outputMeta.height ?? origHeight;
      ext = "webp";
    } else {
      // No sharp: save as-is, cannot validate aspect ratio reliably
      // Just save the file
      outputBuffer = buffer;
      const fileName = file.name.toLowerCase();
      if (fileName.endsWith(".png")) ext = "png";
      else if (fileName.endsWith(".webp")) ext = "webp";
      else ext = "jpg";
      // Can't determine dimensions without sharp, use placeholder
      width = 0;
      height = 0;
    }

    // Ensure uploads directory exists
    if (!existsSync(UPLOADS_DIR)) {
      await mkdir(UPLOADS_DIR, { recursive: true });
    }

    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);
    await writeFile(filepath, outputBuffer);

    const url = `/uploads/spines/${filename}`;

    return NextResponse.json({
      ok: true,
      url,
      w: width,
      h: height,
    });
  } catch (err) {
    console.error("Spine extract error:", err);
    return NextResponse.json(
      { ok: false, error: "К сожалению корешка не обнаружено" },
      { status: 200 }
    );
  }
}

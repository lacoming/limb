import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "public/uploads/spines");
const MIN_ASPECT_RATIO = 1.2;
const ANALYSIS_HEIGHT = 700;
const MIN_WIDTH_RATIO = 0.04;
const MAX_WIDTH_RATIO = 0.30;
const SCORE_THRESHOLD = 1.3;
const SMOOTH_WINDOW = 15;
const STDDEV_PENALTY_WEIGHT = 0.3;

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const AI_MIN_WIDTH_RATIO = 0.04;
const AI_MAX_WIDTH_RATIO = 0.35;
const AI_MIN_CONFIDENCE = 0.5;

interface AIBbox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AIResponse {
  ok: boolean;
  bbox?: AIBbox;
  confidence?: number;
  reason?: string;
}

async function tryAICrop(
  base64Image: string,
  mimeType: string,
  imgWidth: number,
  imgHeight: number
): Promise<AIBbox | null> {
  if (!OPENROUTER_API_KEY) return null;

  try {
    const dataUrl = `data:${mimeType};base64,${base64Image}`;
    const prompt = `You are a spine detector. The image shows a book (photo of cover or full book). Find the SPINE region (the narrow vertical strip where pages are bound).

Return ONLY valid JSON, no other text:
If spine found: {"ok":true,"bbox":{"left":N,"top":N,"width":N,"height":N},"confidence":0.0-1.0}
If not found: {"ok":false,"reason":"..."}

bbox values must be in PIXELS for this image (${imgWidth}x${imgHeight}). The spine is typically a narrow vertical rectangle.`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 200,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "";

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed: AIResponse = JSON.parse(jsonMatch[0]);
    if (!parsed.ok || !parsed.bbox) return null;

    const { bbox, confidence = 0 } = parsed;

    // Validate confidence
    if (confidence < AI_MIN_CONFIDENCE) return null;

    // Validate bbox values
    if (
      typeof bbox.left !== "number" ||
      typeof bbox.top !== "number" ||
      typeof bbox.width !== "number" ||
      typeof bbox.height !== "number"
    )
      return null;

    if (bbox.width <= 0 || bbox.height <= 0) return null;

    // Validate bbox within image bounds
    if (
      bbox.left < 0 ||
      bbox.top < 0 ||
      bbox.left + bbox.width > imgWidth ||
      bbox.top + bbox.height > imgHeight
    )
      return null;

    // Validate aspect ratio (height/width >= 1.2)
    if (bbox.height / bbox.width < MIN_ASPECT_RATIO) return null;

    // Validate width ratio (4%-35% of image width)
    const widthRatio = bbox.width / imgWidth;
    if (widthRatio < AI_MIN_WIDTH_RATIO || widthRatio > AI_MAX_WIDTH_RATIO) return null;

    return bbox;
  } catch {
    return null;
  }
}

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

function computeStdDev(arr: number[], start: number, end: number): number {
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += arr[i];
  }
  const mean = sum / (end - start);
  let variance = 0;
  for (let i = start; i < end; i++) {
    variance += (arr[i] - mean) ** 2;
  }
  return Math.sqrt(variance / (end - start));
}

function findBestSpineRange(
  gradient: number[],
  brightness: number[],
  width: number
): { x1: number; x2: number; score: number } | null {
  const minW = Math.floor(width * MIN_WIDTH_RATIO);
  const maxW = Math.floor(width * MAX_WIDTH_RATIO);

  // Compute global stddev for normalization
  const globalStdDev = computeStdDev(brightness, 0, brightness.length) || 1;

  let best: { x1: number; x2: number; score: number } | null = null;

  for (let w = minW; w <= maxW; w++) {
    for (let x1 = 0; x1 <= width - w; x1++) {
      const x2 = x1 + w;
      // Score = edge strength at boundaries
      const leftEdge = gradient[x1] ?? 0;
      const rightEdge = gradient[x2] ?? 0;
      const edgeScore = leftEdge + rightEdge;

      // Penalty for high variance inside the range (spines are usually uniform)
      const innerStdDev = computeStdDev(brightness, x1, x2);
      const normalizedStdDev = innerStdDev / globalStdDev;
      const penalty = normalizedStdDev * STDDEV_PENALTY_WEIGHT * edgeScore;

      const score = edgeScore - penalty;

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

// Second pass: refine edges by finding gradient peaks near boundaries
function refineSpineEdges(
  gradient: number[],
  x1: number,
  x2: number,
  padding: number = 4
): { x1: number; x2: number } {
  const width = x2 - x1;
  const searchZone = Math.max(3, Math.floor(width * 0.25));

  // Find peak in left zone (first 25% of crop)
  let leftPeak = x1;
  let leftMax = 0;
  for (let i = x1; i < x1 + searchZone && i < gradient.length; i++) {
    if (gradient[i] > leftMax) {
      leftMax = gradient[i];
      leftPeak = i;
    }
  }

  // Find peak in right zone (last 25% of crop)
  let rightPeak = x2;
  let rightMax = 0;
  for (let i = x2 - searchZone; i <= x2 && i < gradient.length; i++) {
    if (i >= 0 && gradient[i] > rightMax) {
      rightMax = gradient[i];
      rightPeak = i;
    }
  }

  // Only adjust if peaks are meaningful (above average of the zone)
  const leftZoneAvg = gradient.slice(x1, x1 + searchZone).reduce((a, b) => a + b, 0) / searchZone || 1;
  const rightZoneAvg = gradient.slice(Math.max(0, x2 - searchZone), x2 + 1).reduce((a, b) => a + b, 0) / (searchZone + 1) || 1;

  const newX1 = leftMax > leftZoneAvg * 1.5 ? Math.max(0, leftPeak - padding) : x1;
  const newX2 = rightMax > rightZoneAvg * 1.5 ? Math.min(gradient.length - 1, rightPeak + padding) : x2;

  // Ensure we don't make the crop smaller than reasonable
  if (newX2 - newX1 < (x2 - x1) * 0.7) {
    return { x1, x2 };
  }

  return { x1: newX1, x2: newX2 };
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
      const mimeType = meta.format === "png" ? "image/png" : "image/jpeg";

      if (!origWidth || !origHeight) {
        return NextResponse.json(
          { ok: false, error: "К сожалению корешка не обнаружено" },
          { status: 200 }
        );
      }

      let cropLeft = 0;
      let cropTop = 0;
      let cropWidth = 0;
      let cropHeight = origHeight;
      let found = false;

      // Try AI crop first
      if (OPENROUTER_API_KEY) {
        const base64 = oriented.toString("base64");
        const aiBbox = await tryAICrop(base64, mimeType, origWidth, origHeight);
        if (aiBbox) {
          cropLeft = Math.round(aiBbox.left);
          cropTop = Math.round(aiBbox.top);
          cropWidth = Math.round(aiBbox.width);
          cropHeight = Math.round(aiBbox.height);
          found = true;
        }
      }

      // Fallback to heuristic
      if (!found) {
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
        const smoothedBrightness = smoothArray(brightness, SMOOTH_WINDOW);

        const range = findBestSpineRange(smoothedGradient, smoothedBrightness, analysisWidth);

        if (range && validateSpineRange(smoothedGradient, range, analysisHeight)) {
          // Second pass: refine edges
          const refined = refineSpineEdges(smoothedGradient, range.x1, range.x2, 4);

          cropLeft = Math.round(refined.x1 / scale);
          cropTop = 0;
          cropWidth = Math.round((refined.x2 - refined.x1) / scale);
          cropHeight = origHeight;
          found = true;
        }
      }

      if (!found) {
        return NextResponse.json(
          { ok: false, error: "К сожалению корешка не обнаружено" },
          { status: 200 }
        );
      }

      // Crop the spine region from original
      let pipeline = sharp(oriented).extract({
        left: cropLeft,
        top: cropTop,
        width: cropWidth,
        height: cropHeight,
      });

      // Add 2px padding with neutral color
      pipeline = pipeline.extend({
        top: 2,
        bottom: 2,
        left: 2,
        right: 2,
        background: { r: 17, g: 17, b: 17, alpha: 1 },
      });

      // Resize height to max 1200, don't upscale
      const targetHeight = cropHeight + 4; // account for padding
      if (targetHeight > 1200) {
        pipeline = pipeline.resize({ height: 1200, withoutEnlargement: true });
      }

      // Slightly enhance contrast/brightness (mild normalization)
      pipeline = pipeline.modulate({ brightness: 1.03, saturation: 1.02 }).linear(1.05, -5);

      outputBuffer = await pipeline.webp({ quality: 82 }).toBuffer();
      const outputMeta = await sharp(outputBuffer).metadata();
      width = outputMeta.width ?? cropWidth + 4;
      height = outputMeta.height ?? cropHeight + 4;
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

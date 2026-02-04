import { NextRequest, NextResponse } from "next/server";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = process.env.OPENROUTER_VISION_MODEL ?? "google/gemini-2.0-flash-001";
const TIMEOUT_MS = 30000;

interface PhotoCandidate {
  title: string;
  authors: string[];
  isbn?: string;
  year?: number;
  confidence: number;
  notes?: string;
}

interface IdentifyResponse {
  ok: boolean;
  extractedText?: string;
  candidates?: PhotoCandidate[];
  error?: string;
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

async function preprocessImage(buffer: Buffer, sharp: SharpModule): Promise<string> {
  // Auto-orient, resize max height 1200, normalize, convert to webp
  const processed = await sharp(buffer)
    .rotate() // auto-orient
    .resize({ height: 1200, withoutEnlargement: true })
    .normalize()
    .webp({ quality: 85 })
    .toBuffer();

  return `data:image/webp;base64,${processed.toString("base64")}`;
}

async function identifyWithAI(images: string[]): Promise<IdentifyResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const imageContent = images.map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));

  const prompt = `You are a book identification expert. Analyze the provided photo(s) of a book (cover and/or spine) and extract book information.

Return ONLY valid JSON with this exact structure, no other text:
{
  "extractedText": "raw text you can see on the book",
  "candidates": [
    {
      "title": "Book Title",
      "authors": ["Author Name"],
      "isbn": "1234567890123 or null if not visible",
      "year": 2020 or null if unknown,
      "confidence": 0.0-1.0,
      "notes": "optional notes about uncertainty"
    }
  ]
}

Rules:
- Return 1-5 candidates, sorted by confidence (highest first)
- If ISBN barcode is visible, prioritize extracting it (10 or 13 digits)
- If text is partially obscured (fingers, glare, shadows), make best-effort guesses and lower confidence
- If you're unsure about title/author spelling, provide multiple variations as separate candidates
- confidence: 0.9+ = very clear, 0.7-0.9 = mostly clear, 0.5-0.7 = partially visible, <0.5 = guessing
- Include extractedText with ALL visible text from the book
- For non-Latin scripts (Cyrillic, CJK, etc.), include original text in extractedText`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...imageContent],
          },
        ],
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenRouter error:", response.status, errorText);
      return { ok: false, error: "Ошибка при обращении к AI сервису" };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "";

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, error: "Не удалось распознать книгу. Попробуйте другое фото." };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.candidates || !Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
      return { ok: false, error: "Не удалось распознать книгу. Попробуйте другое фото." };
    }

    // Validate and clean candidates
    const candidates: PhotoCandidate[] = parsed.candidates
      .slice(0, 5)
      .map((c: Record<string, unknown>) => ({
        title: String(c.title || "").trim(),
        authors: Array.isArray(c.authors)
          ? c.authors.map((a: unknown) => String(a).trim()).filter(Boolean)
          : [],
        isbn: c.isbn && typeof c.isbn === "string" && /^\d{10,13}$/.test(c.isbn) ? c.isbn : undefined,
        year: typeof c.year === "number" && c.year > 1000 && c.year < 2100 ? c.year : undefined,
        confidence: typeof c.confidence === "number" ? Math.min(1, Math.max(0, c.confidence)) : 0.5,
        notes: c.notes ? String(c.notes) : undefined,
      }))
      .filter((c: PhotoCandidate) => c.title.length > 0);

    if (candidates.length === 0) {
      return { ok: false, error: "Не удалось распознать книгу. Попробуйте другое фото." };
    }

    return {
      ok: true,
      extractedText: parsed.extractedText ? String(parsed.extractedText) : undefined,
      candidates,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Превышено время ожидания. Попробуйте ещё раз." };
    }
    console.error("Identify error:", err);
    return { ok: false, error: "Не удалось распознать книгу. Попробуйте другое фото." };
  }
}

export async function POST(req: NextRequest) {
  // Check API key
  if (!OPENROUTER_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "OpenRouter API key not set. Добавьте OPENROUTER_API_KEY в .env" },
      { status: 500 }
    );
  }

  try {
    const formData = await req.formData();
    const cover = formData.get("cover") as File | null;
    const spine = formData.get("spine") as File | null;

    if (!cover) {
      return NextResponse.json(
        { ok: false, error: "Требуется фото обложки" },
        { status: 400 }
      );
    }

    // Check file sizes
    if (cover.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: "Фото обложки слишком большое (макс. 10MB)" },
        { status: 400 }
      );
    }
    if (spine && spine.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: "Фото корешка слишком большое (макс. 10MB)" },
        { status: 400 }
      );
    }

    const sharp = await tryLoadSharp();
    const images: string[] = [];

    // Process cover
    const coverBuffer = Buffer.from(await cover.arrayBuffer());
    if (sharp) {
      images.push(await preprocessImage(coverBuffer, sharp));
    } else {
      // Fallback: send as-is
      const coverBase64 = coverBuffer.toString("base64");
      const mimeType = cover.type || "image/jpeg";
      images.push(`data:${mimeType};base64,${coverBase64}`);
    }

    // Process spine if provided
    if (spine) {
      const spineBuffer = Buffer.from(await spine.arrayBuffer());
      if (sharp) {
        images.push(await preprocessImage(spineBuffer, sharp));
      } else {
        const spineBase64 = spineBuffer.toString("base64");
        const mimeType = spine.type || "image/jpeg";
        images.push(`data:${mimeType};base64,${spineBase64}`);
      }
    }

    const result = await identifyWithAI(images);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Identify API error:", err);
    return NextResponse.json(
      { ok: false, error: "Ошибка сервера. Попробуйте позже." },
      { status: 500 }
    );
  }
}

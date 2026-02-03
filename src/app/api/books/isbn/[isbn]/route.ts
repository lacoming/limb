import { NextRequest, NextResponse } from "next/server";
import { getCache, setCache } from "@/lib/books/apiCache";
import { fetchByIsbnOpenLibrary } from "@/lib/books/adapters/openLibrary";
import { fetchByIsbnGoogleBooks } from "@/lib/books/adapters/googleBooks";
import type { WorkCandidate, EditionCandidate } from "@/lib/books/types";

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...a, ...b]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ isbn: string }> }
) {
  const { isbn } = await params;
  const normalized = isbn?.replace(/-/g, "").trim();
  if (!normalized) {
    return NextResponse.json(
      { works: [], editions: [], error: "Missing ISBN" },
      { status: 200 }
    );
  }

  const cacheKey = `isbn:${normalized}`;
  const cached = getCache<{ works: WorkCandidate[]; editions: EditionCandidate[] }>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  let works: WorkCandidate[] = [];
  let editions: EditionCandidate[] = [];
  let error: string | undefined;

  try {
    const olResult = await fetchByIsbnOpenLibrary(normalized);
    const gbResult = process.env.GOOGLE_BOOKS_API_KEY
      ? await fetchByIsbnGoogleBooks(normalized, process.env.GOOGLE_BOOKS_API_KEY).catch(() => ({
          works: [] as WorkCandidate[],
          editions: [] as EditionCandidate[],
        }))
      : { works: [] as WorkCandidate[], editions: [] as EditionCandidate[] };

    works = mergeById(olResult.works, gbResult.works);
    editions = mergeById(olResult.editions, gbResult.editions);
  } catch (e) {
    error = e instanceof Error ? e.message : "ISBN lookup failed";
  }

  const data = { works, editions, ...(error && { error }) };
  setCache(cacheKey, data);
  return NextResponse.json(data);
}

import { NextRequest, NextResponse } from "next/server";
import { getCache, setCache } from "@/lib/books/apiCache";
import { searchOpenLibrary } from "@/lib/books/adapters/openLibrary";
import { searchGoogleBooks } from "@/lib/books/adapters/googleBooks";
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

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json(
      { works: [], editions: [], error: "Missing query parameter q" },
      { status: 200 }
    );
  }

  const cacheKey = `search:${q}`;
  const cached = getCache<{ works: WorkCandidate[]; editions: EditionCandidate[] }>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  let works: WorkCandidate[] = [];
  let editions: EditionCandidate[] = [];
  let error: string | undefined;

  try {
    const olResult = await searchOpenLibrary(q);
    const gbResult = process.env.GOOGLE_BOOKS_API_KEY
      ? await searchGoogleBooks(q, process.env.GOOGLE_BOOKS_API_KEY).catch(() => ({
          works: [] as WorkCandidate[],
          editions: [] as EditionCandidate[],
        }))
      : { works: [] as WorkCandidate[], editions: [] as EditionCandidate[] };

    works = mergeById(olResult.works, gbResult.works);
    editions = mergeById(olResult.editions, gbResult.editions);
  } catch (e) {
    error = e instanceof Error ? e.message : "Search failed";
  }

  const data = { works, editions, ...(error && { error }) };
  setCache(cacheKey, data);
  return NextResponse.json(data);
}

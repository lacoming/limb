/**
 * Google Books adapter. Only used when GOOGLE_BOOKS_API_KEY is set.
 * Normalizes responses to WorkCandidate/EditionCandidate with provenance.
 */
import type { WorkCandidate, EditionCandidate } from "../types";

interface VolumeInfo {
  title?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  pageCount?: number;
  dimensions?: {
    height?: string;
    width?: string;
    thickness?: string;
  };
  imageLinks?: {
    small?: string;
    medium?: string;
    large?: string;
    thumbnail?: string;
  };
  industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
}

interface VolumeItem {
  id?: string;
  volumeInfo?: VolumeInfo;
  selfLink?: string;
}

interface GoogleBooksResponse {
  items?: VolumeItem[];
}

function parseMmFromDimension(val: string | undefined): number | undefined {
  if (!val || typeof val !== "string") return undefined;
  const match = val.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : undefined;
}

function extractYear(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined;
  const m = dateStr.match(/\d{4}/);
  return m ? parseInt(m[0], 10) : undefined;
}

function extractIsbn(identifiers: VolumeInfo["industryIdentifiers"]): string | undefined {
  if (!identifiers?.length) return undefined;
  const isbn13 = identifiers.find((i) => i.type === "ISBN_13" || i.type === "ISBN13");
  const isbn10 = identifiers.find((i) => i.type === "ISBN_10" || i.type === "ISBN10");
  return isbn13?.identifier ?? isbn10?.identifier;
}

export async function searchGoogleBooks(
  q: string,
  apiKey: string
): Promise<{ works: WorkCandidate[]; editions: EditionCandidate[] }> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Books search failed: ${res.status}`);
  }
  const json = (await res.json()) as GoogleBooksResponse;
  const items = json.items ?? [];
  const works: WorkCandidate[] = [];
  const editions: EditionCandidate[] = [];

  for (const item of items) {
    const volumeId = item.id ?? `vol-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const info = item.volumeInfo ?? {};
    const sourceUrl = item.selfLink ?? `https://www.googleapis.com/books/v1/volumes/${volumeId}`;

    const workId = `gb-work:${volumeId}`;
    const editionId = `gb-edition:${volumeId}`;

    const heightMm = parseMmFromDimension(info.dimensions?.height);
    const widthMm = parseMmFromDimension(info.dimensions?.width);
    const thicknessMm = parseMmFromDimension(info.dimensions?.thickness);
    const hasAllDimensions =
      heightMm != null && widthMm != null && thicknessMm != null;
    const dimensionsMm = hasAllDimensions
      ? { height: heightMm!, width: widthMm!, thickness: thicknessMm! }
      : {
          height: heightMm ?? 210,
          width: widthMm ?? 145,
        };

    const images: Record<string, string> | undefined = info.imageLinks
      ? {
          small: info.imageLinks.small ?? info.imageLinks.thumbnail ?? "",
          medium: info.imageLinks.medium ?? info.imageLinks.small ?? "",
          large: info.imageLinks.large ?? info.imageLinks.medium ?? "",
        }
      : undefined;

    const work: WorkCandidate = {
      id: workId,
      title: info.title ?? "Unknown",
      authors: info.authors ?? [],
      provenance: { source: "google_books", source_url: sourceUrl },
    };
    works.push(work);

    const edition: EditionCandidate = {
      id: editionId,
      workId,
      isbn: extractIsbn(info.industryIdentifiers),
      publisher: info.publisher,
      year: extractYear(info.publishedDate),
      pageCount: info.pageCount,
      dimensionsMm,
      images,
      provenance: { source: "google_books", source_url: sourceUrl },
    };
    editions.push(edition);
  }

  return { works, editions };
}

export async function fetchByIsbnGoogleBooks(
  isbn: string,
  apiKey: string
): Promise<{ works: WorkCandidate[]; editions: EditionCandidate[] }> {
  return searchGoogleBooks(`isbn:${isbn}`, apiKey);
}

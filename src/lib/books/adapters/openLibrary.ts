/**
 * Open Library adapter: search and ISBN lookup.
 * Normalizes responses to WorkCandidate/EditionCandidate with provenance.
 */
import type { WorkCandidate, EditionCandidate } from "../types";

const PROVENANCE = {
  source: "openlibrary" as const,
  source_url: "https://openlibrary.org",
};

interface OLSearchDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  cover_edition_key?: string;
  edition_key?: string[];
  isbn?: string[];
  number_of_pages_median?: number;
}

interface OLSearchResponse {
  docs?: OLSearchDoc[];
}

interface OLBooksDataItem {
  key?: string;
  url?: string;
  title?: string;
  authors?: Array<{ name?: string }>;
  number_of_pages?: number;
  publish_date?: string;
  publishers?: Array<{ name?: string }>;
  identifiers?: {
    isbn_10?: string[];
    isbn_13?: string[];
  };
  cover?: { small?: string; medium?: string; large?: string };
}

function extractYear(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined;
  const m = dateStr.match(/\d{4}/);
  return m ? parseInt(m[0], 10) : undefined;
}

function pickIsbn(isbns: string[] | undefined): string | undefined {
  if (!isbns || isbns.length === 0) return undefined;
  const isbn13 = isbns.find((i) => /^\d{13}$/.test(i));
  if (isbn13) return isbn13;
  const isbn10 = isbns.find((i) => /^\d{10}$/.test(i));
  if (isbn10) return isbn10;
  return isbns[0];
}

export async function searchOpenLibrary(
  q: string
): Promise<{ works: WorkCandidate[]; editions: EditionCandidate[] }> {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10&fields=key,title,author_name,first_publish_year,cover_i,cover_edition_key,edition_key,isbn,number_of_pages_median`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open Library search failed: ${res.status}`);
  }
  const json = (await res.json()) as OLSearchResponse;
  const docs = json.docs ?? [];
  const works: WorkCandidate[] = [];
  const editions: EditionCandidate[] = [];

  for (const doc of docs) {
    const workKey = doc.key?.replace("/works/", "") ?? `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workId = `ol-work:${workKey}`;
    const editionKey = doc.cover_edition_key ?? doc.edition_key?.[0] ?? workKey;
    const editionId = `ol-edition:${editionKey}`;
    const sourceUrl = doc.key ? `https://openlibrary.org${doc.key}` : PROVENANCE.source_url;

    const work: WorkCandidate = {
      id: workId,
      title: doc.title ?? "Unknown",
      authors: doc.author_name ?? [],
      provenance: { source: "openlibrary", source_url: sourceUrl },
    };
    works.push(work);

    const images: Record<string, string> | undefined = doc.cover_i
      ? {
          small: `https://covers.openlibrary.org/b/id/${doc.cover_i}-S.jpg`,
          medium: `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`,
          large: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
        }
      : undefined;

    const editionSourceUrl = `https://openlibrary.org/books/${editionKey}`;
    const edition: EditionCandidate = {
      id: editionId,
      workId,
      isbn: pickIsbn(doc.isbn),
      year: doc.first_publish_year,
      pageCount: doc.number_of_pages_median,
      dimensionsMm: {
        height: 210,
        width: 145,
      },
      images,
      provenance: { source: "openlibrary", source_url: editionSourceUrl },
    };
    editions.push(edition);
  }

  return { works, editions };
}

export async function fetchByIsbnOpenLibrary(
  isbn: string
): Promise<{ works: WorkCandidate[]; editions: EditionCandidate[] }> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open Library ISBN lookup failed: ${res.status}`);
  }
  const json = (await res.json()) as Record<string, OLBooksDataItem>;
  const bibKey = `ISBN:${isbn}`;
  const item = json[bibKey];
  if (!item) {
    return { works: [], editions: [] };
  }

  const editionKey = item.key?.replace("/books/", "") ?? `isbn-${isbn}`;
  const workId = `ol-work:isbn-${isbn}`;
  const editionId = `ol-edition:${editionKey}`;
  const sourceUrl = item.url ?? `https://openlibrary.org/isbn/${isbn}`;

  const work: WorkCandidate = {
    id: workId,
    title: item.title ?? "Unknown",
    authors: (item.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
    provenance: { source: "openlibrary", source_url: sourceUrl },
  };

  const images: Record<string, string> | undefined = item.cover
    ? {
        small: item.cover.small ?? "",
        medium: item.cover.medium ?? "",
        large: item.cover.large ?? "",
      }
    : undefined;

  const edition: EditionCandidate = {
    id: editionId,
    workId,
    isbn,
    publisher: item.publishers?.[0]?.name,
    year: extractYear(item.publish_date),
    pageCount: item.number_of_pages,
    dimensionsMm: {
      height: 210,
      width: 145,
    },
    images,
    provenance: { source: "openlibrary", source_url: sourceUrl },
  };

  return { works: [work], editions: [edition] };
}

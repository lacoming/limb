import { create } from "zustand";
import type { Work, Edition, UserCopy, UserCopyWithEdition } from "./types";

const FALLBACK_DIMENSIONS = {
  height: 210,
  width: 145,
  thickness: 25,
  method: "fallback" as const,
  confidence: 0.2,
};

function estimateThicknessFromPages(pageCount: number): number {
  const sheetMm = 0.09;
  const coverMm = 0.5;
  const bindingAllowanceMm = 1.0;
  const thickness = (pageCount / 2) * sheetMm + coverMm + bindingAllowanceMm;
  return Math.round(thickness * 10) / 10;
}

interface BooksState {
  works: Work[];
  editions: Edition[];
  userCopies: UserCopy[];
  demoVisible: boolean;
  loadDemo: () => void;
  clearDemo: () => void;
  toggleDemo: () => void;
  addFromCandidate: (work: Work, edition: Edition) => void;
}

const DEMO_WORK: Work = {
  id: "work_demo",
  title: "Demo Book",
  authors: ["Demo Author"],
};

const DEMO_EDITIONS: Edition[] = [
  {
    id: "ed_1",
    workId: "work_demo",
    dimensionsMm: { height: 180, width: 120, thickness: 15 },
  },
  {
    id: "ed_2",
    workId: "work_demo",
    dimensionsMm: { height: 210, width: 140, thickness: 22 },
  },
  {
    id: "ed_3",
    workId: "work_demo",
    dimensionsMm: { height: 240, width: 160, thickness: 28 },
  },
  {
    id: "ed_4",
    workId: "work_demo",
    dimensionsMm: { height: 195, width: 130, thickness: 10 },
  },
  {
    id: "ed_5",
    workId: "work_demo",
    dimensionsMm: { height: 225, width: 150, thickness: 35 },
  },
];

const DEMO_USER_COPIES: UserCopy[] = [
  { id: "copy_1", editionId: "ed_1", placement: { gx: 0, gy: 0 } },
  { id: "copy_2", editionId: "ed_2", placement: { gx: 0, gy: 0 } },
  { id: "copy_3", editionId: "ed_3", placement: { gx: 0, gy: 0 } },
  { id: "copy_4", editionId: "ed_4", placement: { gx: 0, gy: 0 } },
  { id: "copy_5", editionId: "ed_5", placement: { gx: 0, gy: 0 } },
];

export const useBooksStore = create<BooksState>()((set, get) => ({
  works: [],
  editions: [],
  userCopies: [],
  demoVisible: false,

  loadDemo: () =>
    set({
      works: [DEMO_WORK],
      editions: DEMO_EDITIONS,
      userCopies: DEMO_USER_COPIES,
      demoVisible: true,
    }),

  clearDemo: () =>
    set({
      works: [],
      editions: [],
      userCopies: [],
      demoVisible: false,
    }),

  toggleDemo: () => {
    const state = get();
    if (state.demoVisible) {
      state.clearDemo();
    } else {
      state.loadDemo();
    }
  },

  addFromCandidate: (work: Work, edition: Edition) => {
    const state = get();
    const baseDims = edition.dimensionsMm ?? {};

    const isFallbackThickness =
      baseDims.method === "fallback" ||
      (typeof baseDims.confidence === "number" && baseDims.confidence <= 0.3) ||
      (baseDims.thickness === FALLBACK_DIMENSIONS.thickness &&
        baseDims.method == null);

    const height = baseDims.height ?? FALLBACK_DIMENSIONS.height;
    const width = baseDims.width ?? FALLBACK_DIMENSIONS.width;
    let thickness = baseDims.thickness;
    let method = baseDims.method;
    let confidence = baseDims.confidence;

    if (thickness == null) {
      if (edition.pageCount && edition.pageCount > 0) {
        thickness = estimateThicknessFromPages(edition.pageCount);
        method = "estimated_from_pages";
        confidence = 0.6;
      } else {
        thickness = FALLBACK_DIMENSIONS.thickness;
        method = FALLBACK_DIMENSIONS.method;
        confidence = FALLBACK_DIMENSIONS.confidence;
      }
    } else if (isFallbackThickness && edition.pageCount && edition.pageCount > 0) {
      thickness = estimateThicknessFromPages(edition.pageCount);
      method = "estimated_from_pages";
      confidence = 0.6;
    }

    const finalDimensions = {
      height,
      width,
      thickness,
      method,
      confidence,
    };

    const editionToAdd: Edition = {
      ...edition,
      dimensionsMm: finalDimensions,
    };

    const works = state.works.some((w) => w.id === work.id)
      ? state.works.map((w) => (w.id === work.id ? work : w))
      : [...state.works, work];
    const editions = state.editions.some((e) => e.id === editionToAdd.id)
      ? state.editions.map((e) => (e.id === editionToAdd.id ? editionToAdd : e))
      : [...state.editions, editionToAdd];
    const userCopy: UserCopy = {
      id: `copy_${editionToAdd.id}_${Date.now()}`,
      editionId: editionToAdd.id,
      placement: { gx: 0, gy: 0 },
    };

    set({
      works,
      editions,
      userCopies: [...state.userCopies, userCopy],
    });
  },
}));

export function computeUserCopiesWithEdition(
  works: Work[],
  editions: Edition[],
  userCopies: UserCopy[]
): UserCopyWithEdition[] {
  const worksById = new Map(works.map((w) => [w.id, w]));
  const editionsById = new Map(editions.map((e) => [e.id, e]));

  return userCopies
    .map((copy) => {
      const edition = editionsById.get(copy.editionId);
      const work = edition ? worksById.get(edition.workId) : undefined;
      if (!edition || !work) return null;
      return { ...copy, edition, work };
    })
    .filter((v): v is UserCopyWithEdition => v !== null);
}

export function getUserCopiesWithEdition(): UserCopyWithEdition[] {
  const { works, editions, userCopies } = useBooksStore.getState();
  return computeUserCopiesWithEdition(works, editions, userCopies);
}

export function selectUserCopiesWithEdition(
  state: Pick<BooksState, "works" | "editions" | "userCopies">
): UserCopyWithEdition[] {
  return computeUserCopiesWithEdition(
    state.works,
    state.editions,
    state.userCopies
  );
}

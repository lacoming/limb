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
  // ~5mm per 100 pages + 1.5mm base offset
  const thickness = pageCount * 0.05 + 1.5;
  // Clamp: min 3mm, max 80mm
  const clamped = Math.max(3, Math.min(80, thickness));
  return Math.round(clamped * 10) / 10;
}

interface BooksState {
  works: Work[];
  editions: Edition[];
  userCopies: UserCopy[];
  demoVisible: boolean;
  activePlacement: { gx: number; gy: number } | null;
  loadDemo: () => void;
  clearDemo: () => void;
  toggleDemo: () => void;
  addFromCandidate: (work: Work, edition: Edition) => void;
  setActivePlacement: (placement: { gx: number; gy: number } | null) => void;
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
  activePlacement: null,

  setActivePlacement: (placement) => set({ activePlacement: placement }),

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

    const height = baseDims.height ?? FALLBACK_DIMENSIONS.height;
    const width = baseDims.width ?? FALLBACK_DIMENSIONS.width;
    // Thickness ONLY from pageCount; fallback = 3mm (min)
    const pc = typeof edition.pageCount === "number" ? edition.pageCount : NaN;
    const hasValidPageCount = Number.isFinite(pc) && pc > 0;
    const thickness = hasValidPageCount ? estimateThicknessFromPages(pc) : 3;
    const method = hasValidPageCount ? "estimated_from_pages" : "no_pagecount_fallback";
    const confidence = hasValidPageCount ? 0.6 : 0.1;

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
      placement: state.activePlacement ?? { gx: 0, gy: 0 },
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

import { create } from "zustand";
import type { Work, Edition, UserCopy, UserCopyWithEdition } from "./types";

interface BooksState {
  works: Work[];
  editions: Edition[];
  userCopies: UserCopy[];
  demoVisible: boolean;
  loadDemo: () => void;
  clearDemo: () => void;
  toggleDemo: () => void;
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

export interface Work {
  id: string;
  title: string;
  authors: string[];
  description?: string;
  subjects?: string[];
}

export interface DimensionsMm {
  height: number;
  width: number;
  thickness: number;
  method?: string;
  confidence?: number;
}

export interface Edition {
  id: string;
  workId: string;
  isbn?: string;
  publisher?: string;
  year?: number;
  pageCount?: number;
  dimensionsMm: DimensionsMm;
  images?: Record<string, string>;
}

export interface UserCopy {
  id: string;
  editionId: string;
  placement?: { gx: number; gy: number; xPx?: number; yPx?: number };
  notes?: string;
  rating?: number;
  tags?: string[];
}

export interface UserCopyWithEdition extends UserCopy {
  edition: Edition;
  work: Work;
}

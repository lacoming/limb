"use client";

import type { CellId } from "@/lib/libraryGrid";

const LIST_CAP = 50;

export interface DebugCellsPanelProps {
  getCells: () => Array<{ id: CellId; gx: number; gy: number }>;
  removeCell: (id: CellId) => boolean;
  clear: () => void;
  getEdgeErrors?: () => number;
}

export function DebugCellsPanel({
  getCells,
  removeCell,
  clear,
  getEdgeErrors,
}: DebugCellsPanelProps) {
  const cells = getCells();
  const count = cells.length;
  const shown = cells.slice(0, LIST_CAP);
  const hasMore = count > LIST_CAP;
  const edgeErrors = getEdgeErrors?.() ?? 0;

  return (
    <div className="absolute bottom-4 right-4 z-10 w-56 rounded bg-black/60 text-white text-xs overflow-hidden">
      <div className="px-3 py-2 border-b border-white/20 font-medium">
        Debug — Cells: {count}
        {edgeErrors > 0 && (
          <span className="ml-2 text-red-400">EdgeErrors: {edgeErrors}</span>
        )}
      </div>
      <div className="max-h-48 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="px-3 py-2 text-white/60">(none)</div>
        ) : (
          <ul className="divide-y divide-white/10">
            {shown.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5"
              >
                <span className="tabular-nums">{c.gx},{c.gy}</span>
                <button
                  type="button"
                  onClick={() => removeCell(c.id)}
                  className="px-2 py-0.5 rounded bg-red-500/60 hover:bg-red-500/80 text-white"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <div className="px-3 py-1.5 text-white/50">… and {count - LIST_CAP} more</div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-white/20">
        <button
          type="button"
          onClick={clear}
          disabled={count === 0}
          className="w-full px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 disabled:opacity-50 disabled:pointer-events-none"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

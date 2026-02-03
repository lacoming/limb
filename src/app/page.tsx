"use client";

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { DebugCellsPanel } from "@/components/DebugCellsPanel";
import { LibraryScene, type LibrarySceneRef } from "@/components/LibraryScene";
import { useBooksStore, computeUserCopiesWithEdition } from "@/lib/books";
import type { WorkCandidate, EditionCandidate } from "@/lib/books/types";

function BookDetailsCard({
  work,
  edition,
  onAdd,
  onClose,
}: {
  work: WorkCandidate;
  edition: EditionCandidate;
  onAdd: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const img = edition.images;
  const coverSrc = img?.large || img?.medium || img?.thumbnail || img?.small;

  return (
    <div className="rounded-xl bg-zinc-800 shadow-lg max-w-xs overflow-hidden">
      {/* Close button */}
      <div className="flex justify-end p-2 pb-0">
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/20 text-white/60 hover:text-white text-lg leading-none"
          title="Close"
        >
          ×
        </button>
      </div>
      <div className="flex gap-3 px-3 pb-3">
        {/* Cover */}
        <div className="shrink-0">
          {coverSrc ? (
            <img
              src={coverSrc}
              alt=""
              referrerPolicy="no-referrer"
              className="w-24 h-36 object-cover rounded-md bg-white/10"
            />
          ) : (
            <div className="w-24 h-36 rounded-md bg-white/10 flex items-center justify-center text-white/40 text-xs">
              No cover
            </div>
          )}
        </div>
        {/* Details */}
        <div className="flex-1 min-w-0 text-white text-xs space-y-1">
          <h2 className="font-semibold text-sm leading-tight">{work.title}</h2>
          {work.authors?.length > 0 && (
            <p className="text-white/80">{work.authors.join(", ")}</p>
          )}
          <div className="text-white/60 space-y-0.5">
            {edition.year != null && <p>Year: {edition.year}</p>}
            {edition.publisher && <p>Publisher: {edition.publisher}</p>}
            {edition.pageCount != null && <p>Pages: {edition.pageCount}</p>}
            {edition.isbn && <p>ISBN: {edition.isbn}</p>}
            <p className="capitalize">Source: {edition.provenance?.source || "unknown"}</p>
          </div>
          {work.description && (
            <div className="mt-1">
              <p className="text-white/50 mb-0.5">Description:</p>
              <p className="text-white/80 max-h-20 overflow-y-auto leading-relaxed">
                {work.description}
              </p>
            </div>
          )}
        </div>
      </div>
      {/* Add button */}
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onAdd}
          className="w-full py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const sceneRef = useRef<LibrarySceneRef>(null);
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [camX, setCamX] = useState(0);
  const [camY, setCamY] = useState(0);
  const [camZoom, setCamZoom] = useState(1);
  const [cellCount, setCellCount] = useState(0);
  const [multiSelectedCount, setMultiSelectedCount] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [safeDeleteEnabled, setSafeDeleteEnabled] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<{
    n: number;
    perform: () => void;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [debugDirty, setDebugDirty] = useState(0);
  const [controlsExpanded, setControlsExpanded] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ work: WorkCandidate; edition: EditionCandidate }>
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<{
    work: WorkCandidate;
    edition: EditionCandidate;
  } | null>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLUListElement>(null);
  const detailsHostRef = useRef<HTMLDivElement>(null);
  const detailsCardRef = useRef<HTMLDivElement>(null);
  const [selectedRowTop, setSelectedRowTop] = useState(0);

  const demoBooksVisible = useBooksStore((s) => s.demoVisible);
  const works = useBooksStore((s) => s.works);
  const editions = useBooksStore((s) => s.editions);
  const userCopies = useBooksStore((s) => s.userCopies);
  const demoBooksData = useMemo(
    () => computeUserCopiesWithEdition(works, editions, userCopies),
    [works, editions, userCopies]
  );

  const handleCameraChange = useCallback(
    (data: { x: number; y: number; zoom: number }) => {
      setCamX(data.x);
      setCamY(data.y);
      setCamZoom(data.zoom);
    },
    []
  );

  const handleCellCountChange = useCallback((count: number) => {
    setCellCount(count);
  }, []);

  const handleMultiSelectionChange = useCallback((count: number) => {
    setMultiSelectedCount(count);
  }, []);

  const handleHistoryChange = useCallback((undo: boolean, redo: boolean) => {
    setCanUndo(undo);
    setCanRedo(redo);
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  const handleAddCell = useCallback((gx: number, gy: number) => {
    if (sceneRef.current?.addCellAt(gx, gy)) {
      // Success - count will update via callback
    } else {
      showToast("Position already occupied");
    }
  }, [showToast]);

  const handleRequestDelete = useCallback(
    (n: number, perform: () => void) => {
      setConfirmDelete({ n, perform });
    },
    []
  );

  // Recalculate card position (desktop)
  const recalcCardTop = useCallback(() => {
    if (!selectedRowRef.current || !listContainerRef.current || !detailsHostRef.current) return;
    const rowRect = selectedRowRef.current.getBoundingClientRect();
    const listRect = listContainerRef.current.getBoundingClientRect();
    const topPx = rowRect.top - listRect.top + listContainerRef.current.scrollTop;
    const hostH = detailsHostRef.current.clientHeight;
    const cardH = detailsCardRef.current?.offsetHeight ?? 0;
    const clamped = Math.max(0, Math.min(topPx, Math.max(0, hostH - cardH)));
    setSelectedRowTop(clamped);
  }, []);

  // Update card position on selection or search results change
  useLayoutEffect(() => {
    if (selectedCandidate) {
      recalcCardTop();
    }
  }, [selectedCandidate, searchResults, recalcCardTop]);

  // Scroll listener on list
  useEffect(() => {
    const list = listContainerRef.current;
    if (!list || !selectedCandidate) return;
    const onScroll = () => recalcCardTop();
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, [selectedCandidate, recalcCardTop]);

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/books/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.error) {
        setSearchError(data.error);
        setSearchResults([]);
      } else {
        const candidates = (data.editions as EditionCandidate[])
          .map((edition) => {
            const work = (data.works as WorkCandidate[]).find(
              (w) => w.id === edition.workId
            );
            return work ? { work, edition } : null;
          })
          .filter((x): x is { work: WorkCandidate; edition: EditionCandidate } => x !== null);
        setSearchResults(candidates);
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  const handleAddCandidate = useCallback(
    (work: WorkCandidate, edition: EditionCandidate) => {
      useBooksStore.getState().addFromCandidate(work, edition);
      showToast("Book added");
    },
    [showToast]
  );

  // Keyboard shortcut for mode toggle (E key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'e' || e.key === 'E') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        setMode(m => m === 'edit' ? 'view' : 'edit');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden bg-zinc-900">
      <div className="absolute inset-0">
        <LibraryScene
          ref={sceneRef}
          mode={mode}
          safeDeleteEnabled={safeDeleteEnabled}
          demoBooksVisible={demoBooksVisible}
          demoBooksData={demoBooksData}
          onCameraChange={handleCameraChange}
          onCellCountChange={handleCellCountChange}
          onMultiSelectionChange={handleMultiSelectionChange}
          onHistoryChange={handleHistoryChange}
          onDeleteBlocked={showToast}
          onRequestDelete={handleRequestDelete}
        />
      </div>
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-4 px-4 py-3 bg-black/40 text-white text-sm">
        <h1 className="font-semibold">Limb</h1>
        <div className="flex items-center gap-3">
          <span className="tabular-nums">
            x: {camX.toFixed(0)} y: {camY.toFixed(0)} zoom: {camZoom.toFixed(2)}
          </span>
          <span className="tabular-nums text-xs">
            Cells: {cellCount}
          </span>
          {multiSelectedCount > 0 && (
            <span className="tabular-nums text-xs text-blue-300">
              Selected: {multiSelectedCount}
            </span>
          )}
          <button
            type="button"
            onClick={() => sceneRef.current?.removeSelectedCells()}
            disabled={multiSelectedCount === 0 || mode === "view"}
            className="px-3 py-1.5 rounded bg-red-500/60 hover:bg-red-500/80 disabled:opacity-50 disabled:pointer-events-none text-sm"
          >
            Remove Selected
          </button>
          <button
            type="button"
            onClick={() => sceneRef.current?.undo()}
            disabled={!canUndo || mode === "view"}
            className="px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 disabled:opacity-50 disabled:pointer-events-none text-sm"
            title="Undo"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => sceneRef.current?.redo()}
            disabled={!canRedo || mode === "view"}
            className="px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 disabled:opacity-50 disabled:pointer-events-none text-sm"
            title="Redo"
          >
            Redo
          </button>
          <div className="flex flex-col gap-0.5">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={safeDeleteEnabled}
                onChange={(e) => setSafeDeleteEnabled(e.target.checked)}
                disabled={mode === "view"}
                className="rounded"
              />
              Safe delete
            </label>
            <span className="text-xs text-white/60">
              Prevents splitting the structure
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={demoBooksVisible}
              onChange={() => useBooksStore.getState().toggleDemo()}
              className="rounded"
            />
            Demo Books
          </label>
          {/* Mode toggle */}
          <div className="flex gap-1 bg-black/40 rounded p-1">
            <button
              type="button"
              onClick={() => setMode('edit')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                mode === 'edit' 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-transparent text-white/60 hover:text-white/80'
              }`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                mode === 'view' 
                  ? 'bg-gray-500 text-white' 
                  : 'bg-transparent text-white/60 hover:text-white/80'
              }`}
            >
              View
            </button>
          </div>
          <button
            type="button"
            onClick={() => sceneRef.current?.resetCamera()}
            className="px-3 py-1.5 rounded bg-white/20 hover:bg-white/30"
          >
            Reset/Center
          </button>
        </div>
      </div>
      
      {/* Control Panel */}
      <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleAddCell(1, 0)}
            className="px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 text-sm"
            title="Add Right"
          >
            +→
          </button>
          <button
            type="button"
            onClick={() => handleAddCell(-1, 0)}
            className="px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 text-sm"
            title="Add Left"
          >
            +←
          </button>
          <button
            type="button"
            onClick={() => handleAddCell(0, -1)}
            className="px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 text-sm"
            title="Add Up"
          >
            +↑
          </button>
          <button
            type="button"
            onClick={() => handleAddCell(0, 1)}
            className="px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 text-sm"
            title="Add Down"
          >
            +↓
          </button>
        </div>

        {/* Book Search + Desktop Details Host */}
        <div className="flex items-stretch gap-3">
          {/* Left Panel */}
          <div className="rounded bg-black/60 text-white text-xs overflow-hidden max-w-xs">
            <div className="px-3 py-2 font-medium border-b border-white/20">
              Book Search
            </div>
            <div className="p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Title, author..."
                  className="flex-1 px-2 py-1.5 rounded bg-white/10 border border-white/20 text-sm text-white placeholder-white/50 focus:outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searchLoading}
                  className="px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 disabled:opacity-50 text-sm"
                >
                  {searchLoading ? "..." : "Search"}
                </button>
              </div>
              {searchError && (
                <p className="text-red-400 text-xs">{searchError}</p>
              )}
              {searchResults.length > 0 && (
                <ul ref={listContainerRef} className="space-y-2 max-h-48 overflow-y-auto">
                  {searchResults.map(({ work, edition }) => {
                    const isSelected = selectedCandidate?.edition.id === edition.id;
                    return (
                      <li key={edition.id}>
                        <div
                          ref={isSelected ? selectedRowRef : undefined}
                          onClick={() => setSelectedCandidate({ work, edition })}
                          className="flex items-start justify-between gap-2 py-1.5 border-b border-white/10 cursor-pointer hover:bg-white/5 rounded"
                        >
                          {(() => {
                            const img = edition.images;
                            const src = img?.thumbnail || img?.small || img?.medium || img?.large;
                            return src ? (
                              <img
                                src={src}
                                alt=""
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="shrink-0 w-10 h-14 object-cover rounded-md bg-white/10"
                              />
                            ) : (
                              <div className="shrink-0 w-10 h-14 rounded-md bg-white/10" />
                            );
                          })()}
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{work.title}</div>
                            <div className="text-white/70 truncate">
                              {work.authors?.join(", ")}
                              {edition.year != null && ` · ${edition.year}`}
                              {edition.isbn && ` · ${edition.isbn}`}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddCandidate(work, edition);
                            }}
                            className="shrink-0 px-2 py-1 rounded bg-green-600/80 hover:bg-green-600 text-xs"
                          >
                            Add
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* Book Details Card - mobile only */}
              {selectedCandidate && (
                <div className="min-[900px]:hidden">
                  <BookDetailsCard
                    work={selectedCandidate.work}
                    edition={selectedCandidate.edition}
                    onAdd={() => {
                      handleAddCandidate(selectedCandidate.work, selectedCandidate.edition);
                      setSelectedCandidate(null);
                    }}
                    onClose={() => setSelectedCandidate(null)}
                  />
                </div>
              )}
            </div>
          </div>
          {/* Desktop Details Host - outside dark panel */}
          <div
            ref={detailsHostRef}
            className="hidden min-[900px]:block relative self-stretch w-[360px] overflow-hidden"
          >
            {selectedCandidate && (
              <div
                ref={detailsCardRef}
                className="absolute left-0 w-full"
                style={{ top: selectedRowTop }}
              >
                <BookDetailsCard
                  work={selectedCandidate.work}
                  edition={selectedCandidate.edition}
                  onAdd={() => {
                    handleAddCandidate(selectedCandidate.work, selectedCandidate.edition);
                    setSelectedCandidate(null);
                  }}
                  onClose={() => setSelectedCandidate(null)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Controls Help Panel */}
        <div className="rounded bg-black/60 text-white text-xs overflow-hidden max-w-xs">
          <button
            type="button"
            onClick={() => setControlsExpanded(!controlsExpanded)}
            className="w-full px-3 py-2 text-left font-medium border-b border-white/20 hover:bg-white/10 flex items-center justify-between"
          >
            <span>Controls</span>
            <span className="text-white/60">{controlsExpanded ? '▼' : '▶'}</span>
          </button>
          {controlsExpanded && (
            <div className="px-3 py-2 space-y-2">
              {mode === 'view' && (
                <div className="text-yellow-400 font-medium mb-2">
                  ⚠ Editing disabled (View mode)
                </div>
              )}
              <div>
                <div className="text-white/80 font-medium mb-1">Desktop:</div>
                <ul className="space-y-0.5 text-white/70">
                  <li>• Click: Select cell</li>
                  <li>• Marquee: Drag on empty area</li>
                  <li>• Shift+Click: Toggle multi-select</li>
                  {mode === "edit" && (
                    <li>• Delete: Remove selected</li>
                  )}
                  {mode === "edit" && (
                    <li>• Arrows: Add/remove neighbors</li>
                  )}
                  <li>• Esc: Unselect</li>
                  {mode === "edit" && (
                    <>
                      <li>• Cmd+Z (Ctrl+Z): Undo</li>
                      <li>• Cmd+Shift+Z (Ctrl+Shift+Z): Redo</li>
                      <li>• Ctrl+Y: Redo (Win)</li>
                    </>
                  )}
                  <li>• Wheel: Zoom</li>
                  <li>• Drag: Pan</li>
                  <li>• E: Toggle Edit/View</li>
                </ul>
              </div>
              <div>
                <div className="text-white/80 font-medium mb-1">Mobile:</div>
                <ul className="space-y-0.5 text-white/70">
                  <li>• Tap: Select cell</li>
                  {mode === 'edit' && <li>• Double-tap: Toggle cell</li>}
                  <li>• Pinch: Zoom</li>
                  <li>• Drag: Pan</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-800 rounded-lg px-6 py-4 max-w-sm mx-4 text-white">
            <p className="mb-4">
              Delete {confirmDelete.n} cells? You can undo (Cmd/Ctrl+Z).
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 rounded bg-white/20 hover:bg-white/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmDelete.perform();
                  setConfirmDelete(null);
                }}
                className="px-3 py-1.5 rounded bg-red-500/80 hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <div className="absolute bottom-4 right-4 z-20 px-4 py-2 rounded bg-red-500/80 text-white text-sm animate-pulse">
          {toastMessage}
        </div>
      )}


      {/* Debug cells panel */}
      <DebugCellsPanel
        key={debugDirty}
        getCells={() => sceneRef.current?.getCells() ?? []}
        removeCell={(id) => {
          const ok = sceneRef.current?.removeCell(id) ?? false;
          if (ok) setDebugDirty((n) => n + 1);
          return ok;
        }}
        clear={() => {
          sceneRef.current?.clear();
          setDebugDirty((n) => n + 1);
        }}
        getEdgeErrors={() => sceneRef.current?.getEdgeErrors() ?? 0}
      />
    </div>
  );
}

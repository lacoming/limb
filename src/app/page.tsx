"use client";

import { useRef, useState, useCallback } from "react";
import { DebugCellsPanel } from "@/components/DebugCellsPanel";
import { LibraryScene, type LibrarySceneRef } from "@/components/LibraryScene";

export default function Home() {
  const sceneRef = useRef<LibrarySceneRef>(null);
  const [camX, setCamX] = useState(0);
  const [camY, setCamY] = useState(0);
  const [camZoom, setCamZoom] = useState(1);
  const [cellCount, setCellCount] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [debugDirty, setDebugDirty] = useState(0);

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

  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden bg-zinc-900">
      <div className="absolute inset-0">
        <LibraryScene
          ref={sceneRef}
          onCameraChange={handleCameraChange}
          onCellCountChange={handleCellCountChange}
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
      </div>

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

"use client";

import { useRef, useState, useCallback } from "react";
import { LibraryScene, type LibrarySceneRef } from "@/components/LibraryScene";

export default function Home() {
  const sceneRef = useRef<LibrarySceneRef>(null);
  const [camX, setCamX] = useState(0);
  const [camY, setCamY] = useState(0);
  const [camZoom, setCamZoom] = useState(1);
  const [stretchDebug, setStretchDebug] = useState<{
    mag: number;
    t: number;
    frameIndex: number;
    dir: string;
    offsetX: number;
    offsetY: number;
    absX: number;
    absY: number;
    axis: 'x' | 'y' | null;
  } | null>(null);
  const [loadedDirs, setLoadedDirs] = useState<string[]>([]);

  const handleCameraChange = useCallback(
    (data: { x: number; y: number; zoom: number }) => {
      setCamX(data.x);
      setCamY(data.y);
      setCamZoom(data.zoom);
    },
    []
  );

  const handleStretchDebug = useCallback(
    (data: {
      mag: number;
      t: number;
      frameIndex: number;
      dir: string;
      offsetX: number;
      offsetY: number;
      absX: number;
      absY: number;
      axis: 'x' | 'y' | null;
    }) => {
      setStretchDebug(data);
    },
    []
  );

  const handleAtlasLoadChange = useCallback(
    (data: { loadedDirs: string[] }) => {
      setLoadedDirs(data.loadedDirs);
    },
    []
  );

  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden bg-zinc-900">
      <div className="absolute inset-0">
        <LibraryScene
          ref={sceneRef}
          onCameraChange={handleCameraChange}
          onStretchDebug={handleStretchDebug}
          onAtlasLoadChange={handleAtlasLoadChange}
        />
      </div>
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-4 px-4 py-3 bg-black/40 text-white text-sm">
        <h1 className="font-semibold">Limb</h1>
        <div className="flex items-center gap-3">
          <span className="tabular-nums">
            x: {camX.toFixed(0)} y: {camY.toFixed(0)} zoom: {camZoom.toFixed(2)}
          </span>
          {loadedDirs.length > 0 && (
            <span className="tabular-nums text-xs text-green-300">
              atlases: [{loadedDirs.join(",")}]
            </span>
          )}
          {stretchDebug && (
            <span className="tabular-nums text-xs">
              X:{stretchDebug.offsetX.toFixed(0)} Y:{stretchDebug.offsetY.toFixed(0)} |X|:{stretchDebug.absX.toFixed(0)} |Y|:{stretchDebug.absY.toFixed(0)} axis:{stretchDebug.axis || 'null'} dir:{stretchDebug.dir} mag:{stretchDebug.mag.toFixed(1)}px frame:{stretchDebug.frameIndex}
            </span>
          )}
          <button
            type="button"
            onClick={() => sceneRef.current?.resetCamera()}
            className="px-3 py-1.5 rounded bg-white/20 hover:bg-white/30"
          >
            Reset camera
          </button>
        </div>
      </div>
    </div>
  );
}

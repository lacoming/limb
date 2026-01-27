"use client";

import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import {
  Application,
  Assets,
  Container,
  FederatedPointerEvent,
  Sprite,
} from "pixi.js";
import {
  advanceSpring,
  applyPanWithRubber,
  CONTENT_BOUNDS,
  createInitialCamera,
  getSingleCellCenterTarget,
  getWorldTransformInto,
  worldToScreen,
  zoomAboutScreenPoint,
  type CameraState,
} from "./camera";
import {
  createCellContainerTurntableFrames,
  updateCellTurntableFrames,
} from "./cellSprite";
import { unloadAllTextures, Direction, hasTextures, getCachedTextures } from "./cellFrames";
import { preloadAtlases } from "../../lib/preloadCellFrames";

const DEBUG_THROTTLE_MS = 250;
const BG = 0x1a1a1a;

/**
 * Prewarms GPU textures by uploading them to GPU memory.
 * Creates a temporary hidden sprite and assigns textures from each direction
 * (frames 0, 4, 8) to trigger GPU upload via renderer.render().
 */
async function prewarmGpuTextures(app: Application, stage: Container): Promise<void> {
  const idleTextures = getCachedTextures(Direction.Left);
  if (!idleTextures || idleTextures.length === 0) return;
  
  const idleTexture = idleTextures[0]; // frame 1 для возврата
  const tempSprite = new Sprite({ texture: idleTexture, anchor: 0.5 });
  tempSprite.alpha = 0;
  tempSprite.visible = false;
  stage.addChild(tempSprite);
  
  const directions = [Direction.Left, Direction.Right, Direction.Up, Direction.Down];
  const frameIndices = [0, 4, 8]; // frames[0], frames[4], frames[8]
  
  for (const dir of directions) {
    const textures = getCachedTextures(dir);
    if (!textures) continue;
    
    for (const idx of frameIndices) {
      if (idx < textures.length) {
        tempSprite.texture = textures[idx];
        app.renderer.render(stage);
      }
    }
  }
  
  // Вернуть на idle
  tempSprite.texture = idleTexture;
  app.renderer.render(stage);
  
  // Удалить временный sprite
  stage.removeChild(tempSprite);
  tempSprite.destroy();
}

export interface LibrarySceneRef {
  resetCamera: () => void;
}

export interface LibrarySceneProps {
  onCameraChange?: (data: {
    x: number;
    y: number;
    zoom: number;
  }) => void;
  onStretchDebug?: (data: {
    mag: number;
    t: number;
    frameIndex: number;
    dir: string;
    offsetX: number;
    offsetY: number;
    absX: number;
    absY: number;
    axis: 'x' | 'y' | null;
  }) => void;
  onAtlasLoadChange?: (data: {
    loadedDirs: string[];
  }) => void;
}

export const LibraryScene = forwardRef<LibrarySceneRef, LibrarySceneProps>(
  function LibraryScene({ onCameraChange, onStretchDebug, onAtlasLoadChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const onCameraChangeRef = useRef(onCameraChange);
    onCameraChangeRef.current = onCameraChange;
    const onStretchDebugRef = useRef(onStretchDebug);
    onStretchDebugRef.current = onStretchDebug;
    const onAtlasLoadChangeRef = useRef(onAtlasLoadChange);
    onAtlasLoadChangeRef.current = onAtlasLoadChange;

    useImperativeHandle(
      ref,
      () => ({
        resetCamera() {
          resetCameraRef.current?.();
        },
      }),
      []
    );

    const resetCameraRef = useRef<(() => void) | null>(null);
    const initOnceRef = useRef(false);

    useEffect(() => {
      if (initOnceRef.current) return;
      initOnceRef.current = true;

      const container = containerRef.current;
      if (!container) return;

      let app: Application | null = new Application();
      let cancelled = false;
      let teardown: (() => void) | null = null;

      (async () => {
        await app!.init({
          width: container.clientWidth,
          height: container.clientHeight,
          resolution: Math.min(2, window.devicePixelRatio ?? 1),
          autoDensity: true,
          resizeTo: container,
          backgroundColor: BG,
        });
        if (cancelled || !app) return;
        if (containerRef.current !== container) return;

        container.appendChild(app.canvas);

        const world = new Container();
        const worldContent = new Container();
        world.addChild(worldContent);
        app.stage.addChild(world);

        // Boot preload: load all atlases before any interaction
        let atlasesReady = false;
        await preloadAtlases([
          Direction.Left,
          Direction.Right,
          Direction.Up,
          Direction.Down,
        ]);
        if (cancelled || !app) return;
        if (containerRef.current !== container) return;
        atlasesReady = true;

        // Prewarm GPU textures to avoid first-frame freeze
        let gpuPrewarmed = false;
        await prewarmGpuTextures(app, app.stage);
        if (cancelled || !app) return;
        if (containerRef.current !== container) return;
        gpuPrewarmed = true;

        // Notify about loaded atlases
        const updateAtlasStatus = () => {
          const loadedDirs: string[] = [];
          if (hasTextures(Direction.Left)) loadedDirs.push("left");
          if (hasTextures(Direction.Right)) loadedDirs.push("right");
          if (hasTextures(Direction.Up)) loadedDirs.push("up");
          if (hasTextures(Direction.Down)) loadedDirs.push("down");
          onAtlasLoadChangeRef.current?.({ loadedDirs });
        };
        updateAtlasStatus();

        const cellContainer = await createCellContainerTurntableFrames({
          targetHeight: 300,
        });
        if (cancelled || !app) return;
        if (containerRef.current !== container) return;

        worldContent.addChild(cellContainer);

        const camera: CameraState = createInitialCamera();
        resetCameraRef.current = () => {
          camera.cx = 0;
          camera.cy = 0;
          camera.s = 1;
        };

        let lastDebugAt = 0;
        const springVelocity = { vx: 0, vy: 0 };
        const worldTransformOut = { x: 0, y: 0, scale: 1 };
        const onTick = (ticker: { deltaMS: number }) => {
          const sw = app!.screen.width;
          const sh = app!.screen.height;

          if (springBackActive && !isDragging) {
            const targetCx =
              (CONTENT_BOUNDS.minX + CONTENT_BOUNDS.maxX) / 2;
            const targetCy =
              (CONTENT_BOUNDS.minY + CONTENT_BOUNDS.maxY) / 2;
            const dt = ticker.deltaMS / 1000;
            const done = advanceSpring(
              camera,
              springVelocity,
              targetCx,
              targetCy,
              dt
            );
            if (done) {
              camera.cx = targetCx;
              camera.cy = targetCy;
              springVelocity.vx = 0;
              springVelocity.vy = 0;
              springBackActive = false;
            }
          }

          getWorldTransformInto(camera, sw, sh, worldTransformOut);
          world.position.set(worldTransformOut.x, worldTransformOut.y);
          world.scale.set(worldTransformOut.scale);

          const cellCenterScreen = worldToScreen(0, 0, camera, sw, sh);
          const offsetX = cellCenterScreen.x - sw / 2;
          const offsetY = cellCenterScreen.y - sh / 2;
          const frameState = updateCellTurntableFrames(
            cellContainer,
            offsetX,
            offsetY,
            isDragging,
            ticker.deltaMS,
            atlasesReady && gpuPrewarmed
          );

          const now = Date.now();
          if (now - lastDebugAt >= DEBUG_THROTTLE_MS) {
            lastDebugAt = now;
            onCameraChangeRef.current?.({
              x: camera.cx,
              y: camera.cy,
              zoom: camera.s,
            });
            if (frameState && onStretchDebugRef.current) {
              onStretchDebugRef.current({
                mag: frameState.mag,
                t: frameState.t,
                frameIndex: frameState.frameIndex,
                dir: frameState.dir,
                offsetX: frameState.offsetX,
                offsetY: frameState.offsetY,
                absX: frameState.absX,
                absY: frameState.absY,
                axis: frameState.axis,
              });
            }
          }
        };
        app.ticker.add(onTick);

        let isDragging = false;
        let lastScreenX = 0;
        let lastScreenY = 0;
        let pinchActive = false;
        let springBackActive = false;

        const onPointerDown = (e: FederatedPointerEvent) => {
          if (pinchActive) return;
          isDragging = true;
          lastScreenX = e.global.x;
          lastScreenY = e.global.y;
        };
        const onGlobalMove = (e: FederatedPointerEvent) => {
          if (pinchActive || !isDragging) return;
          const dx = e.global.x - lastScreenX;
          const dy = e.global.y - lastScreenY;
          lastScreenX = e.global.x;
          lastScreenY = e.global.y;
          applyPanWithRubber(
            camera,
            dx,
            dy,
            screenW(),
            screenH(),
            getSingleCellCenterTarget(CONTENT_BOUNDS)
          );
        };
        const onPointerUp = () => {
          isDragging = false;
          springBackActive = true;
        };

        app.stage.eventMode = "static";
        app.stage.hitArea = app.screen;
        app.stage.on("pointerdown", onPointerDown);
        app.stage.on("globalpointermove", onGlobalMove);
        app.stage.on("pointerup", onPointerUp);
        app.stage.on("pointerupoutside", onPointerUp);

        const rect = () => container.getBoundingClientRect();
        const screenW = () => app!.screen.width;
        const screenH = () => app!.screen.height;

        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const r = rect();
          const sx = e.clientX - r.left;
          const sy = e.clientY - r.top;
          const factor =
            1 - 0.001 * Math.sign(e.deltaY) * Math.min(400, Math.abs(e.deltaY));
          zoomAboutScreenPoint(
            camera,
            sx,
            sy,
            factor,
            screenW(),
            screenH()
          );
        };
        container.addEventListener("wheel", onWheel, { passive: false });

        let prevPinchDist = 0;
        const onTouchStart = (e: TouchEvent) => {
          if (e.touches.length >= 2) pinchActive = true;
        };
        const onTouchMove = (e: TouchEvent) => {
          if (e.touches.length !== 2) return;
          e.preventDefault();
          const t0 = e.touches[0];
          const t1 = e.touches[1];
          const r = rect();
          const midX = (t0.clientX + t1.clientX) / 2 - r.left;
          const midY = (t0.clientY + t1.clientY) / 2 - r.top;
          const dist = Math.hypot(
            t1.clientX - t0.clientX,
            t1.clientY - t0.clientY
          );
          if (prevPinchDist > 0) {
            const factor = dist / prevPinchDist;
            zoomAboutScreenPoint(
              camera,
              midX,
              midY,
              factor,
              screenW(),
              screenH()
            );
          }
          prevPinchDist = dist;
        };
        const onTouchEnd = (e: TouchEvent) => {
          if (e.touches.length < 2) {
            pinchActive = false;
            prevPinchDist = 0;
          }
        };
        container.addEventListener("touchstart", onTouchStart, {
          passive: true,
        });
        container.addEventListener("touchmove", onTouchMove, {
          passive: false,
        });
        container.addEventListener("touchend", onTouchEnd, { passive: true });

        teardown = () => {
          app!.ticker.remove(onTick);
          app!.stage.off("pointerdown", onPointerDown);
          app!.stage.off("globalpointermove", onGlobalMove);
          app!.stage.off("pointerup", onPointerUp);
          app!.stage.off("pointerupoutside", onPointerUp);
          container.removeEventListener("wheel", onWheel);
          container.removeEventListener("touchstart", onTouchStart);
          container.removeEventListener("touchmove", onTouchMove);
          container.removeEventListener("touchend", onTouchEnd);
        };
      })();

      return () => {
        cancelled = true;
        initOnceRef.current = false;
        resetCameraRef.current = null;
        teardown?.();
        unloadAllTextures();
        app?.destroy({ removeView: true }, { children: true });
        app = null;
      };
    }, []);

    return (
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", position: "relative" }}
      />
    );
  }
);

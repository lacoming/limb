"use client";

import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Application, Container, FederatedPointerEvent, Sprite, Point } from "pixi.js";
import {
  advanceSpring,
  applyPanWithRubber,
  CONTENT_BOUNDS,
  createInitialCamera,
  getSingleCellCenterTarget,
  getWorldTransformInto,
  zoomAboutScreenPoint,
  getGridBounds,
  type CameraState,
  type ContentBounds,
} from "./camera";
import { cellKey, devAssertNeighborDirection } from "../../lib/cellKeys";
import {
  LibraryGrid,
  type CellId,
} from "../../lib/libraryGrid";
import { preloadShelfAssets } from "../../lib/shelfAssets";
import { computeShelfMetrics } from "../../lib/shelfMetrics";
import { buildShelfContainer } from "../../lib/shelfComposer";
import { bakeShelf } from "../../lib/shelfBake";
import { updateSelectionOverlay } from "./cellSelection";

const DEBUG_THROTTLE_MS = 250;
const BG = 0x1a1a1a;
const DEV_GRID_LOG = false;

export interface LibrarySceneRef {
  resetCamera: () => void;
  addCellAt: (gx: number, gy: number) => boolean;
  getCellCount: () => number;
  getCells: () => Array<{ id: CellId; gx: number; gy: number }>;
  removeCell: (id: CellId) => boolean;
  clear: () => void;
  getEdgeErrors: () => number;
}

export interface LibrarySceneProps {
  mode?: 'edit' | 'view';
  onCameraChange?: (data: {
    x: number;
    y: number;
    zoom: number;
  }) => void;
  onCellCountChange?: (count: number) => void;
}

export const LibraryScene = forwardRef<LibrarySceneRef, LibrarySceneProps>(
  function LibraryScene({ mode = 'edit', onCameraChange, onCellCountChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const modeRef = useRef(mode);
    const onCameraChangeRef = useRef(onCameraChange);
    const onCellCountChangeRef = useRef(onCellCountChange);
    useEffect(() => {
      modeRef.current = mode;
    }, [mode]);
    useEffect(() => {
      onCameraChangeRef.current = onCameraChange;
      onCellCountChangeRef.current = onCellCountChange;
    }, [onCameraChange, onCellCountChange]);

    useImperativeHandle(
      ref,
      () => ({
        resetCamera() {
          resetCameraRef.current?.();
        },
        addCellAt(gx: number, gy: number) {
          return addCellAtRef.current?.(gx, gy) ?? false;
        },
        getCellCount() {
          return getCellCountRef.current?.() ?? 0;
        },
        getCells() {
          return getCellsRef.current?.() ?? [];
        },
        removeCell(id: CellId) {
          return removeCellRef.current?.(id) ?? false;
        },
        clear() {
          clearRef.current?.();
        },
        getEdgeErrors() {
          return getEdgeErrorsRef.current?.() ?? 0;
        },
      }),
      []
    );

    const resetCameraRef = useRef<(() => void) | null>(null);
    const addCellAtRef = useRef<((gx: number, gy: number) => boolean) | null>(null);
    const getCellCountRef = useRef<(() => number) | null>(null);
    const getCellsRef = useRef<
      (() => Array<{ id: CellId; gx: number; gy: number }>) | null
    >(null);
    const removeCellRef = useRef<((id: CellId) => boolean) | null>(null);
    const clearRef = useRef<(() => void) | null>(null);
    const getEdgeErrorsRef = useRef<(() => number) | null>(null);
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

        const shelfTextures = await preloadShelfAssets();
        if (cancelled || !app) return;
        if (containerRef.current !== container) return;

        const metrics = computeShelfMetrics(shelfTextures);

        const grid = new LibraryGrid();
        grid.addCellAt(0, 0);

        let bakedShelf: Sprite | null = null;
        let selectedCellKey: string | null = null;
        const selectionOverlay = new Container();
        worldContent.addChild(selectionOverlay);

        let edgeErrors = 0;

        const rebuildShelf = () => {
          const occupied = new Set(
            grid.getAllCells().map((c) => cellKey(c.gx, c.gy))
          );
          const shelfContainer = buildShelfContainer(
            shelfTextures,
            occupied,
            metrics
          );
          edgeErrors = shelfContainer.edgeErrors;
          const gb = grid.getBounds();
          if (!gb) {
            shelfContainer.destroy({ children: true });
            if (bakedShelf) {
              worldContent.removeChild(bakedShelf);
              bakedShelf.texture?.destroy(true);
              bakedShelf.destroy();
              bakedShelf = null;
            }
            selectionOverlay.removeChildren();
            edgeErrors = 0;
            return;
          }
          const { sprite } = bakeShelf(
            app!.renderer,
            shelfContainer,
            gb.minGX,
            gb.minGY,
            metrics
          );
          shelfContainer.destroy({ children: true });

          if (bakedShelf) {
            worldContent.removeChild(bakedShelf);
            bakedShelf.texture?.destroy(true);
            bakedShelf.destroy();
          }
          worldContent.addChild(sprite);
          bakedShelf = sprite;
          // Ensure selectionOverlay is on top
          worldContent.removeChild(selectionOverlay);
          worldContent.addChild(selectionOverlay);
          // Update overlay with new bounds after rebuild
          updateSelection();
        };

        const handleAddCellFromMarker = (gx: number, gy: number) => {
          if (!app || cancelled) return;
          if (modeRef.current !== 'edit') return; // Only in edit mode
          selectedCellKey = null; // Deselect before add
          if (addCellAtRef.current?.(gx, gy)) {
            // updateSelection() is already called by addCellAtRef.current
          }
        };

        const handleRemoveCellFromMarker = (gx: number, gy: number) => {
          if (!app || cancelled) return;
          if (modeRef.current !== 'edit') return; // Only in edit mode
          // Find cell at this position
          let cellToRemove: { id: CellId; gx: number; gy: number } | null = null;
          for (const cell of grid.getAllCells()) {
            if (cell.gx === gx && cell.gy === gy) {
              cellToRemove = cell;
              break;
            }
          }
          if (cellToRemove) {
            if (selectedCellKey === cellToRemove.id) {
              selectedCellKey = null; // Deselect if removing selected cell
            }
            if (removeCellRef.current?.(cellToRemove.id)) {
              // updateSelection() is already called by removeCellRef.current
            }
          }
        };

        const updateSelection = () => {
          const gb = grid.getBounds();
          if (gb) {
            updateSelectionOverlay(
              selectionOverlay,
              selectedCellKey,
              grid,
              metrics,
              0,
              0,
              handleAddCellFromMarker,
              handleRemoveCellFromMarker
            );
          } else {
            selectionOverlay.removeChildren();
          }
        };

        const getGridCoordsFromPointer = (
          globalX: number,
          globalY: number
        ): { gx: number; gy: number } | null => {
          if (!bakedShelf) return null;
          const gb = grid.getBounds();
          if (!gb) return null;

          // Single source of truth: coords in shelf sprite space (same as bake)
          const globalPoint = new Point(globalX, globalY);
          const local = bakedShelf.toLocal(globalPoint);
          const gridOriginX = 0;
          const gridOriginY = 0;
          const gx = gb.minGX + Math.floor((local.x - gridOriginX) / metrics.CELL_W);
          const gy = gb.minGY + Math.floor((local.y - gridOriginY) / metrics.CELL_H);

          if (process.env.NODE_ENV === "development" && DEV_GRID_LOG) {
            console.log("[grid] tap", { localX: local.x, localY: local.y, gx, gy });
          }
          return { gx, gy };
        };

        rebuildShelf();
        if (cancelled || !app) return;
        if (containerRef.current !== container) return;

        const camera: CameraState = createInitialCamera();

        addCellAtRef.current = (gx: number, gy: number): boolean => {
          if (!app || cancelled) return false;
          if (!grid.addCellAt(gx, gy)) return false;
          const occupied = new Set(
            grid.getAllCells().map((c) => cellKey(c.gx, c.gy))
          );
          for (const c of grid.getAllCells()) {
            if (c.gx === gx && c.gy === gy) continue;
            const dx = Math.abs(c.gx - gx);
            const dy = Math.abs(c.gy - gy);
            if (dx + dy !== 1) continue;
            devAssertNeighborDirection(occupied, c.gx, c.gy, gx, gy);
          }
          rebuildShelf();
          updateSelection();
          return true;
        };

        getCellCountRef.current = (): number => grid.getCellCount();
        getCellsRef.current = (): Array<{ id: CellId; gx: number; gy: number }> =>
          grid.getAllCells();
        removeCellRef.current = (id: CellId): boolean => {
          if (!app || cancelled) return false;
          if (selectedCellKey === id) {
            selectedCellKey = null;
          }
          if (!grid.removeCell(id)) return false;
          rebuildShelf();
          updateSelection();
          return true;
        };
        clearRef.current = (): void => {
          if (!app || cancelled) return;
          selectedCellKey = null;
          grid.clear();
          rebuildShelf();
          updateSelection();
        };
        getEdgeErrorsRef.current = (): number => edgeErrors;

        const getCurrentBounds = (): ContentBounds | null => {
          const gridBounds = grid.getBounds();
          if (!gridBounds) return null;
          return getGridBounds(gridBounds, metrics.CELL_W, metrics.CELL_H);
        };

        // Helper to get center target from grid bounds
        const getGridCenterTarget = (): { cx: number; cy: number } => {
          const bounds = getCurrentBounds();
          if (!bounds) {
            // Fallback to single cell center if no cells
            return getSingleCellCenterTarget(CONTENT_BOUNDS);
          }
          return {
            cx: (bounds.minX + bounds.maxX) / 2,
            cy: (bounds.minY + bounds.maxY) / 2,
          };
        };

        resetCameraRef.current = () => {
          const centerTarget = getGridCenterTarget();
          camera.cx = centerTarget.cx;
          camera.cy = centerTarget.cy;
          camera.s = 1;
        };

        let lastDebugAt = 0;
        const springVelocity = { vx: 0, vy: 0 };
        const worldTransformOut = { x: 0, y: 0, scale: 1 };

        const onTick = (ticker: { deltaMS: number }) => {
          const sw = app!.screen.width;
          const sh = app!.screen.height;

          if (springBackActive && !isDragging) {
            const centerTarget = getGridCenterTarget();
            const dt = ticker.deltaMS / 1000;
            const done = advanceSpring(
              camera,
              springVelocity,
              centerTarget.cx,
              centerTarget.cy,
              dt
            );
            if (done) {
              camera.cx = centerTarget.cx;
              camera.cy = centerTarget.cy;
              springVelocity.vx = 0;
              springVelocity.vy = 0;
              springBackActive = false;
            }
          }

          getWorldTransformInto(camera, sw, sh, worldTransformOut);
          world.position.set(worldTransformOut.x, worldTransformOut.y);
          world.scale.set(worldTransformOut.scale);

          const now = Date.now();
          if (now - lastDebugAt >= DEBUG_THROTTLE_MS) {
            lastDebugAt = now;
            onCameraChangeRef.current?.({
              x: camera.cx,
              y: camera.cy,
              zoom: camera.s,
            });
            onCellCountChangeRef.current?.(grid.getCellCount());
          }
        };
        app.ticker.add(onTick);

        let isDragging = false;
        let lastScreenX = 0;
        let lastScreenY = 0;
        let pinchActive = false;
        let springBackActive = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let lastTapTime = 0;
        let lastTapPos = { x: 0, y: 0 };
        const DOUBLE_TAP_MS = 300;
        const DOUBLE_TAP_PX = 24;

        const onPointerDown = (e: FederatedPointerEvent) => {
          if (pinchActive) return;
          isDragging = true;
          lastScreenX = e.global.x;
          lastScreenY = e.global.y;
          dragStartX = e.global.x;
          dragStartY = e.global.y;
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
            getGridCenterTarget()
          );
        };
        const onPointerUp = (e: FederatedPointerEvent) => {
          if (isDragging) {
            const dragDist = Math.hypot(
              e.global.x - dragStartX,
              e.global.y - dragStartY
            );
            if (dragDist < 5) {
              const gridCoords = getGridCoordsFromPointer(e.global.x, e.global.y);
              const now = Date.now();
              const isDoubleTap =
                gridCoords &&
                now - lastTapTime <= DOUBLE_TAP_MS &&
                Math.hypot(
                  e.global.x - lastTapPos.x,
                  e.global.y - lastTapPos.y
                ) <= DOUBLE_TAP_PX;

              if (isDoubleTap && gridCoords) {
                e.stopPropagation();
                e.preventDefault?.();
                // Double tap toggle only works in edit mode
                if (modeRef.current === 'edit') {
                  if (grid.isOccupied(gridCoords.gx, gridCoords.gy)) {
                    let cellToRemove: { id: CellId; gx: number; gy: number } | null = null;
                    for (const cell of grid.getAllCells()) {
                      if (cell.gx === gridCoords.gx && cell.gy === gridCoords.gy) {
                        cellToRemove = cell;
                        break;
                      }
                    }
                    if (cellToRemove && removeCellRef.current) {
                      removeCellRef.current(cellToRemove.id);
                    }
                  } else if (addCellAtRef.current) {
                    addCellAtRef.current(gridCoords.gx, gridCoords.gy);
                  }
                }
              } else if (gridCoords) {
                const gb = grid.getBounds();
                const inBounds =
                  gb &&
                  gridCoords.gx >= gb.minGX &&
                  gridCoords.gx <= gb.maxGX &&
                  gridCoords.gy >= gb.minGY &&
                  gridCoords.gy <= gb.maxGY &&
                  grid.isOccupied(gridCoords.gx, gridCoords.gy);
                if (inBounds) {
                  let clickedCell: { id: CellId; gx: number; gy: number } | null = null;
                  for (const cell of grid.getAllCells()) {
                    if (cell.gx === gridCoords.gx && cell.gy === gridCoords.gy) {
                      clickedCell = cell;
                      break;
                    }
                  }
                  if (clickedCell) {
                    if (selectedCellKey === clickedCell.id) {
                      selectedCellKey = null;
                    } else {
                      selectedCellKey = clickedCell.id;
                    }
                    updateSelection();
                  }
                }
              }
              lastTapTime = now;
              lastTapPos = { x: e.global.x, y: e.global.y };
            }
          }
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

        const onKeyDown = (e: KeyboardEvent) => {
          if (!selectedCellKey) return; // Ignore if no selection

          const selectedCell = grid.getCell(selectedCellKey);
          if (!selectedCell) return;

          let targetGX = selectedCell.gx;
          let targetGY = selectedCell.gy;

          if (e.key === "ArrowUp") {
            targetGY -= 1;
          } else if (e.key === "ArrowDown") {
            targetGY += 1;
          } else if (e.key === "ArrowLeft") {
            targetGX -= 1;
          } else if (e.key === "ArrowRight") {
            targetGX += 1;
          } else if (e.key === "Escape") {
            selectedCellKey = null;
            updateSelection();
            return;
          } else {
            return; // Ignore other keys
          }

          e.preventDefault(); // Prevent browser scroll

          // Arrow key add/remove only works in edit mode
          if (modeRef.current === 'edit') {
            // Toggle: if neighbor exists -> remove, if not -> add
            if (grid.isOccupied(targetGX, targetGY)) {
              // Find cell ID for removal
              let cellToRemove: { id: CellId; gx: number; gy: number } | null =
                null;
              for (const cell of grid.getAllCells()) {
                if (cell.gx === targetGX && cell.gy === targetGY) {
                  cellToRemove = cell;
                  break;
                }
              }
              if (cellToRemove && removeCellRef.current) {
                removeCellRef.current(cellToRemove.id);
              }
            } else {
              // Add new cell
              if (addCellAtRef.current) {
                addCellAtRef.current(targetGX, targetGY);
              }
            }
          }
        };
        window.addEventListener("keydown", onKeyDown);

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
          window.removeEventListener("keydown", onKeyDown);
          if (bakedShelf) {
            worldContent.removeChild(bakedShelf);
            bakedShelf.texture?.destroy(true);
            bakedShelf.destroy();
            bakedShelf = null;
          }
          selectionOverlay.removeChildren();
        };
      })();

      return () => {
        cancelled = true;
        initOnceRef.current = false;
        resetCameraRef.current = null;
        addCellAtRef.current = null;
        getCellCountRef.current = null;
        getCellsRef.current = null;
        removeCellRef.current = null;
        clearRef.current = null;
        getEdgeErrorsRef.current = null;
        teardown?.();
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

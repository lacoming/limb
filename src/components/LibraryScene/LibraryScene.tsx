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
  onCameraChange?: (data: {
    x: number;
    y: number;
    zoom: number;
  }) => void;
  onCellCountChange?: (count: number) => void;
}

export const LibraryScene = forwardRef<LibrarySceneRef, LibrarySceneProps>(
  function LibraryScene({ onCameraChange, onCellCountChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const onCameraChangeRef = useRef(onCameraChange);
    const onCellCountChangeRef = useRef(onCellCountChange);
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
          selectedCellKey = null; // Deselect before add
          if (addCellAtRef.current?.(gx, gy)) {
            // updateSelection() is already called by addCellAtRef.current
          }
        };

        const handleRemoveCellFromMarker = (gx: number, gy: number) => {
          if (!app || cancelled) return;
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
              gb.minGX,
              gb.minGY,
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

          // Convert global (stage) coordinates to worldContent local coordinates
          const globalPoint = new Point(globalX, globalY);
          const worldPoint = worldContent.toLocal(globalPoint);

          // Get shelf sprite position (in worldContent coordinates)
          const shelfX = bakedShelf.x;
          const shelfY = bakedShelf.y;

          // Calculate grid coordinates relative to shelf origin
          const localX = worldPoint.x - shelfX;
          const localY = worldPoint.y - shelfY;

          const gx = Math.floor(localX / metrics.CELL_W);
          const gy = Math.floor(localY / metrics.CELL_H);

          // Check if point is within shelf bounds
          const gb = grid.getBounds();
          if (!gb) return null;

          // Adjust for minGX/minGY offset (shelf sprite is positioned at minGX*CELL_W, minGY*CELL_H)
          const adjustedGX = gx + gb.minGX;
          const adjustedGY = gy + gb.minGY;

          // Verify the cell exists in the grid bounds
          if (
            adjustedGX < gb.minGX ||
            adjustedGX > gb.maxGX ||
            adjustedGY < gb.minGY ||
            adjustedGY > gb.maxGY
          ) {
            return null;
          }

          return { gx: adjustedGX, gy: adjustedGY };
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
            // Check if this was a tap (not a drag)
            const dragDist = Math.hypot(
              e.global.x - dragStartX,
              e.global.y - dragStartY
            );
            if (dragDist < 5) {
              // It's a tap, handle cell selection
              const gridCoords = getGridCoordsFromPointer(e.global.x, e.global.y);
              if (gridCoords) {
                // Find clicked cell by checking all cells
                let clickedCell: { id: CellId; gx: number; gy: number } | null = null;
                for (const cell of grid.getAllCells()) {
                  if (cell.gx === gridCoords.gx && cell.gy === gridCoords.gy) {
                    clickedCell = cell;
                    break;
                  }
                }

                if (clickedCell) {
                  // Clicked on occupied cell
                  if (selectedCellKey === clickedCell.id) {
                    // Deselect
                    selectedCellKey = null;
                  } else {
                    // Select
                    selectedCellKey = clickedCell.id;
                  }
                  // Update overlay
                  updateSelection();
                }
              }
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

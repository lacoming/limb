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
import {
  cellKey,
  devAssertNeighborDirection,
  isConnected,
  parseCellKey,
} from "../../lib/cellKeys";
import {
  LibraryGrid,
  type CellId,
} from "../../lib/libraryGrid";
import { preloadShelfAssets } from "../../lib/shelfAssets";
import { computeShelfMetrics } from "../../lib/shelfMetrics";
import { buildShelfContainer } from "../../lib/shelfComposer";
import { bakeShelf } from "../../lib/shelfBake";
import { updateSelectionOverlay, type MarqueeRect } from "./cellSelection";
import { renderBooksLayer } from "./booksLayer";
import type { UserCopyWithEdition } from "../../lib/books/types";

const DEBUG_THROTTLE_MS = 250;
const BG = 0x1a1a1a;
const DEV_GRID_LOG = false;
const MAX_HISTORY = 100;
const DELETE_CONFIRM_THRESHOLD = 20;

type HistoryAction = {
  type: "add" | "remove" | "batch" | "clear";
  before: Set<string>;
  after: Set<string>;
  meta?: string;
};

export interface LibrarySceneRef {
  resetCamera: () => void;
  addCellAt: (gx: number, gy: number) => boolean;
  getCellCount: () => number;
  getCells: () => Array<{ id: CellId; gx: number; gy: number }>;
  removeCell: (id: CellId) => boolean;
  removeSelectedCells: () => void;
  clear: () => void;
  getEdgeErrors: () => number;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export interface LibrarySceneProps {
  mode?: "edit" | "view";
  safeDeleteEnabled?: boolean;
  onCameraChange?: (data: {
    x: number;
    y: number;
    zoom: number;
  }) => void;
  onCellCountChange?: (count: number) => void;
  onMultiSelectionChange?: (count: number) => void;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
  onDeleteBlocked?: (reason: string) => void;
  onRequestDelete?: (n: number, perform: () => void) => void;
  demoBooksVisible?: boolean;
  demoBooksData?: UserCopyWithEdition[];
}

export const LibraryScene = forwardRef<LibrarySceneRef, LibrarySceneProps>(
  function LibraryScene(
    {
      mode = "edit",
      safeDeleteEnabled = true,
      onCameraChange,
      onCellCountChange,
      onMultiSelectionChange,
      onHistoryChange,
      onDeleteBlocked,
      onRequestDelete,
      demoBooksVisible = false,
      demoBooksData = [],
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const modeRef = useRef(mode);
    const safeDeleteEnabledRef = useRef(safeDeleteEnabled);
    const onCameraChangeRef = useRef(onCameraChange);
    const onCellCountChangeRef = useRef(onCellCountChange);
    const onMultiSelectionChangeRef = useRef(onMultiSelectionChange);
    const onHistoryChangeRef = useRef(onHistoryChange);
    const onDeleteBlockedRef = useRef(onDeleteBlocked);
    const onRequestDeleteRef = useRef(onRequestDelete);
    useEffect(() => {
      modeRef.current = mode;
    }, [mode]);
    useEffect(() => {
      safeDeleteEnabledRef.current = safeDeleteEnabled;
    }, [safeDeleteEnabled]);
    useEffect(() => {
      updateBooksRef.current?.(demoBooksVisible, demoBooksData);
    }, [demoBooksVisible, demoBooksData]);

    useEffect(() => {
      onCameraChangeRef.current = onCameraChange;
      onCellCountChangeRef.current = onCellCountChange;
      onMultiSelectionChangeRef.current = onMultiSelectionChange;
      onHistoryChangeRef.current = onHistoryChange;
      onDeleteBlockedRef.current = onDeleteBlocked;
      onRequestDeleteRef.current = onRequestDelete;
    }, [onCameraChange, onCellCountChange, onMultiSelectionChange, onHistoryChange, onDeleteBlocked, onRequestDelete]);

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
        removeSelectedCells() {
          removeSelectedCellsRef.current?.();
        },
        clear() {
          clearRef.current?.();
        },
        getEdgeErrors() {
          return getEdgeErrorsRef.current?.() ?? 0;
        },
        undo() {
          undoRef.current?.();
        },
        redo() {
          redoRef.current?.();
        },
        canUndo() {
          return canUndoRef.current?.() ?? false;
        },
        canRedo() {
          return canRedoRef.current?.() ?? false;
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
    const removeSelectedCellsRef = useRef<(() => void) | null>(null);
    const clearRef = useRef<(() => void) | null>(null);
    const getEdgeErrorsRef = useRef<(() => number) | null>(null);
    const undoRef = useRef<(() => void) | null>(null);
    const redoRef = useRef<(() => void) | null>(null);
    const canUndoRef = useRef<() => boolean>(() => false);
    const canRedoRef = useRef<() => boolean>(() => false);
    const initOnceRef = useRef(false);
    const updateBooksRef = useRef<
      ((visible: boolean, data: UserCopyWithEdition[]) => void) | null
    >(null);

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
        const multiSelectedCells = new Set<string>();
        let isMarqueeDragging = false;
        const marqueeStartLocal = { x: 0, y: 0 };
        const marqueeEndLocal = { x: 0, y: 0 };
        const selectionOverlay = new Container();
        worldContent.addChild(selectionOverlay);
        const booksLayer = new Container();

        const ensureLayerOrder = () => {
          if (!bakedShelf?.parent) return;
          const order = [bakedShelf, booksLayer, selectionOverlay];
          for (let i = 0; i < order.length; i++) {
            const c = order[i];
            if (c.parent !== worldContent) continue;
            const idx = worldContent.getChildIndex(c);
            if (idx !== i) worldContent.setChildIndex(c, i);
          }
        };

        const notifyMultiSelectionChange = () => {
          onMultiSelectionChangeRef.current?.(multiSelectedCells.size);
        };

        const undoStack: HistoryAction[] = [];
        let redoStack: HistoryAction[] = [];

        const getOccupiedKeys = (): Set<string> =>
          new Set(grid.getAllCells().map((c) => cellKey(c.gx, c.gy)));

        const notifyHistoryChange = () => {
          onHistoryChangeRef.current?.(
            undoStack.length > 0,
            redoStack.length > 0
          );
        };

        const pushHistory = (
          before: Set<string>,
          after: Set<string>,
          type: HistoryAction["type"],
          meta?: string
        ) => {
          if (
            before.size === after.size &&
            [...before].every((k) => after.has(k))
          )
            return;
          redoStack = [];
          undoStack.push({
            type,
            before: new Set(before),
            after: new Set(after),
            meta,
          });
          if (undoStack.length > MAX_HISTORY) undoStack.shift();
          notifyHistoryChange();
        };

        const commitOccupancy = (
          next: Set<string>,
          type: HistoryAction["type"],
          meta?: string
        ) => {
          const before = getOccupiedKeys();
          grid.setFromCellKeys(next);
          pushHistory(before, next, type, meta);
          rebuildShelf();
          updateSelection();
          sanitizeSelection();
        };

        const canApplyDeletion = (nextOccupied: Set<string>): boolean => {
          if (!safeDeleteEnabledRef.current) return true;
          if (nextOccupied.size === 0) return true;
          return isConnected(nextOccupied);
        };

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
          if (!booksLayer.parent) worldContent.addChild(booksLayer);
          worldContent.removeChild(selectionOverlay);
          worldContent.addChild(selectionOverlay);
          // Update overlay with new bounds after rebuild
          updateSelection();
          ensureLayerOrder();
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
            let marqueeRect: MarqueeRect | null = null;
            if (isMarqueeDragging) {
              const minX = Math.min(marqueeStartLocal.x, marqueeEndLocal.x);
              const minY = Math.min(marqueeStartLocal.y, marqueeEndLocal.y);
              const maxX = Math.max(marqueeStartLocal.x, marqueeEndLocal.x);
              const maxY = Math.max(marqueeStartLocal.y, marqueeEndLocal.y);
              marqueeRect = { minX, minY, maxX, maxY };
            }
            updateSelectionOverlay(
              selectionOverlay,
              selectedCellKey,
              grid,
              metrics,
              0,
              0,
              handleAddCellFromMarker,
              handleRemoveCellFromMarker,
              multiSelectedCells,
              marqueeRect
            );
          } else {
            selectionOverlay.removeChildren();
          }
        };

        const sanitizeSelection = () => {
          if (selectedCellKey && !grid.getCell(selectedCellKey)) {
            selectedCellKey = null;
          }
          for (const key of Array.from(multiSelectedCells)) {
            const { gx, gy } = parseCellKey(key);
            if (!grid.isOccupied(gx, gy)) {
              multiSelectedCells.delete(key);
            }
          }
          notifyMultiSelectionChange();
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

        updateBooksRef.current = (visible: boolean, data: UserCopyWithEdition[]) => {
          booksLayer.removeChildren();
          if (visible && data.length > 0) {
            renderBooksLayer(booksLayer, metrics, data, 0, 0);
          }
          ensureLayerOrder();
        };
        updateBooksRef.current(demoBooksVisible, demoBooksData);

        const camera: CameraState = createInitialCamera();

        addCellAtRef.current = (gx: number, gy: number): boolean => {
          if (!app || cancelled) return false;
          const next = new Set(getOccupiedKeys());
          const key = cellKey(gx, gy);
          if (next.has(key)) return false;
          next.add(key);
          for (const c of grid.getAllCells()) {
            if (c.gx === gx && c.gy === gy) continue;
            const dx = Math.abs(c.gx - gx);
            const dy = Math.abs(c.gy - gy);
            if (dx + dy !== 1) continue;
            devAssertNeighborDirection(next, c.gx, c.gy, gx, gy);
          }
          commitOccupancy(next, "add");
          return true;
        };

        getCellCountRef.current = (): number => grid.getCellCount();
        getCellsRef.current = (): Array<{ id: CellId; gx: number; gy: number }> =>
          grid.getAllCells();
        removeCellRef.current = (id: CellId): boolean => {
          if (!app || cancelled || modeRef.current !== "edit") return false;
          const cell = grid.getCell(id);
          if (!cell) return false;
          if (selectedCellKey === id) selectedCellKey = null;
          const next = new Set(getOccupiedKeys());
          next.delete(cellKey(cell.gx, cell.gy));
          if (!canApplyDeletion(next)) {
            onDeleteBlockedRef.current?.("Delete blocked: would split structure");
            return false;
          }
          commitOccupancy(next, "remove");
          return true;
        };
        removeSelectedCellsRef.current = (): void => {
          if (!app || cancelled || modeRef.current !== "edit") return;
          const performBatch = (
            next: Set<string>,
            n: number,
            type: "batch" | "remove",
            meta: string | undefined,
            clearSelection: () => void
          ) => {
            const doCommit = () => {
              clearSelection();
              commitOccupancy(next, type, meta);
              notifyMultiSelectionChange();
            };
            if (n > DELETE_CONFIRM_THRESHOLD && onRequestDeleteRef.current) {
              onRequestDeleteRef.current(n, doCommit);
            } else {
              doCommit();
            }
          };
          if (multiSelectedCells.size > 0) {
            const idsToRemove: CellId[] = [];
            for (const cell of grid.getAllCells()) {
              if (multiSelectedCells.has(cellKey(cell.gx, cell.gy))) {
                idsToRemove.push(cell.id);
              }
            }
            const next = new Set(getOccupiedKeys());
            for (const id of idsToRemove) {
              const c = grid.getCell(id);
              if (c) next.delete(cellKey(c.gx, c.gy));
            }
            if (!canApplyDeletion(next)) {
              onDeleteBlockedRef.current?.("Delete blocked: would split structure");
              return;
            }
            performBatch(
              next,
              idsToRemove.length,
              "batch",
              idsToRemove.length > 0
                ? `Removed ${idsToRemove.length} cells`
                : undefined,
              () => {
                if (selectedCellKey && idsToRemove.includes(selectedCellKey)) {
                  selectedCellKey = null;
                }
                multiSelectedCells.clear();
              }
            );
          } else if (selectedCellKey) {
            const cell = grid.getCell(selectedCellKey);
            if (cell) {
              const next = new Set(getOccupiedKeys());
              next.delete(cellKey(cell.gx, cell.gy));
              if (!canApplyDeletion(next)) {
                onDeleteBlockedRef.current?.("Delete blocked: would split structure");
                return;
              }
              performBatch(next, 1, "remove", undefined, () => {
                selectedCellKey = null;
              });
            }
          }
        };
        clearRef.current = (): void => {
          if (!app || cancelled || modeRef.current !== "edit") return;
          const n = getOccupiedKeys().size;
          const doClear = () => {
            selectedCellKey = null;
            multiSelectedCells.clear();
            commitOccupancy(new Set(), "clear");
            notifyMultiSelectionChange();
          };
          if (n > DELETE_CONFIRM_THRESHOLD && onRequestDeleteRef.current) {
            onRequestDeleteRef.current(n, doClear);
          } else {
            doClear();
          }
        };

        const undo = (): void => {
          if (modeRef.current !== "edit" || undoStack.length === 0) return;
          const action = undoStack.pop()!;
          redoStack.push(action);
          grid.setFromCellKeys(new Set(action.before));
          rebuildShelf();
          updateSelection();
          sanitizeSelection();
          notifyHistoryChange();
        };

        const redo = (): void => {
          if (modeRef.current !== "edit" || redoStack.length === 0) return;
          const action = redoStack.pop()!;
          undoStack.push(action);
          grid.setFromCellKeys(new Set(action.after));
          rebuildShelf();
          updateSelection();
          sanitizeSelection();
          notifyHistoryChange();
        };

        undoRef.current = undo;
        redoRef.current = redo;
        canUndoRef.current = () => undoStack.length > 0;
        canRedoRef.current = () => redoStack.length > 0;
        notifyHistoryChange();

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

        const getLocalFromPointer = (globalX: number, globalY: number) => {
          const p = selectionOverlay.toLocal(new Point(globalX, globalY));
          return { x: p.x, y: p.y };
        };

        const onPointerDown = (e: FederatedPointerEvent) => {
          if (pinchActive) return;
          lastScreenX = e.global.x;
          lastScreenY = e.global.y;
          dragStartX = e.global.x;
          dragStartY = e.global.y;

          if (e.pointerType === "mouse") {
            const gridCoords = getGridCoordsFromPointer(e.global.x, e.global.y);
            const gb = grid.getBounds();
            const hasCell =
              gb &&
              gridCoords &&
              gridCoords.gx >= gb.minGX &&
              gridCoords.gx <= gb.maxGX &&
              gridCoords.gy >= gb.minGY &&
              gridCoords.gy <= gb.maxGY &&
              grid.isOccupied(gridCoords.gx, gridCoords.gy);

            if (!hasCell) {
              isMarqueeDragging = true;
              isDragging = false;
              const local = getLocalFromPointer(e.global.x, e.global.y);
              marqueeStartLocal.x = local.x;
              marqueeStartLocal.y = local.y;
              marqueeEndLocal.x = local.x;
              marqueeEndLocal.y = local.y;
              updateSelection();
              return;
            }
          }
          isDragging = true;
        };
        const onGlobalMove = (e: FederatedPointerEvent) => {
          if (pinchActive) return;
          if (isMarqueeDragging) {
            const local = getLocalFromPointer(e.global.x, e.global.y);
            marqueeEndLocal.x = local.x;
            marqueeEndLocal.y = local.y;
            updateSelection();
            return;
          }
          if (!isDragging) return;
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
          if (isMarqueeDragging) {
            const minX = Math.min(marqueeStartLocal.x, marqueeEndLocal.x);
            const minY = Math.min(marqueeStartLocal.y, marqueeEndLocal.y);
            const maxX = Math.max(marqueeStartLocal.x, marqueeEndLocal.x);
            const maxY = Math.max(marqueeStartLocal.y, marqueeEndLocal.y);
            const gb = grid.getBounds();
            if (gb) {
              const gxMin = Math.max(
                gb.minGX,
                Math.floor(minX / metrics.CELL_W)
              );
              const gxMax = Math.min(
                gb.maxGX,
                Math.ceil(maxX / metrics.CELL_W) - 1
              );
              const gyMin = Math.max(
                gb.minGY,
                Math.floor(minY / metrics.CELL_H)
              );
              const gyMax = Math.min(
                gb.maxGY,
                Math.ceil(maxY / metrics.CELL_H) - 1
              );
              for (let gx = gxMin; gx <= gxMax; gx++) {
                for (let gy = gyMin; gy <= gyMax; gy++) {
                  if (grid.isOccupied(gx, gy)) {
                    multiSelectedCells.add(cellKey(gx, gy));
                  }
                }
              }
            }
            isMarqueeDragging = false;
            updateSelection();
            notifyMultiSelectionChange();
            isDragging = false;
            springBackActive = true;
            return;
          }

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
                if (modeRef.current === "edit") {
                  if (grid.isOccupied(gridCoords.gx, gridCoords.gy)) {
                    let cellToRemove: {
                      id: CellId;
                      gx: number;
                      gy: number;
                    } | null = null;
                    for (const cell of grid.getAllCells()) {
                      if (
                        cell.gx === gridCoords.gx &&
                        cell.gy === gridCoords.gy
                      ) {
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
                  let clickedCell: {
                    id: CellId;
                    gx: number;
                    gy: number;
                  } | null = null;
                  for (const cell of grid.getAllCells()) {
                    if (
                      cell.gx === gridCoords.gx &&
                      cell.gy === gridCoords.gy
                    ) {
                      clickedCell = cell;
                      break;
                    }
                  }
                  if (clickedCell) {
                    const key = cellKey(clickedCell.gx, clickedCell.gy);
                    if (e.shiftKey) {
                      if (multiSelectedCells.has(key)) {
                        multiSelectedCells.delete(key);
                      } else {
                        multiSelectedCells.add(key);
                      }
                      selectedCellKey = clickedCell.id;
                      notifyMultiSelectionChange();
                    } else {
                      multiSelectedCells.clear();
                      if (selectedCellKey === clickedCell.id) {
                        selectedCellKey = null;
                      } else {
                        selectedCellKey = clickedCell.id;
                      }
                      notifyMultiSelectionChange();
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
          if (e.key === "Escape") {
            e.preventDefault();
            if (isMarqueeDragging) {
              isMarqueeDragging = false;
              updateSelection();
              return;
            }
            if (multiSelectedCells.size > 0) {
              multiSelectedCells.clear();
              updateSelection();
              notifyMultiSelectionChange();
              return;
            }
            selectedCellKey = null;
            updateSelection();
            return;
          }

          if (modeRef.current === "edit") {
            if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
              undo();
              e.preventDefault();
              return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
              redo();
              e.preventDefault();
              return;
            }
            if (e.ctrlKey && e.key === "y") {
              redo();
              e.preventDefault();
              return;
            }
          }

          if (e.key === "Delete" || e.key === "Backspace") {
            if (modeRef.current !== "edit") return;
            e.preventDefault();
            removeSelectedCellsRef.current?.();
            return;
          }

          if (!selectedCellKey) return;
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
          } else {
            return;
          }

          e.preventDefault();

          if (modeRef.current === "edit") {
            if (grid.isOccupied(targetGX, targetGY)) {
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
            } else if (addCellAtRef.current) {
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
          booksLayer.removeChildren();
          selectionOverlay.removeChildren();
        };
      })();

      return () => {
        cancelled = true;
        initOnceRef.current = false;
        updateBooksRef.current = null;
        resetCameraRef.current = null;
        addCellAtRef.current = null;
        getCellCountRef.current = null;
        getCellsRef.current = null;
        removeCellRef.current = null;
        removeSelectedCellsRef.current = null;
        clearRef.current = null;
        getEdgeErrorsRef.current = null;
        undoRef.current = null;
        redoRef.current = null;
        canUndoRef.current = () => false;
        canRedoRef.current = () => false;
        teardown?.();
        app?.destroy({ removeView: true }, { children: true });
        app = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- init runs once; demo books sync via separate effect
    }, []);

    return (
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", position: "relative" }}
      />
    );
  }
);

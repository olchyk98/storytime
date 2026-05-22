import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Copy,
  Download,
  Expand,
  Maximize,
  Pencil,
  Plus,
  Workflow,
} from "lucide-react";
import { useStore } from "../../state/store";
import { downloadBackup } from "../../lib/downloadBackup";
import type { BoardAnnotationNode, BoardGroupNode } from "../../types";
import { BeatEditor } from "./BeatEditor";
import { clipsMatchingGroup, sortClips } from "../../lib/beatFilter";
import {
  BEAT_HEIGHT,
  beatWidthFor,
  snapToGrid,
} from "../../lib/beatLayout";
import { BeatsToolbar } from "./BeatsToolbar";
import { AnnotationCard } from "./AnnotationCard";

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;

interface BeatLayout {
  beat: BoardGroupNode;
  x: number;
  y: number;
  width: number;
  index: number;
}

interface PendingConnection {
  sourceId: string;
  worldX: number;
  worldY: number;
  hoverTargetId: string | null;
}

function hitTestLayout(
  layout: BeatLayout[],
  worldX: number,
  worldY: number
): string | null {
  for (const l of layout) {
    if (
      worldX >= l.x &&
      worldX <= l.x + l.width &&
      worldY >= l.y &&
      worldY <= l.y + BEAT_HEIGHT
    ) {
      return l.beat.id;
    }
  }
  return null;
}

function clientToWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  panX: number,
  panY: number,
  zoom: number
) {
  return {
    x: (clientX - rect.left - panX) / zoom,
    y: (clientY - rect.top - panY) / zoom,
  };
}

export function Board() {
  const {
    currentBoardId,
    boards,
    boardNodes,
    levels,
    levelValues,
    setBoardViewport,
    ensureBoard,
    undoBoard,
    redoBoard,
    boardTool,
    setBoardTool,
    createAnnotation,
    boardSelectedIds,
    deleteBoardNodes,
    clearBoardSelection,
  } = useStore();

  const board = currentBoardId ? boards[currentBoardId] : null;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [editingBeatId, setEditingBeatId] = useState<string | null>(null);
  const [creatingBeat, setCreatingBeat] = useState<
    null | { x: number; y: number }
  >(null);
  const [pendingConn, setPendingConn] = useState<PendingConnection | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    function update() {
      const r = surfaceRef.current?.getBoundingClientRect();
      if (r) setViewportSize({ w: r.width, h: r.height });
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!currentBoardId) ensureBoard();
  }, [currentBoardId, ensureBoard]);

  function fitContent() {
    if (!board) return;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Bounding box of beats + annotations
    const all: { x: number; y: number; w: number; h: number }[] = [];
    for (const l of layout)
      all.push({ x: l.x, y: l.y, w: l.width, h: BEAT_HEIGHT });
    for (const a of annotations)
      all.push({ x: a.x, y: a.y, w: a.w, h: a.h });
    if (all.length === 0) {
      setBoardViewport(board.id, 0, 0, 1);
      return;
    }
    const minX = Math.min(...all.map((b) => b.x));
    const minY = Math.min(...all.map((b) => b.y));
    const maxX = Math.max(...all.map((b) => b.x + b.w));
    const maxY = Math.max(...all.map((b) => b.y + b.h));
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const PAD = 80;
    const zoomX = (rect.width - PAD * 2) / contentW;
    const zoomY = (rect.height - PAD * 2) / contentH;
    const zoom = Math.max(0.2, Math.min(1.5, Math.min(zoomX, zoomY)));
    const panX = (rect.width - contentW * zoom) / 2 - minX * zoom;
    const panY = (rect.height - contentH * zoom) / 2 - minY * zoom;
    setBoardViewport(board.id, panX, panY, zoom);
  }

  function startCreatingBeat() {
    if (!board) {
      setCreatingBeat({ x: 0, y: 0 });
      return;
    }
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) {
      setCreatingBeat({ x: 0, y: 0 });
      return;
    }
    // Center of the visible viewport in world coords
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const worldX = (cx - board.panX) / board.zoom;
    const worldY = (cy - board.panY) / board.zoom;
    setCreatingBeat({
      x: snapToGrid(worldX - 140),
      y: snapToGrid(worldY - BEAT_HEIGHT / 2),
    });
  }

  const beats = useMemo(() => {
    if (!board) return [] as BoardGroupNode[];
    return Object.values(boardNodes).filter(
      (n): n is BoardGroupNode =>
        n.boardId === board.id && n.kind === "group"
    );
  }, [boardNodes, board]);

  const annotations = useMemo(() => {
    if (!board) return [] as BoardAnnotationNode[];
    return Object.values(boardNodes).filter(
      (n): n is BoardAnnotationNode =>
        n.boardId === board.id && n.kind === "annotation"
    );
  }, [boardNodes, board]);

  const [draftAnnotation, setDraftAnnotation] = useState<
    | null
    | { x: number; y: number; w: number; h: number }
  >(null);

  const clips = useStore((s) => s.clips);
  const layout: BeatLayout[] = useMemo(
    () => buildLayout(beats, levels, levelValues, clips),
    [beats, levels, levelValues, clips]
  );

  const layoutById = useMemo(() => {
    const m = new Map<string, BeatLayout>();
    for (const l of layout) m.set(l.beat.id, l);
    return m;
  }, [layout]);

  // Viewport culling: only render beats / annotations that intersect the
  // visible area (with margin so small pans don't cause pop-in).
  const visibleLayout = useMemo(() => {
    if (!board || viewportSize.w === 0) return layout;
    const margin = 800 / board.zoom;
    const left = -board.panX / board.zoom - margin;
    const top = -board.panY / board.zoom - margin;
    const right = (viewportSize.w - board.panX) / board.zoom + margin;
    const bottom = (viewportSize.h - board.panY) / board.zoom + margin;
    return layout.filter(
      (l) =>
        l.x + l.width >= left &&
        l.x <= right &&
        l.y + BEAT_HEIGHT >= top &&
        l.y <= bottom
    );
  }, [
    layout,
    board?.panX,
    board?.panY,
    board?.zoom,
    viewportSize.w,
    viewportSize.h,
  ]);

  const visibleAnnotations = useMemo(() => {
    if (!board || viewportSize.w === 0) return annotations;
    const margin = 800 / board.zoom;
    const left = -board.panX / board.zoom - margin;
    const top = -board.panY / board.zoom - margin;
    const right = (viewportSize.w - board.panX) / board.zoom + margin;
    const bottom = (viewportSize.h - board.panY) / board.zoom + margin;
    return annotations.filter(
      (a) =>
        a.x + a.w >= left &&
        a.x <= right &&
        a.y + a.h >= top &&
        a.y <= bottom
    );
  }, [
    annotations,
    board?.panX,
    board?.panY,
    board?.zoom,
    viewportSize.w,
    viewportSize.h,
  ]);

  // Keyboard
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redoBoard();
        else undoBoard();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redoBoard();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        startCreatingBeat();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        fitContent();
      } else if (e.key === "v" || e.key === "V") {
        setBoardTool("select");
      } else if (e.key === "a" || e.key === "A") {
        setBoardTool("annotation");
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        boardSelectedIds.size > 0
      ) {
        // Allow deleting annotation/other selected non-beat nodes via keyboard.
        e.preventDefault();
        deleteBoardNodes([...boardSelectedIds]);
      } else if (e.key === "Escape") {
        setPendingConn(null);
        setSelectedEdge(null);
        setDraftAnnotation(null);
        setBoardTool("select");
        clearBoardSelection();
      }
    }
    function up(e: KeyboardEvent) {
      if (e.code === "Space") setSpaceHeld(false);
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [
    undoBoard,
    redoBoard,
    setBoardTool,
    boardSelectedIds,
    deleteBoardNodes,
    clearBoardSelection,
  ]);

  // Wheel: pan; ctrl/meta+wheel: zoom
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || !board) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const oldZoom = board.zoom;
        const factor = Math.exp(-e.deltaY * 0.005);
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const newPanX = cursorX - (cursorX - board.panX) * (newZoom / oldZoom);
        const newPanY = cursorY - (cursorY - board.panY) * (newZoom / oldZoom);
        setBoardViewport(board.id, newPanX, newPanY, newZoom);
      } else {
        setBoardViewport(
          board.id,
          board.panX - e.deltaX,
          board.panY - e.deltaY,
          board.zoom
        );
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [board, setBoardViewport]);

  function onSurfaceMouseDown(e: React.MouseEvent) {
    if (!board) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.dataset.boardSurface) return;
    setSelectedEdge(null);

    const rect = surfaceRef.current!.getBoundingClientRect();

    // Annotation tool: drag to draw a labeled bordered region.
    if (boardTool === "annotation") {
      const start = clientToWorld(
        e.clientX,
        e.clientY,
        rect,
        board.panX,
        board.panY,
        board.zoom
      );
      let cur = { x: start.x, y: start.y, w: 0, h: 0 };
      setDraftAnnotation(cur);
      const onMove = (ev: PointerEvent) => {
        const pt = clientToWorld(
          ev.clientX,
          ev.clientY,
          rect,
          board.panX,
          board.panY,
          board.zoom
        );
        cur = {
          x: Math.min(start.x, pt.x),
          y: Math.min(start.y, pt.y),
          w: Math.abs(pt.x - start.x),
          h: Math.abs(pt.y - start.y),
        };
        setDraftAnnotation(cur);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const w = Math.max(160, snapToGrid(cur.w));
        const h = Math.max(100, snapToGrid(cur.h));
        createAnnotation(
          board.id,
          snapToGrid(cur.x),
          snapToGrid(cur.y),
          w,
          h
        );
        setDraftAnnotation(null);
        setBoardTool("select");
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }

    // Default: pan the canvas.
    const startPanX = board.panX;
    const startPanY = board.panY;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      setBoardViewport(board.id, startPanX + dx, startPanY + dy, board.zoom);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }


  // Pack closure-captured state into refs so the connect handler stays
  // identity-stable for React.memo on BeatCard.
  const boardRef = useRef(board);
  boardRef.current = board;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const onConnectStart = useCallback(function onConnectStart(
    e: React.PointerEvent,
    sourceBeatId: string
  ) {
    const board = boardRef.current;
    if (!board) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    const rect = surfaceRef.current!.getBoundingClientRect();
    const initial = clientToWorld(
      e.clientX,
      e.clientY,
      rect,
      board.panX,
      board.panY,
      board.zoom
    );
    setPendingConn({
      sourceId: sourceBeatId,
      worldX: initial.x,
      worldY: initial.y,
      hoverTargetId: null,
    });

    const onMove = (ev: PointerEvent) => {
      const b = boardRef.current;
      if (!b) return;
      const pt = clientToWorld(
        ev.clientX,
        ev.clientY,
        rect,
        b.panX,
        b.panY,
        b.zoom
      );
      const hover = hitTestLayout(layoutRef.current, pt.x, pt.y);
      setPendingConn((prev) =>
        prev
          ? {
              ...prev,
              worldX: pt.x,
              worldY: pt.y,
              hoverTargetId:
                hover && hover !== sourceBeatId ? hover : null,
            }
          : null
      );
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const b = boardRef.current;
      if (!b) return;
      const pt = clientToWorld(
        ev.clientX,
        ev.clientY,
        rect,
        b.panX,
        b.panY,
        b.zoom
      );
      const target = hitTestLayout(layoutRef.current, pt.x, pt.y);
      if (target && target !== sourceBeatId) {
        useStore.getState().connectBeats(sourceBeatId, target);
      }
      setPendingConn(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  if (!board) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-300 text-sm">
        Setting up beats…
      </div>
    );
  }

  const cursor = spaceHeld
    ? "grab"
    : pendingConn || boardTool === "annotation"
    ? "crosshair"
    : "default";

  return (
    <div className="flex-1 relative min-w-0 min-h-0 overflow-hidden bg-ink-950">
      <BeatsToolbar />

      <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
        <button
          onClick={fitContent}
          className="h-10 px-3 rounded-lg border border-ink-700 hover:border-ink-600 bg-ink-900/80 backdrop-blur text-ink-200 hover:text-ink-50 text-sm inline-flex items-center gap-2 transition"
          title="Fit all beats into view (F)"
        >
          <Maximize className="size-4" />
          Fit
        </button>
        <button
          onClick={() => {
            const s = useStore.getState();
            downloadBackup(s.exportBackup(), s.meta?.name);
          }}
          className="h-10 px-3 rounded-lg border border-ink-700 hover:border-ink-600 bg-ink-900/80 backdrop-blur text-ink-200 hover:text-ink-50 text-sm inline-flex items-center gap-2 transition"
          title="Download a JSON backup of your project"
        >
          <Download className="size-4" />
          Save backup
        </button>
        <button
          onClick={startCreatingBeat}
          className="h-10 px-4 rounded-lg bg-accent-400 hover:bg-accent-300 text-ink-950 font-medium text-sm inline-flex items-center gap-2 shadow-lg shadow-accent-400/20 transition"
          title="Add beat (N)"
        >
          <Plus className="size-4" />
          Add beat
        </button>
      </div>

      <div
        ref={surfaceRef}
        data-board-surface
        onMouseDown={onSurfaceMouseDown}
        style={{ cursor }}
        className="absolute inset-0 select-none"
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, oklch(0.30 0.014 265) 1px, transparent 0)",
            backgroundSize: `${24 * board.zoom}px ${24 * board.zoom}px`,
            backgroundPosition: `${board.panX}px ${board.panY}px`,
            opacity: 0.5,
          }}
        />

        <div
          data-board-surface
          className="absolute top-0 left-0"
          style={{
            transform: `translate3d(${board.panX}px, ${board.panY}px, 0) scale(${board.zoom})`,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
          {/* Annotations render BEHIND beats and arrows */}
          {visibleAnnotations.map((a) => (
            <AnnotationCard
              key={a.id}
              node={a}
              selected={boardSelectedIds.has(a.id)}
            />
          ))}

          {draftAnnotation && (
            <div
              className="absolute border-2 border-dashed border-accent-400 bg-accent-400/10 rounded-xl pointer-events-none"
              style={{
                left: draftAnnotation.x,
                top: draftAnnotation.y,
                width: draftAnnotation.w,
                height: draftAnnotation.h,
              }}
            />
          )}

          <GraphArrows
            layout={layout}
            layoutById={layoutById}
            selectedEdge={selectedEdge}
            onSelectEdge={setSelectedEdge}
            onDisconnect={(from, to) => {
              useStore.getState().disconnectBeats(from, to);
              setSelectedEdge(null);
            }}
            pendingConn={pendingConn}
          />

          {visibleLayout.map((l) => (
            <BeatCard
              key={l.beat.id}
              beat={l.beat}
              x={l.x}
              y={l.y}
              width={l.width}
              index={l.index}
              isConnectHoverTarget={pendingConn?.hoverTargetId === l.beat.id}
              onEdit={setEditingBeatId}
              onConnectStart={onConnectStart}
            />
          ))}
        </div>

        {beats.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center max-w-md pointer-events-auto">
              <div className="size-14 rounded-2xl bg-gradient-to-br from-accent-500 to-rose-500 flex items-center justify-center mx-auto mb-4">
                <Workflow className="size-7 text-ink-950" strokeWidth={2.4} />
              </div>
              <h2 className="text-xl font-medium text-ink-50 mb-2 tracking-tight">
                Tell your story in beats
              </h2>
              <p className="text-sm text-ink-300 leading-relaxed max-w-sm mx-auto">
                A beat is a moment — define it by tags + exceptions. Clone to
                branch, drag from a beat's right-edge dot to connect to another
                beat.
              </p>
              <button
                onClick={startCreatingBeat}
                className="mt-5 h-10 px-5 rounded-lg bg-accent-400 hover:bg-accent-300 text-ink-950 font-medium text-sm inline-flex items-center gap-2"
              >
                <Plus className="size-4" /> Add your first beat
              </button>
              <div className="mt-3 text-[11px] text-ink-500">
                Or press <kbd className="px-1 rounded bg-ink-800 text-ink-100">N</kbd>
              </div>
            </div>
          </div>
        )}

        <div className="absolute bottom-3 left-3 z-10 px-2 py-1 rounded-md bg-ink-850/80 backdrop-blur border border-ink-700 text-[11px] font-mono text-ink-300">
          {Math.round(board.zoom * 100)}%
        </div>
      </div>

      {(creatingBeat || editingBeatId) && (
        <BeatEditor
          beatId={editingBeatId}
          initialPosition={creatingBeat ?? undefined}
          onClose={() => {
            setCreatingBeat(null);
            setEditingBeatId(null);
          }}
        />
      )}
    </div>
  );
}

function buildLayout(
  beats: BoardGroupNode[],
  levels: Record<string, import("../../types").Level>,
  levelValues: Record<string, import("../../types").LevelValue>,
  clips: Record<string, import("../../types").Clip>
): BeatLayout[] {
  // Stable per-beat index based on `order` so sequence numbers don't change
  // unless the order itself changes.
  const sortedForIndex = [...beats].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
  const indexById = new Map<string, number>();
  sortedForIndex.forEach((b, i) => indexById.set(b.id, i + 1));
  return beats.map((b) => {
    const matching = clipsMatchingGroup(clips, b.tags);
    const excludedSet = new Set(b.excludedClipIds ?? []);
    const includedCount = matching.filter((c) => !excludedSet.has(c.id)).length;
    const width = beatWidthFor(
      b,
      levels,
      levelValues,
      includedCount,
      excludedSet.size
    );
    return {
      beat: b,
      x: b.x,
      y: b.y,
      width,
      index: indexById.get(b.id) ?? 0,
    };
  });
}

const BeatCard = memo(function BeatCard({
  beat,
  x,
  y,
  width,
  index,
  isConnectHoverTarget,
  onEdit,
  onConnectStart,
}: {
  beat: BoardGroupNode;
  x: number;
  y: number;
  width: number;
  index: number;
  isConnectHoverTarget: boolean;
  onEdit: (id: string) => void;
  onConnectStart: (e: React.PointerEvent, id: string) => void;
}) {
  // Each subscription is scoped so pan/zoom or unrelated state changes don't
  // re-render every beat card.
  const clips = useStore((s) => s.clips);
  const levels = useStore((s) => s.levels);
  const levelValues = useStore((s) => s.levelValues);
  const openGroupModal = useStore((s) => s.openGroupModal);
  const cloneBeat = useStore((s) => s.cloneBeat);
  const updateBoardNode = useStore((s) => s.updateBoardNode);
  const pushBoardHistory = useStore((s) => s.pushBoardHistory);
  const suppressClickRef = useRef(false);

  function onHeaderPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    // Buttons inside the header have their own handlers — let them through.
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = beat.x;
    const startY = beat.y;
    // Capture zoom at drag-start — avoids needing it as a re-rendering prop.
    const startState = useStore.getState();
    const dragZoom =
      startState.boards[startState.currentBoardId ?? ""]?.zoom ?? 1;
    let started = false;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startClientX) / dragZoom;
      const dy = (ev.clientY - startClientY) / dragZoom;
      if (!started) {
        if (Math.abs(ev.clientX - startClientX) + Math.abs(ev.clientY - startClientY) < 4)
          return;
        started = true;
        pushBoardHistory();
      }
      updateBoardNode(beat.id, {
        x: snapToGrid(startX + dx),
        y: snapToGrid(startY + dy),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (started) {
        suppressClickRef.current = true;
        // Cleared after the imminent synthetic click.
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onHeaderClickCapture(e: React.MouseEvent) {
    if (suppressClickRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  const matching = useMemo(
    () => clipsMatchingGroup(clips, beat.tags),
    [clips, beat.tags]
  );
  const excluded = new Set(beat.excludedClipIds ?? []);
  const included = matching.filter((c) => !excluded.has(c.id));
  const sorted = useMemo(
    () => sortClips(included, beat.sort),
    [included, beat.sort]
  );

  const tagChips = useMemo(() => {
    if (!beat.tags) return [];
    const out: { levelName: string; valueName: string; color: string }[] = [];
    for (const [lid, vids] of Object.entries(beat.tags)) {
      const l = levels[lid];
      if (!l) continue;
      for (const vid of vids) {
        const v = levelValues[vid];
        if (!v) continue;
        out.push({ levelName: l.name, valueName: v.name, color: v.color });
      }
    }
    return out;
  }, [beat.tags, levels, levelValues]);

  const VISIBLE_MAX = 40;
  const visible = sorted.slice(0, VISIBLE_MAX);
  const overflow = sorted.length - visible.length;

  const hasFilter = !!(beat.tags && Object.keys(beat.tags).length > 0);

  return (
    <div
      className={clsx(
        "absolute rounded-xl border-2 bg-ink-900 flex flex-col overflow-hidden shadow-lg shadow-ink-950/40 transition-colors",
        isConnectHoverTarget
          ? "border-accent-400 ring-2 ring-accent-400/60"
          : "border-ink-700 hover:border-ink-600"
      )}
      style={{
        left: x,
        top: y,
        width,
        height: BEAT_HEIGHT,
        contain: "layout style paint",
      }}
    >
      {/* Header — drag handle for moving the beat */}
      <div
        className="flex items-center gap-1.5 px-3 py-2 border-b border-ink-800 bg-ink-850/80 cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onHeaderPointerDown}
        onClickCapture={onHeaderClickCapture}
      >
        <span className="text-[10px] font-mono text-ink-500 tabular-nums w-5 text-right">
          {index}
        </span>
        <div
          className="flex-1 text-sm font-medium text-ink-50 truncate cursor-pointer"
          onClick={() => onEdit(beat.id)}
          title={beat.label}
        >
          {beat.label || "Untitled"}
        </div>
        <button
          onClick={() => cloneBeat(beat.id)}
          className="size-6 rounded hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center"
          title="Clone (always adds as a child — branches)"
        >
          <Copy className="size-3.5" />
        </button>
        <button
          onClick={() => onEdit(beat.id)}
          className="size-6 rounded hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center"
          title="Edit beat"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={() => openGroupModal(beat.id)}
          className="size-6 rounded hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center"
          title="Open beat"
        >
          <Expand className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-ink-800 bg-ink-900/60">
        {tagChips.length === 0 ? (
          <span className="text-[10px] text-ink-500 italic">
            {hasFilter ? "Filter set" : "No filter — all clips"}
          </span>
        ) : (
          tagChips.map((t, i) => (
            <span
              key={i}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap shrink-0"
              style={{ backgroundColor: `${t.color}26`, color: t.color }}
              title={`${t.levelName}: ${t.valueName}`}
            >
              {t.valueName}
            </span>
          ))
        )}
        <span className="flex-1" />
        <span className="text-[10px] font-mono text-ink-400 tabular-nums whitespace-nowrap shrink-0">
          {sorted.length}
          {excluded.size > 0 && (
            <span className="text-rose-500/70"> (−{excluded.size})</span>
          )}
        </span>
      </div>

      <div
        className="flex-1 min-h-0 overflow-hidden p-2"
        onClick={() => onEdit(beat.id)}
      >
        {sorted.length === 0 ? (
          <div className="size-full rounded-lg border-2 border-dashed border-ink-800 flex items-center justify-center text-[11px] text-ink-500 px-3 text-center cursor-pointer">
            {hasFilter ? "No matching clips" : "Click to configure"}
          </div>
        ) : (
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))",
              gridAutoRows: "min-content",
            }}
          >
            {visible.map((c) => (
              <div
                key={c.id}
                className="aspect-video rounded overflow-hidden bg-ink-950"
                title={c.name}
              >
                {c.thumb ? (
                  <img
                    src={c.thumb}
                    alt=""
                    className="size-full object-cover pointer-events-none"
                    draggable={false}
                  />
                ) : (
                  <div className="size-full shimmer" />
                )}
              </div>
            ))}
            {overflow > 0 && (
              <div className="aspect-video rounded bg-ink-850 text-[11px] text-ink-300 flex items-center justify-center font-mono">
                +{overflow}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Connection dot on the right edge */}
      <ConnectDot onPointerDown={(e) => onConnectStart(e, beat.id)} />
    </div>
  );
});

function ConnectDot({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <button
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      title="Drag onto another beat to connect"
      className="group absolute -right-3 top-1/2 -translate-y-1/2 size-6 rounded-full flex items-center justify-center cursor-crosshair"
    >
      <span className="size-2.5 rounded-full bg-ink-600 group-hover:size-4 group-hover:bg-accent-400 transition-all" />
    </button>
  );
}

function rectEdgePoint(
  rect: { x: number; y: number; w: number; h: number },
  toX: number,
  toY: number
) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = toX - cx;
  const dy = toY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

function GraphArrows({
  layout,
  layoutById,
  selectedEdge,
  onSelectEdge,
  onDisconnect,
  pendingConn,
}: {
  layout: BeatLayout[];
  layoutById: Map<string, BeatLayout>;
  selectedEdge: { from: string; to: string } | null;
  onSelectEdge: (e: { from: string; to: string }) => void;
  onDisconnect: (from: string, to: string) => void;
  pendingConn: PendingConnection | null;
}) {
  const VIEW = 40000;

  const edges = useMemo(() => {
    const out: { from: BeatLayout; to: BeatLayout }[] = [];
    for (const l of layout) {
      for (const nid of l.beat.nextIds ?? []) {
        const target = layoutById.get(nid);
        if (target) out.push({ from: l, to: target });
      }
    }
    return out;
  }, [layout, layoutById]);

  return (
    <svg
      className="absolute pointer-events-none"
      width={VIEW}
      height={VIEW}
      style={{ left: -VIEW / 2, top: -VIEW / 2, overflow: "visible" }}
      viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}
    >
      <defs>
        <marker
          id="beat-arrowhead"
          markerWidth="12"
          markerHeight="12"
          refX="10"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L0,12 L10,6 z" fill="#cbd5e1" />
        </marker>
        <marker
          id="beat-arrowhead-selected"
          markerWidth="12"
          markerHeight="12"
          refX="10"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L0,12 L10,6 z" fill="oklch(0.86 0.17 73)" />
        </marker>
        <marker
          id="beat-arrowhead-draft"
          markerWidth="12"
          markerHeight="12"
          refX="10"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L0,12 L10,6 z" fill="oklch(0.84 0.16 73)" opacity="0.85" />
        </marker>
      </defs>

      {edges.map(({ from, to }) => {
        const fromRect = { x: from.x, y: from.y, w: from.width, h: BEAT_HEIGHT };
        const toRect = { x: to.x, y: to.y, w: to.width, h: BEAT_HEIGHT };
        const fromCenter = {
          x: fromRect.x + fromRect.w / 2,
          y: fromRect.y + fromRect.h / 2,
        };
        const toCenter = {
          x: toRect.x + toRect.w / 2,
          y: toRect.y + toRect.h / 2,
        };
        const p1 = rectEdgePoint(fromRect, toCenter.x, toCenter.y);
        const p2 = rectEdgePoint(toRect, fromCenter.x, fromCenter.y);
        const isSelected =
          selectedEdge?.from === from.beat.id && selectedEdge?.to === to.beat.id;

        // Bezier control points pull horizontally for a smooth flowchart curve.
        const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.4);
        const c1x = p1.x + dx;
        const c1y = p1.y;
        const c2x = p2.x - dx;
        const c2y = p2.y;
        const path = `M ${p1.x},${p1.y} C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        return (
          <g
            key={`${from.beat.id}-${to.beat.id}`}
            style={{ pointerEvents: "auto", cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectEdge({ from: from.beat.id, to: to.beat.id });
            }}
          >
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={18}
            />
            <path
              d={path}
              fill="none"
              stroke={isSelected ? "oklch(0.86 0.17 73)" : "#cbd5e1"}
              strokeWidth={isSelected ? 2.4 : 1.6}
              markerEnd={`url(#${
                isSelected ? "beat-arrowhead-selected" : "beat-arrowhead"
              })`}
              vectorEffect="non-scaling-stroke"
            />
            {isSelected && (
              <g
                transform={`translate(${midX}, ${midY})`}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDisconnect(from.beat.id, to.beat.id);
                }}
              >
                <circle
                  r={10}
                  fill="oklch(0.16 0.014 270)"
                  stroke="oklch(0.86 0.17 73)"
                  strokeWidth={2}
                />
                <path
                  d="M -4,-4 L 4,4 M 4,-4 L -4,4"
                  stroke="oklch(0.86 0.17 73)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </g>
            )}
          </g>
        );
      })}

      {pendingConn && (() => {
        const source = layoutById.get(pendingConn.sourceId);
        if (!source) return null;
        const sourceRect = {
          x: source.x,
          y: source.y,
          w: source.width,
          h: BEAT_HEIGHT,
        };
        const p1 = rectEdgePoint(
          sourceRect,
          pendingConn.worldX,
          pendingConn.worldY
        );
        const p2 = {
          x: pendingConn.worldX,
          y: pendingConn.worldY,
        };
        const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.4);
        const path = `M ${p1.x},${p1.y} C ${p1.x + dx},${p1.y} ${
          p2.x - dx
        },${p2.y} ${p2.x},${p2.y}`;
        return (
          <path
            d={path}
            fill="none"
            stroke="oklch(0.84 0.16 73)"
            strokeWidth={1.6}
            strokeDasharray="5 4"
            markerEnd="url(#beat-arrowhead-draft)"
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "none" }}
          />
        );
      })()}
    </svg>
  );
}

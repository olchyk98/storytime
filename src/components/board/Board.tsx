import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Copy, Expand, Pencil, Plus, Workflow } from "lucide-react";
import { useStore } from "../../state/store";
import type { BoardGroupNode, Clip } from "../../types";
import { BeatEditor } from "./BeatEditor";
import { clipsMatchingGroup, sortClips } from "../../lib/beatFilter";

const BEAT_MIN_WIDTH = 280;
const BEAT_MAX_WIDTH = 540;
const BEAT_HEIGHT = 220;
const GAP_X = 80;
const GAP_Y = 56;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const PADDING = 60;

const HEADER_CHROME_WIDTH = 20 + 3 * 24 + 4 * 6 + 24; // number + 3 buttons + gaps + px
const LABEL_PADDING = 18;
const LABEL_FONT =
  '500 14px -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, ui-sans-serif, sans-serif';

let measureCtx: CanvasRenderingContext2D | null = null;
const labelWidthCache = new Map<string, number>();

function measureLabelWidth(label: string): number {
  if (!label) return 0;
  const cached = labelWidthCache.get(label);
  if (cached !== undefined) return cached;
  if (!measureCtx) {
    if (typeof document === "undefined") return label.length * 8;
    const canvas = document.createElement("canvas");
    measureCtx = canvas.getContext("2d");
    if (measureCtx) measureCtx.font = LABEL_FONT;
  }
  const w = measureCtx ? measureCtx.measureText(label).width : label.length * 8;
  labelWidthCache.set(label, w);
  return w;
}

function beatWidthFor(label: string | undefined) {
  const labelWidth = measureLabelWidth(label ?? "");
  return Math.min(
    BEAT_MAX_WIDTH,
    Math.max(
      BEAT_MIN_WIDTH,
      Math.ceil(HEADER_CHROME_WIDTH + labelWidth + LABEL_PADDING)
    )
  );
}

interface BeatLayout {
  beat: BoardGroupNode;
  x: number;
  y: number;
  width: number;
  rank: number;
}

interface PendingConnection {
  sourceId: string;
  worldX: number;
  worldY: number;
  hoverTargetId: string | null;
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
    setBoardViewport,
    ensureBoard,
    undoBoard,
    redoBoard,
  } = useStore();

  const board = currentBoardId ? boards[currentBoardId] : null;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [editingBeatId, setEditingBeatId] = useState<string | null>(null);
  const [creatingBeat, setCreatingBeat] = useState(false);
  const [pendingConn, setPendingConn] = useState<PendingConnection | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{
    from: string;
    to: string;
  } | null>(null);

  useEffect(() => {
    if (!currentBoardId) ensureBoard();
  }, [currentBoardId, ensureBoard]);

  const beats = useMemo(() => {
    if (!board) return [] as BoardGroupNode[];
    return Object.values(boardNodes).filter(
      (n): n is BoardGroupNode =>
        n.boardId === board.id && n.kind === "group"
    );
  }, [boardNodes, board]);

  const layout: BeatLayout[] = useMemo(
    () => computeLayout(beats),
    [beats]
  );

  const layoutById = useMemo(() => {
    const m = new Map<string, BeatLayout>();
    for (const l of layout) m.set(l.beat.id, l);
    return m;
  }, [layout]);

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
        setCreatingBeat(true);
      } else if (e.key === "Escape") {
        setPendingConn(null);
        setSelectedEdge(null);
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
  }, [undoBoard, redoBoard]);

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

  function hitTestBeat(worldX: number, worldY: number): string | null {
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

  function onConnectStart(e: React.PointerEvent, sourceBeatId: string) {
    if (!board) return;
    e.stopPropagation();
    if (e.button !== 0) return;
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
      const pt = clientToWorld(
        ev.clientX,
        ev.clientY,
        rect,
        board.panX,
        board.panY,
        board.zoom
      );
      const hover = hitTestBeat(pt.x, pt.y);
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
      const pt = clientToWorld(
        ev.clientX,
        ev.clientY,
        rect,
        board.panX,
        board.panY,
        board.zoom
      );
      const target = hitTestBeat(pt.x, pt.y);
      if (target && target !== sourceBeatId) {
        useStore.getState().connectBeats(sourceBeatId, target);
      }
      setPendingConn(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (!board) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-300 text-sm">
        Setting up beats…
      </div>
    );
  }

  const cursor = spaceHeld
    ? "grab"
    : pendingConn
    ? "crosshair"
    : "default";

  return (
    <div className="flex-1 relative min-w-0 min-h-0 overflow-hidden bg-ink-950">
      <button
        onClick={() => setCreatingBeat(true)}
        className="absolute top-3 right-3 z-30 h-10 px-4 rounded-lg bg-accent-400 hover:bg-accent-300 text-ink-950 font-medium text-sm inline-flex items-center gap-2 shadow-lg shadow-accent-400/20 transition"
        title="Add beat (N)"
      >
        <Plus className="size-4" />
        Add beat
      </button>

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
            transform: `translate(${board.panX}px, ${board.panY}px) scale(${board.zoom})`,
            transformOrigin: "0 0",
          }}
        >
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

          {layout.map((l) => (
            <BeatCard
              key={l.beat.id}
              beat={l.beat}
              x={l.x}
              y={l.y}
              width={l.width}
              isConnectHoverTarget={pendingConn?.hoverTargetId === l.beat.id}
              onEdit={() => setEditingBeatId(l.beat.id)}
              onConnectStart={(e) => onConnectStart(e, l.beat.id)}
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
                onClick={() => setCreatingBeat(true)}
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
          onClose={() => {
            setCreatingBeat(false);
            setEditingBeatId(null);
          }}
        />
      )}
    </div>
  );
}

function computeLayout(beats: BoardGroupNode[]): BeatLayout[] {
  if (beats.length === 0) return [];
  // Build parent map for rank calculation.
  const parents = new Map<string, string[]>();
  for (const b of beats) parents.set(b.id, []);
  for (const b of beats) {
    for (const nid of b.nextIds ?? []) {
      if (parents.has(nid)) parents.get(nid)!.push(b.id);
    }
  }

  // Rank = max(parent rank) + 1, fixed-point iteration.
  const ranks = new Map<string, number>();
  for (const b of beats) ranks.set(b.id, 0);
  let changed = true;
  let iterations = 0;
  const maxIter = beats.length + 2;
  while (changed && iterations < maxIter) {
    changed = false;
    iterations++;
    for (const b of beats) {
      const ps = parents.get(b.id) ?? [];
      const newRank =
        ps.length === 0 ? 0 : Math.max(...ps.map((p) => ranks.get(p) ?? 0)) + 1;
      if (newRank !== ranks.get(b.id)) {
        ranks.set(b.id, newRank);
        changed = true;
      }
    }
  }

  // Group by rank.
  const byRank = new Map<number, BoardGroupNode[]>();
  for (const b of beats) {
    const r = ranks.get(b.id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(b);
  }
  // Stable sort within rank: by order, then label.
  for (const arr of byRank.values()) {
    arr.sort((a, b) => {
      const ao = a.order ?? 0;
      const bo = b.order ?? 0;
      if (ao !== bo) return ao - bo;
      return (a.label ?? "").localeCompare(b.label ?? "");
    });
  }

  // Column x positions are cumulative on rank widths.
  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);
  const colWidthByRank = new Map<number, number>();
  for (const r of sortedRanks) {
    const w = Math.max(
      ...byRank.get(r)!.map((b) => beatWidthFor(b.label))
    );
    colWidthByRank.set(r, w);
  }
  const colXByRank = new Map<number, number>();
  let x = PADDING;
  for (const r of sortedRanks) {
    colXByRank.set(r, x);
    x += colWidthByRank.get(r)! + GAP_X;
  }

  const layout: BeatLayout[] = [];
  for (const r of sortedRanks) {
    const arr = byRank.get(r)!;
    const cx = colXByRank.get(r)!;
    arr.forEach((b, i) => {
      layout.push({
        beat: b,
        x: cx,
        y: PADDING + i * (BEAT_HEIGHT + GAP_Y),
        width: beatWidthFor(b.label),
        rank: r,
      });
    });
  }
  return layout;
}

function BeatCard({
  beat,
  x,
  y,
  width,
  isConnectHoverTarget,
  onEdit,
  onConnectStart,
}: {
  beat: BoardGroupNode;
  x: number;
  y: number;
  width: number;
  isConnectHoverTarget: boolean;
  onEdit: () => void;
  onConnectStart: (e: React.PointerEvent) => void;
}) {
  const { clips, levels, levelValues, openGroupModal, cloneBeat, boardNodes } =
    useStore();

  // Compute this beat's "rank index" via the layout-aware count is too heavy;
  // a simple sequence number is just its order field for display.
  const allBeats = useMemo(
    () =>
      Object.values(boardNodes).filter(
        (n): n is BoardGroupNode =>
          n.boardId === beat.boardId && n.kind === "group"
      ),
    [boardNodes, beat.boardId]
  );
  const indexNumber = useMemo(() => {
    const sorted = [...allBeats].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );
    return sorted.findIndex((b) => b.id === beat.id) + 1;
  }, [allBeats, beat.id]);

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
        "absolute rounded-xl border-2 bg-ink-900/95 backdrop-blur-sm flex flex-col overflow-hidden shadow-lg shadow-ink-950/40 transition-colors",
        isConnectHoverTarget
          ? "border-accent-400 ring-2 ring-accent-400/60"
          : "border-ink-700 hover:border-ink-600"
      )}
      style={{ left: x, top: y, width, height: BEAT_HEIGHT }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-ink-800 bg-ink-850/80">
        <span className="text-[10px] font-mono text-ink-500 tabular-nums w-5 text-right">
          {indexNumber}
        </span>
        <div
          className="flex-1 text-sm font-medium text-ink-50 truncate cursor-pointer"
          onClick={onEdit}
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
          onClick={onEdit}
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
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ backgroundColor: `${t.color}26`, color: t.color }}
              title={`${t.levelName}: ${t.valueName}`}
            >
              {t.valueName}
            </span>
          ))
        )}
        <span className="flex-1" />
        <span className="text-[10px] font-mono text-ink-400 tabular-nums">
          {sorted.length}
          {excluded.size > 0 && (
            <span className="text-rose-500/70"> (−{excluded.size})</span>
          )}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-2" onClick={onEdit}>
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
            {visible.map((c: Clip) => (
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
      <ConnectDot onPointerDown={onConnectStart} />
    </div>
  );
}

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

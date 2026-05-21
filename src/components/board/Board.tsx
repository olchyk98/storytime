import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Expand,
  Pencil,
  Plus,
  Workflow,
} from "lucide-react";
import { useStore } from "../../state/store";
import type { BoardGroupNode, Clip } from "../../types";
import { BeatEditor } from "./BeatEditor";
import { clipsMatchingGroup, sortClips } from "./BoardNode";

const BEAT_MIN_WIDTH = 280;
const BEAT_MAX_WIDTH = 540;
const BEAT_HEIGHT = 220;
const GAP_X = 48;
const GAP_Y = 56;
const COLS = 5;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const PADDING = 40;

// Reserved by the header's number badge + 5 buttons + gaps + horizontal padding.
// Number badge w-5 (20) + 5 buttons size-6 (24 each) + 6 gaps gap-1.5 (6 each) + px-3 (24) = 200
const HEADER_CHROME_WIDTH = 20 + 5 * 24 + 6 * 6 + 24;
// Extra breathing room so a fonts-vs-canvas pixel disagreement never ends in
// an ellipsis.
const LABEL_PADDING = 18;
const LABEL_FONT =
  '500 14px -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, ui-sans-serif, sans-serif';

// Cached canvas context for measureText; created lazily.
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

  useEffect(() => {
    if (!currentBoardId) ensureBoard();
  }, [currentBoardId, ensureBoard]);

  const beats = useMemo(() => {
    if (!board) return [] as BoardGroupNode[];
    return Object.values(boardNodes)
      .filter(
        (n): n is BoardGroupNode =>
          n.boardId === board.id && n.kind === "group"
      )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [boardNodes, board]);

  const layout: BeatLayout[] = useMemo(() => {
    const out: BeatLayout[] = [];
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const width = beatWidthFor(beat.label);
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const y = PADDING + row * (BEAT_HEIGHT + GAP_Y);
      const x =
        col === 0
          ? PADDING
          : out[i - 1].x + out[i - 1].width + GAP_X;
      out.push({ beat, x, y, width });
    }
    return out;
  }, [beats]);

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

  // Wheel: pan; ctrl/meta+wheel: zoom around cursor
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

    // Pan
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

  if (!board) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-300 text-sm">
        Setting up beats…
      </div>
    );
  }

  const cursor = spaceHeld ? "grab" : "default";

  return (
    <div className="flex-1 relative min-w-0 min-h-0 overflow-hidden bg-ink-950">
      {/* Floating add button — top right */}
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
        {/* Dotted background */}
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
          {/* Arrows behind cards */}
          <SequenceArrows layout={layout} />

          {layout.map(({ beat, x, y, width }, i) => (
            <BeatCard
              key={beat.id}
              beat={beat}
              x={x}
              y={y}
              width={width}
              index={i}
              total={layout.length}
              onEdit={() => setEditingBeatId(beat.id)}
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
                A beat is a moment — "at home", "first speech", "gala
                afterparty". Define it by tags + manual exceptions; we'll lay
                them out in order.
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

function BeatCard({
  beat,
  x,
  y,
  width,
  index,
  total,
  onEdit,
}: {
  beat: BoardGroupNode;
  x: number;
  y: number;
  width: number;
  index: number;
  total: number;
  onEdit: () => void;
}) {
  const { clips, levels, levelValues, reorderBeat, openGroupModal, cloneBeat } =
    useStore();

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
    for (const [lid, vid] of Object.entries(beat.tags)) {
      const l = levels[lid];
      const v = levelValues[vid];
      if (!l || !v) continue;
      out.push({ levelName: l.name, valueName: v.name, color: v.color });
    }
    return out;
  }, [beat.tags, levels, levelValues]);

  const VISIBLE_MAX = 40;
  const visible = sorted.slice(0, VISIBLE_MAX);
  const overflow = sorted.length - visible.length;

  const hasFilter = !!(beat.tags && Object.keys(beat.tags).length > 0);

  return (
    <div
      className="absolute rounded-xl border-2 border-ink-700 bg-ink-900/95 backdrop-blur-sm flex flex-col overflow-hidden shadow-lg shadow-ink-950/40 hover:border-ink-600 transition-colors"
      style={{
        left: x,
        top: y,
        width,
        height: BEAT_HEIGHT,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-ink-800 bg-ink-850/80">
        <span className="text-[10px] font-mono text-ink-500 tabular-nums w-5 text-right">
          {index + 1}
        </span>
        <div
          className="flex-1 text-sm font-medium text-ink-50 truncate cursor-pointer"
          onClick={onEdit}
          title={beat.label}
        >
          {beat.label || "Untitled"}
        </div>
        <button
          onClick={() => reorderBeat(beat.id, -1)}
          disabled={index === 0}
          className="size-6 rounded hover:bg-ink-800 text-ink-300 hover:text-ink-50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition"
          title="Move earlier"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <button
          onClick={() => reorderBeat(beat.id, 1)}
          disabled={index === total - 1}
          className="size-6 rounded hover:bg-ink-800 text-ink-300 hover:text-ink-50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition"
          title="Move later"
        >
          <ArrowRight className="size-3.5" />
        </button>
        <button
          onClick={() => cloneBeat(beat.id)}
          className="size-6 rounded hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center"
          title="Clone beat"
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

      {/* Tags + count */}
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

      {/* Body */}
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
    </div>
  );
}

function SequenceArrows({ layout }: { layout: BeatLayout[] }) {
  if (layout.length < 2) return null;
  const VIEW = 20000;
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
      </defs>
      {layout.slice(0, -1).map(({ x, y, width }, i) => {
        const next = layout[i + 1];
        const startX = x + width;
        const startY = y + BEAT_HEIGHT / 2;
        const endX = next.x;
        const endY = next.y + BEAT_HEIGHT / 2;
        const sameRow = Math.abs(endY - startY) < 1;
        const padding = 6;

        if (sameRow) {
          return (
            <line
              key={i}
              x1={startX + padding}
              y1={startY}
              x2={endX - padding}
              y2={endY}
              stroke="#cbd5e1"
              strokeWidth={1.5}
              markerEnd="url(#beat-arrowhead)"
              vectorEffect="non-scaling-stroke"
            />
          );
        }

        // Different row: curve down and back to the start of next row
        const midX = (startX + (next.x + next.width)) / 2;
        const path = `
          M ${startX + padding},${startY}
          C ${startX + 80},${startY} ${midX + 80},${startY} ${midX},${(startY + endY) / 2}
          C ${midX - 80},${endY} ${endX - 80},${endY} ${endX - padding},${endY}
        `;
        return (
          <path
            key={i}
            d={path}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth={1.5}
            markerEnd="url(#beat-arrowhead)"
            vectorEffect="non-scaling-stroke"
            opacity={0.6}
          />
        );
      })}
    </svg>
  );
}

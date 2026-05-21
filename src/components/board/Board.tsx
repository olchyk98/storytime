import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useStore } from "../../state/store";
import type { BoardNode as BoardNodeT } from "../../types";
import { BoardNode } from "./BoardNode";
import { BoardToolbar } from "./BoardToolbar";
import { BoardArrowsLayer } from "./BoardArrowsLayer";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const MIN_NODE_SIZE = 80;

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
    boardTool,
    setBoardTool,
    setBoardViewport,
    createGroupNode,
    createRectNode,
    createTextNode,
    createArrowNode,
    updateBoardNode,
    deleteBoardNodes,
    boardSelectedIds,
    selectBoardNodes,
    clearBoardSelection,
    ensureBoard,
    pushBoardHistory,
    undoBoard,
    redoBoard,
    copySelectedBoardNodes,
    pasteBoardClipboard,
  } = useStore();

  useEffect(() => {
    if (!currentBoardId) ensureBoard();
  }, [currentBoardId, ensureBoard]);

  const board = currentBoardId ? boards[currentBoardId] : null;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [draftRect, setDraftRect] = useState<
    | null
    | {
        kind: "group" | "rect";
        x: number;
        y: number;
        w: number;
        h: number;
      }
  >(null);
  const [draftArrow, setDraftArrow] = useState<
    | null
    | { x1: number; y1: number; x2: number; y2: number }
  >(null);

  // Sort nodes by z so later ones render on top
  const sortedNodes = Object.values(boardNodes)
    .filter((n) => n.boardId === currentBoardId)
    .sort((a, b) => a.z - b.z);

  // Spacebar = temporary pan tool
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;

      const mod = e.metaKey || e.ctrlKey;

      // Undo / redo
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
      // Copy / paste
      if (mod && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        copySelectedBoardNodes();
        return;
      }
      if (mod && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        pasteBoardClipboard();
        return;
      }
      // Duplicate
      if (mod && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        copySelectedBoardNodes();
        pasteBoardClipboard();
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (e.key === "v" || e.key === "V") setBoardTool("select");
      else if (e.key === "g" || e.key === "G") setBoardTool("group");
      else if (e.key === "r" || e.key === "R") setBoardTool("rect");
      else if (e.key === "t" || e.key === "T") setBoardTool("text");
      else if (e.key === "a" || e.key === "A") setBoardTool("arrow");
      else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        boardSelectedIds.size > 0
      ) {
        e.preventDefault();
        deleteBoardNodes([...boardSelectedIds]);
      } else if (e.key === "Escape") {
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
    boardSelectedIds,
    deleteBoardNodes,
    clearBoardSelection,
    setBoardTool,
    undoBoard,
    redoBoard,
    copySelectedBoardNodes,
    pasteBoardClipboard,
  ]);

  // Wheel = pan; ctrl/meta+wheel = zoom around cursor
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
    // Only act when the click is on the surface itself (not a node)
    if (!target.dataset.boardSurface) return;

    const rect = surfaceRef.current!.getBoundingClientRect();
    const start = clientToWorld(
      e.clientX,
      e.clientY,
      rect,
      board.panX,
      board.panY,
      board.zoom
    );

    // Pan with space-held, or select tool on empty canvas
    const wantPan =
      spaceHeld ||
      (boardTool === "select" && !e.shiftKey && !e.metaKey && !e.ctrlKey);

    if (wantPan && boardTool === "select") {
      // Clear selection only if a plain click on empty space
      clearBoardSelection();
      const startPanX = board.panX;
      const startPanY = board.panY;
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        moved = true;
        setBoardViewport(board.id, startPanX + dx, startPanY + dy, board.zoom);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }

    if (boardTool === "group" || boardTool === "rect") {
      // Track draft in a closure variable so the commit side effect doesn't
      // sit inside a setState updater (StrictMode runs those twice in dev).
      let cur = { kind: boardTool, x: start.x, y: start.y, w: 0, h: 0 };
      setDraftRect(cur);
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
          kind: boardTool,
          x: Math.min(start.x, pt.x),
          y: Math.min(start.y, pt.y),
          w: Math.abs(pt.x - start.x),
          h: Math.abs(pt.y - start.y),
        };
        setDraftRect(cur);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const w = Math.max(MIN_NODE_SIZE, cur.w);
        const h = Math.max(MIN_NODE_SIZE, cur.h);
        if (cur.kind === "group") createGroupNode(board.id, cur.x, cur.y, w, h);
        else createRectNode(board.id, cur.x, cur.y, w, h);
        setDraftRect(null);
        setBoardTool("select");
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }

    if (boardTool === "text") {
      // Click-to-place a text label centered on the cursor
      const t = createTextNode(board.id, start.x - 110, start.y - 16);
      selectBoardNodes([t.id]);
      setBoardTool("select");
      return;
    }

    if (boardTool === "arrow") {
      let cur = { x1: start.x, y1: start.y, x2: start.x, y2: start.y };
      setDraftArrow(cur);
      const onMove = (ev: PointerEvent) => {
        const pt = clientToWorld(
          ev.clientX,
          ev.clientY,
          rect,
          board.panX,
          board.panY,
          board.zoom
        );
        cur = { x1: start.x, y1: start.y, x2: pt.x, y2: pt.y };
        setDraftArrow(cur);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const dist = Math.hypot(cur.x2 - cur.x1, cur.y2 - cur.y1);
        if (dist >= 8) {
          const fromNodeId = hitTestNode(cur.x1, cur.y1);
          const toNodeId = hitTestNode(cur.x2, cur.y2);
          createArrowNode(
            board.id,
            cur.x1,
            cur.y1,
            cur.x2,
            cur.y2,
            fromNodeId,
            toNodeId
          );
        }
        setDraftArrow(null);
        setBoardTool("select");
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }
  }

  function hitTestNode(wx: number, wy: number): string | undefined {
    // Top-of-stack first
    const candidates = sortedNodes
      .filter((n) => n.kind !== "arrow")
      .sort((a, b) => b.z - a.z);
    for (const n of candidates) {
      if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) {
        return n.id;
      }
    }
    return undefined;
  }

  function onNodePointerDown(e: React.PointerEvent, node: BoardNodeT) {
    if (!board) return;
    if (e.button !== 0) return;
    e.stopPropagation();

    // Select
    if (e.shiftKey) {
      selectBoardNodes([...boardSelectedIds, node.id]);
    } else if (!boardSelectedIds.has(node.id)) {
      selectBoardNodes([node.id]);
    }

    // Start move
    const rect = surfaceRef.current!.getBoundingClientRect();
    const start = clientToWorld(
      e.clientX,
      e.clientY,
      rect,
      board.panX,
      board.panY,
      board.zoom
    );
    const origin: Record<string, { x: number; y: number }> = {};
    const ids = boardSelectedIds.has(node.id)
      ? [...boardSelectedIds]
      : [node.id];
    for (const id of ids) {
      const n = boardNodes[id];
      if (n) origin[id] = { x: n.x, y: n.y };
    }
    // For arrows we also need to remember endpoints
    const arrowOrigin: Record<
      string,
      { x1: number; y1: number; x2: number; y2: number }
    > = {};
    for (const id of ids) {
      const n = boardNodes[id];
      if (n && n.kind === "arrow") {
        arrowOrigin[id] = { x1: n.x1, y1: n.y1, x2: n.x2, y2: n.y2 };
      }
    }

    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const cur = clientToWorld(
        ev.clientX,
        ev.clientY,
        rect,
        board.panX,
        board.panY,
        board.zoom
      );
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / board.zoom) return;
      if (!moved) pushBoardHistory();
      moved = true;
      for (const id of ids) {
        const o = origin[id];
        if (!o) continue;
        const arrowO = arrowOrigin[id];
        if (arrowO) {
          updateBoardNode(id, {
            x: o.x + dx,
            y: o.y + dy,
            x1: arrowO.x1 + dx,
            y1: arrowO.y1 + dy,
            x2: arrowO.x2 + dx,
            y2: arrowO.y2 + dy,
            // moving an arrow detaches it from any attached nodes
            fromNodeId: undefined,
            toNodeId: undefined,
          });
        } else {
          updateBoardNode(id, { x: o.x + dx, y: o.y + dy });
        }
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onResizeHandleDown(e: React.PointerEvent, node: BoardNodeT) {
    if (!board) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    selectBoardNodes([node.id]);
    const rect = surfaceRef.current!.getBoundingClientRect();
    const start = clientToWorld(
      e.clientX,
      e.clientY,
      rect,
      board.panX,
      board.panY,
      board.zoom
    );
    const ow = node.w;
    const oh = node.h;
    let snapshotted = false;
    const onMove = (ev: PointerEvent) => {
      const cur = clientToWorld(
        ev.clientX,
        ev.clientY,
        rect,
        board.panX,
        board.panY,
        board.zoom
      );
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      if (!snapshotted) {
        pushBoardHistory();
        snapshotted = true;
      }
      updateBoardNode(node.id, {
        w: Math.max(MIN_NODE_SIZE, ow + dx),
        h: Math.max(MIN_NODE_SIZE, oh + dy),
      });
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
        Setting up board…
      </div>
    );
  }

  const cursor = spaceHeld
    ? "grab"
    : boardTool === "group" ||
      boardTool === "rect" ||
      boardTool === "arrow"
    ? "crosshair"
    : boardTool === "text"
    ? "text"
    : "default";

  return (
    <div className="flex-1 relative min-w-0 min-h-0 overflow-hidden bg-ink-950">
      <BoardToolbar />

      <div
        ref={surfaceRef}
        data-board-surface
        onMouseDown={onSurfaceMouseDown}
        style={{ cursor }}
        className="absolute inset-0 select-none"
      >
        {/* Grid background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, oklch(0.30 0.014 265) 1px, transparent 0)",
            backgroundSize: `${24 * board.zoom}px ${24 * board.zoom}px`,
            backgroundPosition: `${board.panX}px ${board.panY}px`,
            opacity: 0.6,
          }}
        />

        {/* World transform */}
        <div
          data-board-surface
          className="absolute top-0 left-0"
          style={{
            transform: `translate(${board.panX}px, ${board.panY}px) scale(${board.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {/* Arrows render under everything else; they pick their own pointer events */}
          <BoardArrowsLayer
            nodes={sortedNodes}
            selectedIds={boardSelectedIds}
            onSelect={(id, additive) => {
              if (additive)
                selectBoardNodes([...boardSelectedIds, id]);
              else selectBoardNodes([id]);
            }}
            draftArrow={draftArrow}
          />

          {sortedNodes
            .filter((n) => n.kind !== "arrow")
            .map((n) => (
              <BoardNode
                key={n.id}
                node={n}
                selected={boardSelectedIds.has(n.id)}
                onPointerDown={(e) => onNodePointerDown(e, n)}
                onResizeHandleDown={(e) => onResizeHandleDown(e, n)}
              />
            ))}

          {/* Draft rectangle */}
          {draftRect && (
            <div
              className={clsx(
                "absolute border-2 border-dashed rounded-lg pointer-events-none",
                draftRect.kind === "group"
                  ? "border-accent-400 bg-accent-400/10"
                  : "border-ink-400 bg-ink-400/10"
              )}
              style={{
                left: draftRect.x,
                top: draftRect.y,
                width: draftRect.w,
                height: draftRect.h,
              }}
            />
          )}
        </div>

        {/* Zoom indicator */}
        <div className="absolute bottom-3 left-3 z-10 px-2 py-1 rounded-md bg-ink-850/80 backdrop-blur border border-ink-700 text-[11px] font-mono text-ink-300">
          {Math.round(board.zoom * 100)}%
        </div>

        {/* Hint */}
        {sortedNodes.length === 0 && !draftRect && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-ink-400 text-sm max-w-xs">
              <div className="font-medium text-ink-200">Empty board.</div>
              <div className="mt-1 text-[12px] leading-relaxed">
                Press <kbd className="px-1 rounded bg-ink-800 text-ink-100">G</kbd>{" "}
                then drag to draw a group. It will fill itself with clips matching
                whatever tags you set on it.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

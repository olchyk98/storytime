import { memo, useState } from "react";
import clsx from "clsx";
import { Trash2 } from "lucide-react";
import type { BoardAnnotationNode } from "../../types";
import { useStore } from "../../state/store";
import { snapToGrid } from "../../lib/eventLayout";

interface Props {
  node: BoardAnnotationNode;
  selected: boolean;
}

const HEADER_HEIGHT = 64;

function currentZoom(): number {
  const s = useStore.getState();
  return s.boards[s.currentBoardId ?? ""]?.zoom ?? 1;
}

export const AnnotationCard = memo(function AnnotationCard({
  node,
  selected,
}: Props) {
  const updateBoardNode = useStore((s) => s.updateBoardNode);
  const deleteBoardNodes = useStore((s) => s.deleteBoardNodes);
  const pushBoardHistory = useStore((s) => s.pushBoardHistory);
  const selectBoardNodes = useStore((s) => s.selectBoardNodes);
  const boardNodes = useStore((s) => s.boardNodes);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label);

  // All nodes whose CENTER currently lies inside this annotation's box.
  // These get selected + dragged together when the title is grabbed.
  function findContained() {
    const ax = node.x;
    const ay = node.y;
    const ax2 = node.x + node.w;
    const ay2 = node.y + node.h;
    const out: { id: string; x: number; y: number }[] = [];
    for (const n of Object.values(boardNodes)) {
      if (n.id === node.id) continue;
      if (n.boardId !== node.boardId) continue;
      if (n.kind === "arrow") continue;
      const cx = n.x + (n.w ?? 0) / 2;
      const cy = n.y + (n.h ?? 0) / 2;
      if (cx >= ax && cx <= ax2 && cy >= ay && cy <= ay2) {
        out.push({ id: n.id, x: n.x, y: n.y });
      }
    }
    return out;
  }

  function onHeaderPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;
    e.stopPropagation();

    const contained = findContained();
    selectBoardNodes([node.id, ...contained.map((c) => c.id)]);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = node.x;
    const startY = node.y;
    const dragZoom = currentZoom();
    const childStarts: Record<string, { x: number; y: number }> = {};
    for (const c of contained) childStarts[c.id] = { x: c.x, y: c.y };
    let started = false;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startClientX) / dragZoom;
      const dy = (ev.clientY - startClientY) / dragZoom;
      if (
        !started &&
        Math.abs(ev.clientX - startClientX) + Math.abs(ev.clientY - startClientY) < 4
      )
        return;
      if (!started) {
        started = true;
        pushBoardHistory();
      }
      const newX = snapToGrid(startX + dx);
      const newY = snapToGrid(startY + dy);
      const actualDx = newX - startX;
      const actualDy = newY - startY;
      updateBoardNode(node.id, { x: newX, y: newY });
      for (const c of contained) {
        const cs = childStarts[c.id];
        updateBoardNode(c.id, {
          x: snapToGrid(cs.x + actualDx),
          y: snapToGrid(cs.y + actualDy),
        });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onResizeHandlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectBoardNodes([node.id]);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startW = node.w;
    const startH = node.h;
    const dragZoom = currentZoom();
    let started = false;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startClientX) / dragZoom;
      const dy = (ev.clientY - startClientY) / dragZoom;
      if (
        !started &&
        Math.abs(ev.clientX - startClientX) + Math.abs(ev.clientY - startClientY) < 4
      )
        return;
      if (!started) {
        started = true;
        pushBoardHistory();
      }
      updateBoardNode(node.id, {
        w: Math.max(160, snapToGrid(startW + dx)),
        h: Math.max(100, snapToGrid(startH + dy)),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function commitLabel() {
    const next = draft.trim() || "Section";
    if (next !== node.label) {
      pushBoardHistory();
      updateBoardNode(node.id, { label: next });
    }
    setEditing(false);
  }

  return (
    <div
      className={clsx(
        "absolute rounded-xl border-2 border-dashed transition-colors pointer-events-none",
        selected
          ? "border-accent-400 bg-accent-400/5"
          : "border-ink-700 bg-ink-900/10"
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
      }}
    >
      <div
        data-annotation-header
        onPointerDown={onHeaderPointerDown}
        onDoubleClick={() => {
          setDraft(node.label);
          setEditing(true);
        }}
        style={{ height: HEADER_HEIGHT, fontSize: 42, lineHeight: 1 }}
        className={clsx(
          "absolute left-2 -top-8 px-6 rounded-lg font-semibold inline-flex items-center gap-3 cursor-grab active:cursor-grabbing select-none tracking-tight pointer-events-auto",
          selected
            ? "bg-accent-400 text-ink-950"
            : "bg-ink-850 text-ink-100 border border-ink-700"
        )}
        title="Drag to move · double-click to rename"
      >
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                (e.currentTarget as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(node.label);
                setEditing(false);
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ fontSize: 42, lineHeight: 1 }}
            className="bg-transparent outline-none border-none min-w-[24ch] font-semibold tracking-tight"
          />
        ) : (
          <span className="whitespace-nowrap">{node.label}</span>
        )}
        {selected && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteBoardNodes([node.id]);
            }}
            className="size-7 rounded hover:bg-ink-950/30 flex items-center justify-center"
            title="Delete annotation"
          >
            <Trash2 className="size-5" />
          </button>
        )}
      </div>
      {/* Resize handle */}
      {selected && (
        <div
          data-annotation-resize
          onPointerDown={onResizeHandlePointerDown}
          className="absolute -right-1.5 -bottom-1.5 size-4 rounded-sm bg-accent-400 border-2 border-ink-950 cursor-nwse-resize pointer-events-auto"
          title="Resize"
        />
      )}
    </div>
  );
});

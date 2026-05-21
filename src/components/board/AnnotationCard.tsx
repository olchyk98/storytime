import { useState } from "react";
import clsx from "clsx";
import { Trash2 } from "lucide-react";
import type { BoardAnnotationNode } from "../../types";
import { useStore } from "../../state/store";
import { snapToGrid } from "../../lib/beatLayout";

interface Props {
  node: BoardAnnotationNode;
  selected: boolean;
  zoom: number;
}

const HEADER_HEIGHT = 64;

export function AnnotationCard({ node, selected, zoom }: Props) {
  const { updateBoardNode, deleteBoardNodes, pushBoardHistory, selectBoardNodes } =
    useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label);

  function onHeaderPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;
    e.stopPropagation();
    selectBoardNodes([node.id]);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = node.x;
    const startY = node.y;
    let started = false;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startClientX) / zoom;
      const dy = (ev.clientY - startClientY) / zoom;
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
        x: snapToGrid(startX + dx),
        y: snapToGrid(startY + dy),
      });
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
    let started = false;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startClientX) / zoom;
      const dy = (ev.clientY - startClientY) / zoom;
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
}

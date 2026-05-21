import { useMemo, useState } from "react";
import clsx from "clsx";
import { Expand, X } from "lucide-react";
import type { BoardNode as BoardNodeT } from "../../types";
import { useStore } from "../../state/store";
import { SearchableSelect } from "../SearchableSelect";

interface Props {
  node: BoardNodeT;
  selected: boolean;
  hoveredAsDropTarget: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeHandleDown: (e: React.PointerEvent) => void;
  onClipDragOver: (e: React.DragEvent) => void;
  onClipDragLeave: () => void;
  onClipDrop: (e: React.DragEvent) => void;
}

export function BoardNode({
  node,
  selected,
  hoveredAsDropTarget,
  onPointerDown,
  onResizeHandleDown,
  onClipDragOver,
  onClipDragLeave,
  onClipDrop,
}: Props) {
  if (node.kind === "group") {
    return (
      <GroupView
        node={node}
        selected={selected}
        hoveredAsDropTarget={hoveredAsDropTarget}
        onPointerDown={onPointerDown}
        onResizeHandleDown={onResizeHandleDown}
        onClipDragOver={onClipDragOver}
        onClipDragLeave={onClipDragLeave}
        onClipDrop={onClipDrop}
      />
    );
  }
  if (node.kind === "comment") {
    return (
      <CommentView
        node={node}
        selected={selected}
        onPointerDown={onPointerDown}
        onResizeHandleDown={onResizeHandleDown}
      />
    );
  }
  if (node.kind === "arrow") {
    // arrows are rendered in BoardArrowsLayer, not here
    return null;
  }
  // rect
  return (
    <div
      onPointerDown={onPointerDown}
      className={clsx(
        "absolute rounded-lg border-2 transition-shadow",
        selected
          ? "border-accent-400 shadow-lg shadow-accent-400/20"
          : "border-ink-700"
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        background: "transparent",
        cursor: "move",
      }}
    >
      {selected && <ResizeHandle onPointerDown={onResizeHandleDown} />}
    </div>
  );
}

function CommentView({
  node,
  selected,
  onPointerDown,
  onResizeHandleDown,
}: {
  node: Extract<BoardNodeT, { kind: "comment" }>;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeHandleDown: (e: React.PointerEvent) => void;
}) {
  const { updateBoardNode } = useStore();
  const [editing, setEditing] = useState(node.text.length === 0);
  const [draft, setDraft] = useState(node.text);

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(node.text);
        setEditing(true);
      }}
      className={clsx(
        "absolute rounded-lg shadow-lg transition-shadow",
        selected
          ? "shadow-accent-400/30 ring-2 ring-accent-400"
          : "shadow-ink-950/60"
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        background:
          "linear-gradient(180deg, oklch(0.86 0.17 73) 0%, oklch(0.82 0.18 70) 100%)",
        color: "oklch(0.16 0.014 70)",
        cursor: "move",
      }}
    >
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            updateBoardNode(node.id, { text: draft });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(node.text);
              setEditing(false);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              (e.currentTarget as HTMLTextAreaElement).blur();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          placeholder="Note…"
          className="size-full bg-transparent outline-none resize-none p-3 text-[13px] font-medium placeholder:text-ink-900/40"
          style={{ color: "inherit" }}
        />
      ) : (
        <div className="size-full p-3 text-[13px] font-medium whitespace-pre-wrap break-words overflow-hidden">
          {node.text || (
            <span className="opacity-50 italic">Double-click to edit</span>
          )}
        </div>
      )}
      {selected && <ResizeHandle onPointerDown={onResizeHandleDown} />}
    </div>
  );
}

function GroupView({
  node,
  selected,
  hoveredAsDropTarget,
  onPointerDown,
  onResizeHandleDown,
  onClipDragOver,
  onClipDragLeave,
  onClipDrop,
}: Props & { node: Extract<BoardNodeT, { kind: "group" }> }) {
  const {
    clips,
    levels,
    levelValues,
    updateBoardNode,
    addValue,
    removeClipFromGroup,
    openGroupModal,
  } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label ?? "");

  const sortedLevels = useMemo(
    () => Object.values(levels).sort((a, b) => a.order - b.order),
    [levels]
  );

  const groupClips = useMemo(
    () =>
      node.clipIds
        .map((id) => clips[id])
        .filter((c): c is NonNullable<typeof c> => Boolean(c)),
    [node.clipIds, clips]
  );

  const tagChips = useMemo(() => {
    if (!node.tags) return [];
    const out: { levelName: string; valueName: string; color: string }[] = [];
    for (const [lid, vid] of Object.entries(node.tags)) {
      const l = levels[lid];
      const v = levelValues[vid];
      if (!l || !v) continue;
      out.push({ levelName: l.name, valueName: v.name, color: v.color });
    }
    return out;
  }, [node.tags, levels, levelValues]);

  // Visible thumb count is capped so a big group doesn't render hundreds of nodes
  const VISIBLE_MAX = 60;
  const visibleThumbs = groupClips.slice(0, VISIBLE_MAX);
  const overflow = groupClips.length - visibleThumbs.length;

  return (
    <div
      onPointerDown={onPointerDown}
      onDragOver={onClipDragOver}
      onDragLeave={onClipDragLeave}
      onDrop={onClipDrop}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.dataset.groupBody) openGroupModal(node.id);
      }}
      className={clsx(
        "absolute rounded-xl border-2 bg-ink-900/95 backdrop-blur-sm flex flex-col overflow-hidden transition-shadow",
        selected
          ? "border-accent-400 shadow-2xl shadow-accent-400/20"
          : "border-ink-700",
        hoveredAsDropTarget && "ring-4 ring-accent-400/50"
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        cursor: "move",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-800 bg-ink-850/80">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              updateBoardNode(node.id, { label: draft.trim() || "Group" });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(node.label ?? "");
                setEditing(false);
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent text-sm font-medium text-ink-50 outline-none focus:bg-ink-900 px-1 rounded"
          />
        ) : (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraft(node.label ?? "");
              setEditing(true);
            }}
            className="flex-1 text-sm font-medium text-ink-50 truncate cursor-text"
            title="Double-click to rename"
          >
            {node.label ?? "Group"}
          </div>
        )}
        <span className="text-[10px] font-mono text-ink-400 tabular-nums">
          {groupClips.length}
        </span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openGroupModal(node.id);
          }}
          className="size-6 rounded hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center"
          title="Open group"
        >
          <Expand className="size-3.5" />
        </button>
      </div>

      {/* Tags */}
      {sortedLevels.length > 0 && (
        <div
          className="flex flex-wrap gap-1 px-3 py-1.5 border-b border-ink-800 bg-ink-900/60"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {sortedLevels.map((l) => {
            const values = Object.values(levelValues)
              .filter((v) => v.levelId === l.id)
              .sort((a, b) => a.order - b.order);
            const current = node.tags?.[l.id] ?? null;
            return (
              <div key={l.id} className="min-w-[88px]">
                <SearchableSelect
                  value={current}
                  placeholder={l.name}
                  triggerClassName="h-7! px-2! text-[11px]!"
                  options={values.map((v) => ({
                    id: v.id,
                    label: v.name,
                    color: v.color,
                  }))}
                  emptyLabel={`No ${l.name.toLowerCase()} values yet`}
                  onCreate={(name) => {
                    const v = addValue(l.id, name);
                    updateBoardNode(node.id, {
                      tags: { ...(node.tags ?? {}), [l.id]: v.id },
                    });
                    return v.id;
                  }}
                  createLabel={`Create ${l.name.toLowerCase()}`}
                  onChange={(valueId) => {
                    const newTags = { ...(node.tags ?? {}) };
                    if (valueId) newTags[l.id] = valueId;
                    else delete newTags[l.id];
                    updateBoardNode(node.id, { tags: newTags });
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Inline tag chips for at-a-glance read */}
      {tagChips.length > 0 && (
        <div
          className="flex flex-wrap gap-1 px-3 pt-1.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {tagChips.map((t, i) => (
            <span
              key={i}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ backgroundColor: `${t.color}26`, color: t.color }}
              title={`${t.levelName}: ${t.valueName}`}
            >
              {t.valueName}
            </span>
          ))}
        </div>
      )}

      {/* Body */}
      <div
        data-group-body="1"
        className="flex-1 min-h-0 overflow-hidden p-2"
      >
        {groupClips.length === 0 ? (
          <div className="size-full rounded-lg border-2 border-dashed border-ink-800 flex items-center justify-center text-[11px] text-ink-500 px-3 text-center">
            Drag clips here from the library
          </div>
        ) : (
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
              gridAutoRows: "min-content",
            }}
          >
            {visibleThumbs.map((c) => (
              <div
                key={c.id}
                className="group/tile relative aspect-video rounded overflow-hidden bg-ink-950"
                title={c.name}
                onPointerDown={(e) => e.stopPropagation()}
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeClipFromGroup(node.id, c.id);
                  }}
                  className="absolute top-0.5 right-0.5 size-4 rounded bg-ink-950/80 text-ink-300 hover:text-rose-500 opacity-0 group-hover/tile:opacity-100 transition"
                  title="Remove from group"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {overflow > 0 && (
              <div
                className="aspect-video rounded bg-ink-850 text-[11px] text-ink-300 flex items-center justify-center font-mono"
                title={`${overflow} more clips`}
              >
                +{overflow}
              </div>
            )}
          </div>
        )}
      </div>

      {selected && <ResizeHandle onPointerDown={onResizeHandleDown} />}
    </div>
  );
}

function ResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute -right-1.5 -bottom-1.5 size-4 rounded-sm bg-accent-400 border-2 border-ink-950 cursor-nwse-resize"
      title="Resize"
    />
  );
}

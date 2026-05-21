import { useMemo, useState } from "react";
import clsx from "clsx";
import { Expand, Filter } from "lucide-react";
import type { BoardNode as BoardNodeT, Clip } from "../../types";
import { useStore } from "../../state/store";
import { SearchableSelect } from "../SearchableSelect";

interface Props {
  node: BoardNodeT;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeHandleDown: (e: React.PointerEvent) => void;
}

export function BoardNode({
  node,
  selected,
  onPointerDown,
  onResizeHandleDown,
}: Props) {
  if (node.kind === "group") {
    return (
      <GroupView
        node={node}
        selected={selected}
        onPointerDown={onPointerDown}
        onResizeHandleDown={onResizeHandleDown}
      />
    );
  }
  if (node.kind === "text") {
    return (
      <TextView
        node={node}
        selected={selected}
        onPointerDown={onPointerDown}
        onResizeHandleDown={onResizeHandleDown}
      />
    );
  }
  if (node.kind === "arrow") {
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

export function clipsMatchingGroup(
  allClips: Record<string, Clip>,
  tags: Record<string, string> | undefined
) {
  const arr = Object.values(allClips);
  if (!tags || Object.keys(tags).length === 0) return arr;
  return arr.filter((c) => {
    if (!c.tags) return false;
    for (const [lid, vid] of Object.entries(tags)) {
      if (c.tags[lid] !== vid) return false;
    }
    return true;
  });
}

function GroupView({
  node,
  selected,
  onPointerDown,
  onResizeHandleDown,
}: {
  node: Extract<BoardNodeT, { kind: "group" }>;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeHandleDown: (e: React.PointerEvent) => void;
}) {
  const {
    clips,
    levels,
    levelValues,
    updateBoardNode,
    addValue,
    openGroupModal,
  } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label ?? "");

  const sortedLevels = useMemo(
    () => Object.values(levels).sort((a, b) => a.order - b.order),
    [levels]
  );

  const groupClips = useMemo(() => {
    const matches = clipsMatchingGroup(clips, node.tags);
    return matches.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
  }, [clips, node.tags]);

  const hasFilter = !!(node.tags && Object.keys(node.tags).length > 0);

  const VISIBLE_MAX = 60;
  const visibleThumbs = groupClips.slice(0, VISIBLE_MAX);
  const overflow = groupClips.length - visibleThumbs.length;

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.dataset.groupBody) openGroupModal(node.id);
      }}
      className={clsx(
        "absolute rounded-xl border-2 bg-ink-900/95 backdrop-blur-sm flex flex-col overflow-hidden transition-shadow",
        selected
          ? "border-accent-400 shadow-2xl shadow-accent-400/20"
          : "border-ink-700"
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
        <span
          className="text-[10px] font-mono text-ink-400 tabular-nums"
          title={hasFilter ? "Matching clips" : "All clips (no filter set)"}
        >
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

      {/* Filter pickers */}
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

      {/* Body */}
      <div data-group-body="1" className="flex-1 min-h-0 overflow-hidden p-2">
        {groupClips.length === 0 ? (
          <div className="size-full rounded-lg border-2 border-dashed border-ink-800 flex items-center justify-center text-[11px] text-ink-500 px-3 text-center">
            {hasFilter ? (
              <span className="inline-flex items-center gap-1.5">
                <Filter className="size-3" />
                No clips match this filter.
              </span>
            ) : sortedLevels.length === 0 ? (
              "Configure levels in the sidebar, then set tags here."
            ) : (
              "Set tags above to filter clips into this group."
            )}
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
                className="relative aspect-video rounded overflow-hidden bg-ink-950"
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

function TextView({
  node,
  selected,
  onPointerDown,
  onResizeHandleDown,
}: {
  node: Extract<BoardNodeT, { kind: "text" }>;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeHandleDown: (e: React.PointerEvent) => void;
}) {
  const { updateBoardNode } = useStore();
  const [editing, setEditing] = useState(node.text.length === 0);
  const [draft, setDraft] = useState(node.text);
  const fontSize = node.fontSize ?? 20;

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(node.text);
        setEditing(true);
      }}
      className={clsx(
        "absolute rounded transition-shadow",
        selected ? "ring-2 ring-accent-400 ring-offset-0" : ""
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
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
          placeholder="Text…"
          className="size-full bg-transparent outline-none resize-none p-1 font-medium tracking-tight text-ink-50 placeholder:text-ink-500"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: 1.2,
          }}
        />
      ) : (
        <div
          className="size-full p-1 whitespace-pre-wrap break-words overflow-hidden font-medium tracking-tight text-ink-50"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: 1.2,
          }}
        >
          {node.text || (
            <span className="opacity-40 italic">Double-click to edit</span>
          )}
        </div>
      )}
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

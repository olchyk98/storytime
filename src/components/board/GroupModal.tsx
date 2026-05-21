import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  Check,
  ChevronDown,
  X,
} from "lucide-react";
import { useStore } from "../../state/store";
import { ClipCard } from "../ClipCard";
import { clipsMatchingGroup, sortClips } from "../../lib/beatFilter";
import type { BoardGroupSort } from "../../types";

const SORT_OPTIONS: {
  key: BoardGroupSort;
  label: string;
  icon: typeof ArrowDownAZ;
}[] = [
  { key: "name-asc", label: "Name A → Z", icon: ArrowDownAZ },
  { key: "name-desc", label: "Name Z → A", icon: ArrowUpAZ },
  { key: "date-desc", label: "Newest first", icon: CalendarArrowDown },
  { key: "date-asc", label: "Oldest first", icon: CalendarArrowUp },
];

export function GroupModal() {
  const {
    groupModalId,
    closeGroupModal,
    boardNodes,
    clips,
    openPreview,
    levels,
    levelValues,
    updateBoardNode,
    pushBoardHistory,
  } = useStore();
  const [sortOpen, setSortOpen] = useState(false);

  const node = groupModalId ? boardNodes[groupModalId] : null;

  const groupSort: BoardGroupSort =
    (node?.kind === "group" ? node.sort : undefined) ?? "name-asc";

  const groupClips = useMemo(() => {
    if (!node || node.kind !== "group") return [];
    const excluded = new Set(node.excludedClipIds ?? []);
    const matches = clipsMatchingGroup(clips, node.tags).filter(
      (c) => !excluded.has(c.id)
    );
    return sortClips(matches, node.sort);
  }, [node, clips]);

  const activeSort = SORT_OPTIONS.find((o) => o.key === groupSort)!;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
          return;
        closeGroupModal();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeGroupModal]);

  const tagChips = useMemo(() => {
    if (!node || node.kind !== "group" || !node.tags) return [];
    const out: { levelName: string; valueName: string; color: string }[] = [];
    for (const [lid, vids] of Object.entries(node.tags)) {
      const l = levels[lid];
      if (!l) continue;
      for (const vid of vids as string[]) {
        const v = levelValues[vid];
        if (!v) continue;
        out.push({ levelName: l.name, valueName: v.name, color: v.color });
      }
    }
    return out;
  }, [node, levels, levelValues]);

  if (!node || node.kind !== "group") return null;

  return (
    <div className="fixed inset-0 z-40 bg-ink-950/85 backdrop-blur-sm flex flex-col fade-in">
      <header className="px-5 py-3 border-b border-ink-800 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-400">Beat</div>
          <div className="flex items-center gap-2">
            <div className="font-medium text-ink-50 truncate">
              {node.label ?? "Untitled beat"}
            </div>
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
            <span className="text-xs font-mono text-ink-400">
              {groupClips.length} clip{groupClips.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setSortOpen((o) => !o)}
            className="h-9 px-3 rounded-lg border border-ink-800 hover:border-ink-700 text-ink-100 hover:text-ink-50 text-xs inline-flex items-center gap-1.5 transition"
          >
            <activeSort.icon className="size-3.5" />
            {activeSort.label}
            <ChevronDown
              className={clsx("size-3 transition", sortOpen && "rotate-180")}
            />
          </button>
          {sortOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setSortOpen(false)}
              />
              <div className="absolute right-0 top-10 z-20 w-48 rounded-lg bg-ink-850 border border-ink-700 shadow-xl shadow-ink-950/60 p-1 pop-in">
                {SORT_OPTIONS.map((o) => {
                  const Icon = o.icon;
                  const active = o.key === groupSort;
                  return (
                    <button
                      key={o.key}
                      onClick={() => {
                        if (node && node.kind === "group" && o.key !== groupSort) {
                          pushBoardHistory();
                          updateBoardNode(node.id, { sort: o.key });
                        }
                        setSortOpen(false);
                      }}
                      className={clsx(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition",
                        active
                          ? "bg-ink-700 text-ink-50"
                          : "hover:bg-ink-700 text-ink-100"
                      )}
                    >
                      <Icon className="size-3.5 text-ink-300" />
                      <span className="flex-1">{o.label}</span>
                      {active && <Check className="size-3.5 text-accent-300" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <button
          onClick={closeGroupModal}
          className="size-9 rounded-md hover:bg-ink-800 text-ink-200 hover:text-ink-50 flex items-center justify-center"
          title="Close (Esc)"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {groupClips.length === 0 ? (
          <div className="h-full flex items-center justify-center text-ink-400 text-sm">
            No clips match this filter.
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
            {groupClips.map((c) => (
              <ClipCard key={c.id} clip={c} onOpen={() => openPreview(c.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

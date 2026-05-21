import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  Check,
  ChevronDown,
  LayoutGrid,
  List,
  Search,
} from "lucide-react";
import { useStore, type Selection } from "../state/store";
import { ClipCard } from "./ClipCard";
import { ClipRow } from "./ClipRow";
import { BulkTagBar } from "./BulkTagBar";
import { fmtBytes } from "../lib/format";
import { useLocalStorage } from "../lib/useLocalStorage";

type SortKey = "name-asc" | "name-desc" | "date-desc" | "date-asc";
type ViewMode = "grid" | "list";

const SORT_OPTIONS: { key: SortKey; label: string; icon: typeof ArrowDownAZ }[] = [
  { key: "name-asc", label: "Name A → Z", icon: ArrowDownAZ },
  { key: "name-desc", label: "Name Z → A", icon: ArrowUpAZ },
  { key: "date-desc", label: "Newest first", icon: CalendarArrowDown },
  { key: "date-asc", label: "Oldest first", icon: CalendarArrowUp },
];

function selectionTitle(
  s: Selection,
  levelName?: string,
  filterParts?: { levelName: string; valueName: string }[]
) {
  switch (s.kind) {
    case "all":
      return { kicker: "Project", title: "All clips" };
    case "new":
      return { kicker: "Inbox", title: "New since last scan" };
    case "untagged":
      return { kicker: levelName ?? "Level", title: "Untagged" };
    case "filter": {
      const parts = filterParts ?? [];
      if (parts.length === 0)
        return { kicker: "Filter", title: "—" };
      if (parts.length === 1)
        return {
          kicker: parts[0].levelName,
          title: parts[0].valueName,
        };
      return {
        kicker: "Filter",
        title: parts
          .map((p) => `${p.levelName}: ${p.valueName}`)
          .join(" · "),
      };
    }
    case "folder-day":
      return { kicker: "Folder", title: s.day === "_" ? "(root)" : s.day };
    case "folder-event":
      return {
        kicker: `Folder · ${s.day}`,
        title: s.event === "_" ? "(direct)" : s.event,
      };
    case "folder-source":
      return {
        kicker: `${s.day} / ${s.event}`,
        title: s.source === "_" ? "(direct)" : s.source,
      };
  }
}

export function ClipGrid() {
  const {
    selection,
    visibleClips,
    clips,
    levels,
    levelValues,
    selectedClipIds,
    clearSelection,
    selectAllVisible,
    previewClipId,
  } = useStore();
  const [q, setQ] = useState("");
  const [sort, setSort] = useLocalStorage<SortKey>("storytime.sort", "name-asc");
  const [view, setView] = useLocalStorage<ViewMode>("storytime.view", "grid");
  const [sortOpen, setSortOpen] = useState(false);

  const items = useMemo(() => {
    let arr = visibleClips();
    if (q.trim()) {
      const needle = q.toLowerCase();
      arr = arr.filter((c) => c.name.toLowerCase().includes(needle));
    }

    const sorted = [...arr];
    switch (sort) {
      case "name-asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        break;
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
        break;
      case "date-desc":
        sorted.sort((a, b) => b.lastModified - a.lastModified);
        break;
      case "date-asc":
        sorted.sort((a, b) => a.lastModified - b.lastModified);
        break;
    }
    return sorted;
  }, [visibleClips, q, selection, clips, sort]);

  const activeSort = SORT_OPTIONS.find((o) => o.key === sort)!;

  const levelName =
    selection.kind === "untagged"
      ? levels[selection.levelId]?.name
      : undefined;
  const filterParts =
    selection.kind === "filter"
      ? Object.entries(selection.tags)
          .map(([lid, vid]) => {
            const l = levels[lid];
            const v = levelValues[vid];
            return l && v ? { levelName: l.name, valueName: v.name } : null;
          })
          .filter((p): p is { levelName: string; valueName: string } =>
            Boolean(p)
          )
      : undefined;

  const header = selectionTitle(selection, levelName, filterParts);
  const totalSize = items.reduce((s, c) => s + c.size, 0);
  const newCount = items.filter((c) => c.isNew).length;

  // Keyboard: Esc clears selection; Cmd/Ctrl-A selects visible
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (e.key === "Escape" && selectedClipIds.size > 0 && !previewClipId) {
        clearSelection();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !previewClipId) {
        e.preventDefault();
        selectAllVisible();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedClipIds.size, clearSelection, selectAllVisible, previewClipId]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
      <header className="px-6 py-4 border-b border-ink-800 bg-ink-900/60 flex items-end gap-5">
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-400">
            {header.kicker}
          </div>
          <h2 className="text-xl font-medium text-ink-50 mt-0.5 truncate">
            {header.title}
          </h2>
        </div>
        <Stat label="Clips" value={items.length.toString()} />
        <Stat label="Size" value={fmtBytes(totalSize)} />
        {newCount > 0 && (
          <Stat label="New" value={newCount.toString()} tone="accent" />
        )}
      </header>

      <div className="px-6 py-3 border-b border-ink-800 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="size-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by filename…"
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-ink-900 border border-ink-800 focus:border-accent-400 text-sm text-ink-100 placeholder:text-ink-500"
          />
        </div>

        <div className="flex-1" />

        <div className="relative">
          <button
            onClick={() => setSortOpen(!sortOpen)}
            className="h-9 px-3 rounded-lg border border-ink-800 hover:border-ink-700 text-ink-100 hover:text-ink-50 text-xs inline-flex items-center gap-1.5 transition"
          >
            <activeSort.icon className="size-3.5" />
            {activeSort.label}
            <ChevronDown className={clsx("size-3 transition", sortOpen && "rotate-180")} />
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
              <div className="absolute right-0 top-10 z-20 w-48 rounded-lg bg-ink-850 border border-ink-700 shadow-xl shadow-ink-950/60 p-1 pop-in">
                {SORT_OPTIONS.map((o) => {
                  const Icon = o.icon;
                  const active = o.key === sort;
                  return (
                    <button
                      key={o.key}
                      onClick={() => {
                        setSort(o.key);
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

        <div className="inline-flex h-9 rounded-lg border border-ink-800 overflow-hidden p-0.5 bg-ink-900">
          <button
            onClick={() => setView("grid")}
            title="Grid view"
            className={clsx(
              "px-2.5 rounded-md text-xs inline-flex items-center transition",
              view === "grid"
                ? "bg-ink-700 text-ink-50"
                : "text-ink-300 hover:text-ink-50"
            )}
          >
            <LayoutGrid className="size-3.5" />
          </button>
          <button
            onClick={() => setView("list")}
            title="List view"
            className={clsx(
              "px-2.5 rounded-md text-xs inline-flex items-center transition",
              view === "list"
                ? "bg-ink-700 text-ink-50"
                : "text-ink-300 hover:text-ink-50"
            )}
          >
            <List className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
        {items.length === 0 ? (
          <EmptyState selection={selection} />
        ) : view === "grid" ? (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
            {items.map((c) => (
              <ClipItem key={c.id} id={c.id} view="grid" />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5 max-w-5xl mx-auto">
            {items.map((c) => (
              <ClipItem key={c.id} id={c.id} view="list" />
            ))}
          </div>
        )}
      </div>

      <BulkTagBar />
    </div>
  );
}

function ClipItem({ id, view }: { id: string; view: "grid" | "list" }) {
  const clip = useStore((s) => s.clips[id]);
  const openPreview = useStore((s) => s.openPreview);
  if (!clip) return null;
  return view === "grid" ? (
    <ClipCard clip={clip} onOpen={() => openPreview(clip.id)} />
  ) : (
    <ClipRow clip={clip} onOpen={() => openPreview(clip.id)} />
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "accent" | "sage";
}) {
  return (
    <div className="text-right shrink-0">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div
        className={clsx(
          "font-mono text-sm",
          tone === "accent"
            ? "text-accent-300"
            : tone === "sage"
            ? "text-sage-400"
            : "text-ink-50"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({ selection }: { selection: Selection }) {
  let msg = "Nothing here yet.";
  if (selection.kind === "new") msg = "No new files since last scan. Try Re-scan up top.";
  if (selection.kind === "untagged")
    msg = "Every clip at this level is tagged. Nice.";
  if (selection.kind === "filter")
    msg = "No clips match this combination of tags yet.";
  if (
    selection.kind === "folder-day" ||
    selection.kind === "folder-event" ||
    selection.kind === "folder-source"
  )
    msg = "This folder is empty.";
  return (
    <div className="h-full flex items-center justify-center text-center text-ink-300 text-sm">
      {msg}
    </div>
  );
}

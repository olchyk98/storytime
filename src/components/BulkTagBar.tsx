import { useMemo } from "react";
import { CheckCheck, X } from "lucide-react";
import { useStore } from "../state/store";
import { SearchableSelect } from "./SearchableSelect";

export function BulkTagBar() {
  const {
    selectedClipIds,
    clips,
    levels,
    levelValues,
    tagClips,
    addValue,
    clearSelection,
    selectAllVisible,
    visibleClips,
  } = useStore();

  const sortedLevels = useMemo(
    () => Object.values(levels).sort((a, b) => a.order - b.order),
    [levels]
  );

  if (selectedClipIds.size === 0) return null;

  const ids = [...selectedClipIds];
  const visible = visibleClips();
  const allVisibleSelected =
    visible.length > 0 && visible.every((c) => selectedClipIds.has(c.id));

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-2 rounded-2xl bg-ink-850 border border-ink-700 shadow-2xl shadow-ink-950/70 pop-in whitespace-nowrap">
      <span className="text-sm font-medium text-ink-50 px-1 tabular-nums">
        {ids.length} selected
      </span>
      <button
        onClick={selectAllVisible}
        disabled={allVisibleSelected}
        className="h-8 px-2.5 rounded-md border border-ink-700 hover:border-ink-600 text-ink-200 hover:text-ink-50 text-xs inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0"
        title="Select all in current view (⌘A)"
      >
        <CheckCheck className="size-3.5 shrink-0" />
        {allVisibleSelected ? `All ${visible.length}` : `Select all ${visible.length}`}
      </button>
      <span className="w-px h-6 bg-ink-700" />

      {sortedLevels.length === 0 ? (
        <span className="text-xs text-ink-400 px-2">
          No levels yet — add one in the sidebar to start tagging.
        </span>
      ) : (
        sortedLevels.map((l) => {
          const valuesForLevel = Object.values(levelValues)
            .filter((v) => v.levelId === l.id)
            .sort((a, b) => a.order - b.order);

          // Determine shared value across all selected clips
          let shared: string | null | "mixed" = null;
          for (const id of ids) {
            const c = clips[id];
            const v = c?.tags?.[l.id] ?? null;
            if (shared === null && v !== null) shared = v;
            else if (shared === null && v === null) shared = null;
            else if (shared !== v) {
              shared = "mixed";
              break;
            }
          }

          const value =
            shared === "mixed" ? null : (shared as string | null) ?? null;

          return (
            <div key={l.id} className="min-w-[170px]">
              <SearchableSelect
                value={value}
                placeholder={shared === "mixed" ? `${l.name} (mixed)` : l.name}
                direction="up"
                options={valuesForLevel.map((v) => ({
                  id: v.id,
                  label: v.name,
                  color: v.color,
                }))}
                emptyLabel={`No ${l.name.toLowerCase()} values yet`}
                onCreate={(name) => {
                  const v = addValue(l.id, name);
                  tagClips(ids, l.id, v.id);
                  return v.id;
                }}
                createLabel={`Create ${l.name.toLowerCase()}`}
                onChange={(valueId) => tagClips(ids, l.id, valueId)}
              />
            </div>
          );
        })
      )}

      <span className="w-px h-6 bg-ink-700" />
      <button
        onClick={clearSelection}
        className="size-8 rounded-md hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center transition"
        title="Clear selection (Esc)"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

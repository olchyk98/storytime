import { useMemo } from "react";
import { X } from "lucide-react";
import { useStore } from "../../state/store";
import { ClipCard } from "../ClipCard";

export function GroupModal() {
  const {
    groupModalId,
    closeGroupModal,
    boardNodes,
    clips,
    openPreview,
    levels,
    levelValues,
  } = useStore();

  const node = groupModalId ? boardNodes[groupModalId] : null;

  const groupClips = useMemo(() => {
    if (!node || node.kind !== "group") return [];
    return node.clipIds
      .map((id) => clips[id])
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [node, clips]);

  const tagChips = useMemo(() => {
    if (!node || node.kind !== "group" || !node.tags) return [];
    const out: { levelName: string; valueName: string; color: string }[] = [];
    for (const [lid, vid] of Object.entries(node.tags)) {
      const l = levels[lid];
      const v = levelValues[vid];
      if (!l || !v) continue;
      out.push({ levelName: l.name, valueName: v.name, color: v.color });
    }
    return out;
  }, [node, levels, levelValues]);

  if (!node || node.kind !== "group") return null;

  return (
    <div className="fixed inset-0 z-40 bg-ink-950/85 backdrop-blur-sm flex flex-col fade-in">
      <header className="px-5 py-3 border-b border-ink-800 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-400">Group</div>
          <div className="flex items-center gap-2">
            <div className="font-medium text-ink-50 truncate">
              {node.label ?? "Group"}
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
            This group is empty. Drag clips into it from the library.
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

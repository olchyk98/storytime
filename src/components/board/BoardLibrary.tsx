import { useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronRight, Library, Search } from "lucide-react";
import { useStore } from "../../state/store";

const DRAG_MIME = "application/x-storytime-clip-id";

export function BoardLibrary() {
  const { clips, levels, levelValues } = useStore();
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  const [valueFilter, setValueFilter] = useState<string | null>(null);

  const sortedLevels = useMemo(
    () => Object.values(levels).sort((a, b) => a.order - b.order),
    [levels]
  );

  const valuesForFilter = useMemo(() => {
    if (!levelFilter) return [];
    return Object.values(levelValues)
      .filter((v) => v.levelId === levelFilter)
      .sort((a, b) => a.order - b.order);
  }, [levelValues, levelFilter]);

  const filtered = useMemo(() => {
    let arr = Object.values(clips);
    if (q.trim()) {
      const n = q.toLowerCase();
      arr = arr.filter((c) => c.name.toLowerCase().includes(n));
    }
    if (levelFilter && valueFilter) {
      arr = arr.filter((c) => c.tags?.[levelFilter] === valueFilter);
    }
    return arr
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .slice(0, 500);
  }, [clips, q, levelFilter, valueFilter]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-3 right-3 z-20 size-9 rounded-lg bg-ink-850/90 backdrop-blur border border-ink-700 text-ink-200 hover:text-ink-50 flex items-center justify-center"
        title="Show library"
      >
        <Library className="size-4" />
      </button>
    );
  }

  return (
    <aside className="absolute top-0 right-0 bottom-0 z-10 w-72 border-l border-ink-800 bg-ink-900/95 backdrop-blur flex flex-col">
      <div className="px-3 py-3 border-b border-ink-800 flex items-center gap-2">
        <Library className="size-4 text-ink-300" />
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider text-ink-400">Library</div>
          <div className="text-[11px] text-ink-500">
            Drag a clip onto a group to add it
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="size-7 rounded-md hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center"
          title="Hide library"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="px-3 py-2 space-y-2 border-b border-ink-800">
        <div className="relative">
          <Search className="size-3.5 text-ink-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by filename…"
            className="w-full h-8 pl-8 pr-2 rounded bg-ink-900 border border-ink-800 focus:border-accent-400 text-sm text-ink-100 placeholder:text-ink-500"
          />
        </div>
        {sortedLevels.length > 0 && (
          <div className="flex gap-1.5 items-center">
            <select
              value={levelFilter ?? ""}
              onChange={(e) => {
                setLevelFilter(e.target.value || null);
                setValueFilter(null);
              }}
              className="h-7 px-2 rounded bg-ink-900 border border-ink-800 text-[12px] text-ink-100"
            >
              <option value="">No level filter</option>
              {sortedLevels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {levelFilter && (
              <select
                value={valueFilter ?? ""}
                onChange={(e) => setValueFilter(e.target.value || null)}
                className="h-7 px-2 rounded bg-ink-900 border border-ink-800 text-[12px] text-ink-100 flex-1 min-w-0"
              >
                <option value="">Any value</option>
                {valuesForFilter.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <div className="text-[11px] text-ink-500 px-1">
          {filtered.length} clip{filtered.length === 1 ? "" : "s"}
          {filtered.length === 500 ? " (capped)" : ""}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {filtered.map((c) => (
          <div
            key={c.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, c.id);
              e.dataTransfer.setData("text/plain", c.name);
              e.dataTransfer.effectAllowed = "copy";
            }}
            className={clsx(
              "group flex items-center gap-2 px-1.5 py-1 rounded-md border border-transparent hover:border-ink-700 hover:bg-ink-850 cursor-grab active:cursor-grabbing select-none"
            )}
            title={c.name}
          >
            <div className="w-14 aspect-video rounded-sm overflow-hidden bg-ink-950 shrink-0">
              {c.thumb ? (
                <img src={c.thumb} alt="" className="size-full object-cover" />
              ) : (
                <div className="size-full shimmer" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="text-[12px] font-medium text-ink-100 truncate"
                title={c.name}
              >
                {c.name}
              </div>
              <div className="text-[10px] text-ink-500 truncate">
                {c.day !== "_" && <span>{c.day}</span>}
                {c.event !== "_" && <span> · {c.event}</span>}
                {c.source !== "_" && <span> · {c.source}</span>}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-xs text-ink-500 py-6">No clips.</div>
        )}
      </div>
    </aside>
  );
}

export { DRAG_MIME };

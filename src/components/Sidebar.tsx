import { useMemo, useState } from "react";
import {
  Calendar,
  ChevronRight,
  Clapperboard,
  Film,
  Filter,
  FolderTree,
  Layers,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Tags,
} from "lucide-react";
import clsx from "clsx";
import { useStore, type Selection } from "../state/store";

export function Sidebar({
  onOpenManager,
}: {
  onOpenManager: () => void;
}) {
  const {
    meta,
    clips,
    levels,
    levelValues,
    selection,
    setSelection,
    rescan,
    scan,
    addLevel,
  } = useStore();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  const folderTree = useMemo(() => {
    const map = new Map<string, Map<string, Map<string, number>>>();
    for (const c of Object.values(clips)) {
      let d = map.get(c.day);
      if (!d) (d = new Map()), map.set(c.day, d);
      let e = d.get(c.event);
      if (!e) (e = new Map()), d.set(c.event, e);
      e.set(c.source, (e.get(c.source) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, evMap]) => {
        const events = [...evMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([event, srcMap]) => {
            // Total clips at this event including any "_" (direct) sources.
            const eventTotal = [...srcMap.values()].reduce((a, b) => a + b, 0);
            // Hide "(direct)" source rows; the parent event click catches them.
            const sources = [...srcMap.entries()]
              .filter(([source]) => source !== "_")
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([source, count]) => ({ source, count }));
            return { event, sources, count: eventTotal };
          })
          // Hide "(direct)" event rows; the parent day click catches them.
          .filter((e) => e.event !== "_");
        const dayTotal = [...evMap.values()]
          .map((srcMap) => [...srcMap.values()].reduce((a, b) => a + b, 0))
          .reduce((a, b) => a + b, 0);
        return { day, events, count: dayTotal };
      });
  }, [clips]);

  const sortedLevels = useMemo(
    () => Object.values(levels).sort((a, b) => a.order - b.order),
    [levels]
  );

  const valuesByLevel = useMemo(() => {
    const m = new Map<string, ReturnType<typeof Object.values<typeof levelValues[string]>>>();
    for (const v of Object.values(levelValues)) {
      if (!m.has(v.levelId)) m.set(v.levelId, [] as any);
      (m.get(v.levelId) as any).push(v);
    }
    for (const arr of m.values()) (arr as any).sort((a: any, b: any) => a.order - b.order);
    return m;
  }, [levelValues]);

  const newCount = useMemo(
    () => Object.values(clips).filter((c) => c.isNew).length,
    [clips]
  );

  function isSelected(s: Selection) {
    return JSON.stringify(s) === JSON.stringify(selection);
  }

  function valueCount(valueId: string, levelId: string) {
    let n = 0;
    for (const c of Object.values(clips)) {
      if (c.tags && c.tags[levelId] === valueId) n++;
    }
    return n;
  }
  function untaggedCount(levelId: string) {
    let n = 0;
    for (const c of Object.values(clips)) {
      if (!c.tags || !c.tags[levelId]) n++;
    }
    return n;
  }

  return (
    <aside className="w-72 shrink-0 border-r border-ink-800 bg-ink-900/60 flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2.5 border-b border-ink-800">
        <div className="size-7 rounded-lg bg-gradient-to-br from-accent-500 to-rose-500 flex items-center justify-center">
          <Clapperboard className="size-3.5 text-ink-950" strokeWidth={2.6} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-500">project</div>
          <div className="truncate font-medium text-ink-50 text-sm">
            {meta?.name ?? "—"}
          </div>
        </div>
        <button
          onClick={rescan}
          disabled={scan.active}
          title="Re-scan folder"
          className="size-8 rounded-lg hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center transition disabled:opacity-40"
        >
          <RefreshCw className={clsx("size-4", scan.active && "animate-spin")} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
        <Section>
          <Row
            icon={<Layers className="size-4" />}
            label="All clips"
            count={Object.keys(clips).length}
            selected={isSelected({ kind: "all" })}
            onClick={() => setSelection({ kind: "all" })}
          />
          <Row
            icon={<Sparkles className="size-4" />}
            label="New since last scan"
            count={newCount}
            tone="accent"
            selected={isSelected({ kind: "new" })}
            onClick={() => setSelection({ kind: "new" })}
            disabled={newCount === 0}
          />
        </Section>

        <Section
          title="Hierarchy"
          icon={<Tags className="size-3.5" />}
          action={
            <button
              onClick={onOpenManager}
              className="size-5 rounded hover:bg-ink-800 text-ink-400 hover:text-ink-50 flex items-center justify-center"
              title="Manage levels"
            >
              <Settings2 className="size-3.5" />
            </button>
          }
        >
          {sortedLevels.length === 0 ? (
            <div className="px-3 py-3">
              <div className="text-xs text-ink-400 leading-relaxed mb-2">
                Define your own dimensions for grouping clips — like Day, Event, Source, Camera.
              </div>
              <button
                onClick={() => {
                  const name = prompt("First level name (e.g. Day)");
                  if (name?.trim()) addLevel(name.trim());
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md bg-accent-400 hover:bg-accent-300 text-ink-950 font-medium text-xs transition"
              >
                <Plus className="size-3.5" /> Add first level
              </button>
            </div>
          ) : (
            sortedLevels.map((l) => {
              const values = ((valuesByLevel.get(l.id) ?? []) as any[]);
              const open = expanded[l.id] ?? true;
              const total = Object.values(clips).filter((c) => c.tags?.[l.id]).length;
              return (
                <div key={l.id}>
                  <Row
                    icon={
                      <ChevronRight
                        className={clsx(
                          "size-3.5 transition shrink-0",
                          open && "rotate-90"
                        )}
                      />
                    }
                    label={l.name}
                    count={total}
                    selected={false}
                    onClick={() =>
                      setExpanded((s) => ({ ...s, [l.id]: !open }))
                    }
                  />
                  {open && (
                    <div className="ml-3 border-l border-ink-800 pl-2 mt-0.5 space-y-0.5">
                      {values.length === 0 ? (
                        <div className="px-2 py-1.5 text-[11px] text-ink-500">
                          No values yet.
                        </div>
                      ) : (
                        values.map((v) => (
                          <Row
                            key={v.id}
                            icon={
                              <span
                                className="size-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: v.color }}
                              />
                            }
                            label={v.name}
                            count={valueCount(v.id, l.id)}
                            dense
                            selected={isSelected({
                              kind: "level-value",
                              levelId: l.id,
                              valueId: v.id,
                            })}
                            onClick={() =>
                              setSelection({
                                kind: "level-value",
                                levelId: l.id,
                                valueId: v.id,
                              })
                            }
                          />
                        ))
                      )}
                      <Row
                        icon={<Filter className="size-3 text-ink-500" />}
                        label="Untagged"
                        count={untaggedCount(l.id)}
                        dense
                        selected={isSelected({
                          kind: "untagged",
                          levelId: l.id,
                        })}
                        onClick={() =>
                          setSelection({
                            kind: "untagged",
                            levelId: l.id,
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </Section>

        {folderTree.length > 0 && (
          <Section title="Folders" icon={<FolderTree className="size-3.5" />}>
            {folderTree.map((d) => {
              const open = expandedDays[d.day] ?? false;
              const hasEvents = d.events.length > 0;
              return (
                <div key={d.day}>
                  <Row
                    icon={
                      hasEvents ? (
                        <ChevronRight
                          className={clsx("size-3.5 transition", open && "rotate-90")}
                        />
                      ) : (
                        <Calendar className="size-3.5" />
                      )
                    }
                    onIconClick={
                      hasEvents
                        ? () => setExpandedDays((s) => ({ ...s, [d.day]: !open }))
                        : undefined
                    }
                    label={d.day === "_" ? "(root)" : d.day}
                    count={d.count}
                    selected={isSelected({ kind: "folder-day", day: d.day })}
                    onClick={() =>
                      setSelection({ kind: "folder-day", day: d.day })
                    }
                  />
                  {open && hasEvents && (
                    <div className="ml-3 border-l border-ink-800 pl-2 mt-0.5 space-y-0.5">
                      {d.events.map((e) => {
                        const ek = `${d.day}/${e.event}`;
                        const eo = expandedEvents[ek] ?? false;
                        const hasSources = e.sources.length > 0;
                        return (
                          <div key={ek}>
                            <Row
                              icon={
                                hasSources ? (
                                  <ChevronRight
                                    className={clsx(
                                      "size-3.5 transition",
                                      eo && "rotate-90"
                                    )}
                                  />
                                ) : (
                                  <Film className="size-3.5 text-ink-500" />
                                )
                              }
                              onIconClick={
                                hasSources
                                  ? () =>
                                      setExpandedEvents((s) => ({
                                        ...s,
                                        [ek]: !eo,
                                      }))
                                  : undefined
                              }
                              label={e.event}
                              count={e.count}
                              dense
                              selected={isSelected({
                                kind: "folder-event",
                                day: d.day,
                                event: e.event,
                              })}
                              onClick={() =>
                                setSelection({
                                  kind: "folder-event",
                                  day: d.day,
                                  event: e.event,
                                })
                              }
                            />
                            {eo && hasSources && (
                              <div className="ml-3 border-l border-ink-800 pl-2 mt-0.5 space-y-0.5">
                                {e.sources.map((s) => (
                                  <Row
                                    key={s.source}
                                    icon={<Film className="size-3.5 text-ink-500" />}
                                    label={s.source}
                                    count={s.count}
                                    dense
                                    selected={isSelected({
                                      kind: "folder-source",
                                      day: d.day,
                                      event: e.event,
                                      source: s.source,
                                    })}
                                    onClick={() =>
                                      setSelection({
                                        kind: "folder-source",
                                        day: d.day,
                                        event: e.event,
                                        source: s.source,
                                      })
                                    }
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        )}
      </div>

      <div className="px-4 py-3 border-t border-ink-800 text-[11px] text-ink-400">
        Last scan{" "}
        {meta?.lastScanAt
          ? new Date(meta.lastScanAt).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "short",
            })
          : "—"}
      </div>
    </aside>
  );
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      {title && (
        <div className="flex items-center gap-1.5 px-3 mb-1.5 text-[10px] uppercase tracking-[0.15em] text-ink-500">
          {icon}
          <span className="flex-1">{title}</span>
          {action}
        </div>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({
  icon,
  onIconClick,
  label,
  count,
  selected,
  onClick,
  dense,
  tone,
  disabled,
  suffix,
}: {
  icon?: React.ReactNode;
  onIconClick?: () => void;
  label: string;
  count?: number;
  selected?: boolean;
  onClick?: () => void;
  dense?: boolean;
  tone?: "accent" | "sage";
  disabled?: boolean;
  suffix?: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "group flex items-center gap-2 rounded-md transition cursor-pointer select-none",
        dense ? "px-2 py-1" : "px-2.5 py-1.5",
        selected
          ? "bg-ink-800 text-ink-50"
          : "text-ink-200 hover:bg-ink-800/60 hover:text-ink-50",
        disabled && "opacity-40 pointer-events-none"
      )}
      onClick={onClick}
    >
      {icon &&
        (onIconClick ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIconClick();
            }}
            className="size-5 -ml-0.5 rounded hover:bg-ink-700/70 text-ink-300 hover:text-ink-50 flex items-center justify-center shrink-0"
          >
            {icon}
          </button>
        ) : (
          <span className="text-ink-300 shrink-0">{icon}</span>
        ))}
      <span className={clsx("flex-1 truncate text-sm", dense && "text-[13px]")}>
        {label}
      </span>
      {suffix}
      {count !== undefined && (
        <span
          className={clsx(
            "text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0",
            tone === "accent"
              ? "bg-accent-400/20 text-accent-300"
              : tone === "sage"
              ? "bg-sage-500/20 text-sage-400"
              : selected
              ? "bg-ink-700 text-ink-50"
              : "bg-ink-800 text-ink-300"
          )}
        >
          {count}
        </span>
      )}
    </div>
  );
}

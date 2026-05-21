import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Check,
  CheckCheck,
  CircleSlash,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useStore } from "../../state/store";
import { SearchableSelect } from "../SearchableSelect";
import { clipsMatchingGroup, sortClips } from "./BoardNode";
import { GroupSortMenu } from "./GroupSortMenu";
import { fmtBytes, fmtDuration } from "../../lib/format";
import { useHoverPreview } from "../../lib/useHoverPreview";
import { useLocalStorage } from "../../lib/useLocalStorage";
import type { BoardGroupSort, Clip } from "../../types";

interface Props {
  // null = creating new, string = editing existing
  beatId: string | null;
  onClose: () => void;
}

const DRAG_THRESHOLD_PX = 6;

export function BeatEditor({ beatId, onClose }: Props) {
  const {
    boardNodes,
    levels,
    levelValues,
    clips,
    currentBoardId,
    createBeat,
    updateBoardNode,
    deleteBoardNodes,
    addValue,
    pushBoardHistory,
  } = useStore();

  const existing = beatId ? boardNodes[beatId] : null;
  const isExisting =
    existing != null && existing.kind === "group" ? existing : null;

  const [name, setName] = useState(isExisting?.label ?? "");
  const [tags, setTags] = useState<Record<string, string>>(
    isExisting?.tags ?? {}
  );
  const [excluded, setExcluded] = useState<Set<string>>(
    new Set(isExisting?.excludedClipIds ?? [])
  );
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<BoardGroupSort>(
    isExisting?.sort ?? "name-asc"
  );
  const [isFullscreen, setIsFullscreen] = useLocalStorage(
    "storytime.beatEditor.fullscreen",
    false
  );

  useEffect(() => {
    setName(isExisting?.label ?? "");
    setTags(isExisting?.tags ?? {});
    setExcluded(new Set(isExisting?.excludedClipIds ?? []));
    setQ("");
    setSort(isExisting?.sort ?? "name-asc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatId]);

  const sortedLevels = useMemo(
    () => Object.values(levels).sort((a, b) => a.order - b.order),
    [levels]
  );

  const matching = useMemo(() => {
    let arr = clipsMatchingGroup(clips, tags);
    if (q.trim()) {
      const needle = q.toLowerCase();
      arr = arr.filter((c) => c.name.toLowerCase().includes(needle));
    }
    return sortClips(arr, sort);
  }, [clips, tags, q, sort]);

  const includedCount = useMemo(
    () => matching.filter((c) => !excluded.has(c.id)).length,
    [matching, excluded]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement
        )
          return;
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    const cleanName = name.trim() || "Untitled beat";
    const cleanTags = Object.fromEntries(
      Object.entries(tags).filter(([, v]) => Boolean(v))
    );
    const cleanExcluded = [...excluded];
    if (isExisting) {
      pushBoardHistory();
      updateBoardNode(isExisting.id, {
        label: cleanName,
        tags: cleanTags,
        excludedClipIds: cleanExcluded,
        sort,
      });
    } else {
      if (!currentBoardId) return;
      const b = createBeat(currentBoardId, {
        label: cleanName,
        tags: cleanTags,
        excludedClipIds: cleanExcluded,
      });
      if (sort !== "name-asc") updateBoardNode(b.id, { sort });
    }
    onClose();
  }

  function del() {
    if (!isExisting) return;
    if (!confirm(`Delete beat "${isExisting.label}"?`)) return;
    deleteBoardNodes([isExisting.id]);
    onClose();
  }

  function toggleExcludeOne(clipId: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
  }

  function selectAllMatching() {
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const c of matching) next.delete(c.id);
      return next;
    });
  }
  function deselectAllMatching() {
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const c of matching) next.add(c.id);
      return next;
    });
  }

  // iOS-style slide-to-toggle. Mouse-down on a clip then drag across others
  // toggles each in the same direction (include or exclude based on the
  // first clip's initial state).
  const dragMode = useRef<"include" | "exclude" | null>(null);
  const draggedIdsRef = useRef<Set<string>>(new Set());
  const suppressClickRef = useRef(false);

  function setClipExcluded(clipId: string, shouldBeExcluded: boolean) {
    setExcluded((prev) => {
      const isExc = prev.has(clipId);
      if (isExc === shouldBeExcluded) return prev;
      const next = new Set(prev);
      if (shouldBeExcluded) next.add(clipId);
      else next.delete(clipId);
      return next;
    });
  }

  function onClipPointerDown(e: React.PointerEvent, clipId: string) {
    if (e.button !== 0) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startExcluded = excluded.has(clipId);
    let started = false;

    const onMove = (ev: PointerEvent) => {
      if (started) return;
      if (
        Math.abs(ev.clientX - startX) > DRAG_THRESHOLD_PX ||
        Math.abs(ev.clientY - startY) > DRAG_THRESHOLD_PX
      ) {
        started = true;
        // If start clip was included (not excluded), drag will EXCLUDE.
        // If start clip was excluded, drag will INCLUDE.
        dragMode.current = startExcluded ? "include" : "exclude";
        draggedIdsRef.current = new Set();
        // Apply to the start clip too
        applyDragToClip(clipId);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (started) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      dragMode.current = null;
      draggedIdsRef.current = new Set();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function applyDragToClip(clipId: string) {
    if (dragMode.current === null) return;
    if (draggedIdsRef.current.has(clipId)) return;
    draggedIdsRef.current.add(clipId);
    setClipExcluded(clipId, dragMode.current === "exclude");
  }

  function onClipPointerEnter(clipId: string) {
    if (dragMode.current === null) return;
    applyDragToClip(clipId);
  }

  function onClipClick(clipId: string) {
    if (suppressClickRef.current) return;
    toggleExcludeOne(clipId);
  }

  const allVisibleIncluded =
    matching.length > 0 && matching.every((c) => !excluded.has(c.id));
  const allVisibleExcluded =
    matching.length > 0 && matching.every((c) => excluded.has(c.id));

  return (
    <div
      className={clsx(
        "fixed inset-0 z-50 bg-ink-950/85 backdrop-blur-sm flex items-center justify-center fade-in",
        !isFullscreen && "p-6"
      )}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "flex flex-col bg-ink-900 shadow-2xl shadow-ink-950/80 overflow-hidden pop-in",
          isFullscreen
            ? "w-full h-full"
            : "w-[1080px] max-w-[96vw] max-h-[88vh] rounded-2xl border border-ink-700"
        )}
      >
        <header className="px-5 py-4 border-b border-ink-800 flex items-center gap-3">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-ink-400">
              {isExisting ? "Edit beat" : "New beat"}
            </div>
            <div className="text-sm text-ink-300 leading-snug">
              A beat shows every clip matching the tag filter, minus the ones
              you exclude.
            </div>
          </div>
          <button
            onClick={() => setIsFullscreen((f) => !f)}
            className="size-8 rounded-md hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center"
            title={isFullscreen ? "Restore size" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </button>
          <button
            onClick={onClose}
            className="size-8 rounded-md hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center"
            title="Close (Esc)"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex">
          {/* LEFT — metadata */}
          <div className="w-80 shrink-0 border-r border-ink-800 overflow-y-auto px-5 py-4 space-y-5 bg-ink-900/40">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-1">
                Name
              </div>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. flying, gala afterparty…"
                className="w-full h-10 px-3 rounded-lg bg-ink-850 border border-ink-700 focus:border-accent-400 text-sm text-ink-50 placeholder:text-ink-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
                }}
              />
            </div>

            {sortedLevels.length === 0 ? (
              <div className="text-xs text-ink-400 leading-relaxed">
                No hierarchy levels yet. Add some in the sidebar's Hierarchy
                section, then come back.
              </div>
            ) : (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-1.5">
                  Filter
                </div>
                <div className="text-[11px] text-ink-500 mb-2 leading-snug">
                  Leave a level blank to ignore it.
                </div>
                <div className="space-y-2">
                  {sortedLevels.map((l) => {
                    const values = Object.values(levelValues)
                      .filter((v) => v.levelId === l.id)
                      .sort((a, b) => a.order - b.order);
                    const current = tags[l.id] ?? null;
                    return (
                      <div key={l.id}>
                        <div className="text-[11px] text-ink-400 mb-0.5 ml-1">
                          {l.name}
                        </div>
                        <SearchableSelect
                          value={current}
                          placeholder={`Any ${l.name.toLowerCase()}`}
                          options={values.map((v) => ({
                            id: v.id,
                            label: v.name,
                            color: v.color,
                          }))}
                          emptyLabel={`No ${l.name.toLowerCase()} values yet`}
                          onCreate={(n) => {
                            const v = addValue(l.id, n);
                            setTags((t) => ({ ...t, [l.id]: v.id }));
                            return v.id;
                          }}
                          createLabel={`Create ${l.name.toLowerCase()}`}
                          onChange={(vid) => {
                            setTags((t) => {
                              const next = { ...t };
                              if (vid) next[l.id] = vid;
                              else delete next[l.id];
                              return next;
                            });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — preview */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-5 py-3 border-b border-ink-800 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-ink-400">
                  Preview
                </div>
                <div className="text-sm text-ink-100">
                  <span className="font-mono text-ink-50">{includedCount}</span>{" "}
                  included
                  {excluded.size > 0 ? (
                    <>
                      {" · "}
                      <span className="font-mono text-rose-500/80">
                        {excluded.size}
                      </span>{" "}
                      excluded
                    </>
                  ) : null}
                </div>
              </div>
              <div className="relative w-56">
                <Search className="size-3.5 text-ink-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter by name"
                  className="w-full h-8 pl-8 pr-2 rounded bg-ink-850 border border-ink-700 focus:border-accent-400 text-[12px] text-ink-100 placeholder:text-ink-500"
                />
              </div>
              <GroupSortMenu value={sort} onChange={setSort} />
              <button
                onClick={selectAllMatching}
                disabled={matching.length === 0 || allVisibleIncluded}
                className="h-8 px-2.5 rounded-md border border-ink-700 hover:border-ink-600 text-ink-200 hover:text-ink-50 text-[12px] inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="Include all visible"
              >
                <CheckCheck className="size-3.5" />
                Select all
              </button>
              <button
                onClick={deselectAllMatching}
                disabled={matching.length === 0 || allVisibleExcluded}
                className="h-8 px-2.5 rounded-md border border-ink-700 hover:border-ink-600 text-ink-200 hover:text-ink-50 text-[12px] inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="Exclude all visible"
              >
                <CircleSlash className="size-3.5" />
                Deselect all
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
              {matching.length === 0 ? (
                <div className="h-full flex items-center justify-center text-ink-400 text-xs text-center px-6">
                  {q
                    ? "No matches for your search."
                    : "Adjust the filter on the left, or leave everything blank to see all clips."}
                </div>
              ) : (
                <div
                  className={clsx(
                    "grid gap-2 select-none",
                    isFullscreen
                      ? "grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
                      : "grid-cols-[repeat(auto-fill,minmax(130px,1fr))]"
                  )}
                >
                  {matching.map((c) => (
                    <BeatTile
                      key={c.id}
                      clip={c}
                      excluded={excluded.has(c.id)}
                      onPointerDown={(e) => onClipPointerDown(e, c.id)}
                      onPointerEnter={() => onClipPointerEnter(c.id)}
                      onClick={() => onClipClick(c.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-ink-800 flex items-center gap-2">
          {isExisting && (
            <button
              onClick={del}
              className="h-9 px-3 rounded-lg border border-rose-500/40 hover:bg-rose-500/10 text-rose-500 text-sm inline-flex items-center gap-1.5 transition"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-ink-700 hover:border-ink-600 text-ink-200 hover:text-ink-50 text-sm transition"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!name.trim()}
            className="h-9 px-4 rounded-lg bg-accent-400 hover:bg-accent-300 disabled:opacity-40 disabled:cursor-not-allowed text-ink-950 font-medium text-sm inline-flex items-center gap-1.5 transition"
          >
            <Check className="size-3.5" />
            {isExisting ? "Save" : "Create beat"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function BeatTile({
  clip,
  excluded,
  onPointerDown,
  onPointerEnter,
  onClick,
}: {
  clip: Clip;
  excluded: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerEnter: () => void;
  onClick: () => void;
}) {
  const hover = useHoverPreview(clip.id);

  return (
    <button
      onPointerDown={onPointerDown}
      onPointerEnter={() => {
        onPointerEnter();
        hover.onMouseEnter();
      }}
      onMouseLeave={hover.onMouseLeave}
      onClick={onClick}
      className={clsx(
        "group relative aspect-video rounded-md overflow-hidden border-2 transition text-left",
        excluded
          ? "border-rose-500/60"
          : "border-transparent hover:border-ink-600"
      )}
      title={excluded ? "Click to include" : "Click to exclude"}
    >
      {clip.thumb ? (
        <img
          src={clip.thumb}
          alt=""
          draggable={false}
          className={clsx(
            "size-full object-cover pointer-events-none",
            excluded && "opacity-30 grayscale"
          )}
        />
      ) : (
        <div className="size-full shimmer" />
      )}
      <video
        ref={hover.videoRef}
        muted
        playsInline
        loop
        preload="none"
        className={clsx(
          "absolute inset-0 size-full object-cover pointer-events-none transition-opacity duration-200",
          hover.hoverPlaying && !excluded ? "opacity-100" : "opacity-0",
          excluded && "grayscale opacity-30"
        )}
      />
      <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-ink-950/90 to-transparent text-[10px] text-ink-50 truncate pointer-events-none">
        {clip.name}
      </div>
      <div className="absolute top-1 right-1 pointer-events-none">
        <span
          className={clsx(
            "size-5 rounded-full flex items-center justify-center transition",
            excluded
              ? "bg-rose-500 text-ink-50"
              : "bg-ink-950/60 text-ink-100 opacity-0 group-hover:opacity-100"
          )}
        >
          {excluded ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        </span>
      </div>
      {!excluded && (
        <div className="absolute top-1 left-1 text-[9px] font-mono text-ink-300/80 pointer-events-none">
          {fmtDuration(clip.durationMs)} · {fmtBytes(clip.size)}
        </div>
      )}
    </button>
  );
}

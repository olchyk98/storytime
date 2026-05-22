import { memo, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Film, Sparkles } from "lucide-react";
import type { Clip } from "../types";
import { useStore } from "../state/store";
import { fmtBytes, fmtDuration, fmtLongDate } from "../lib/format";
import { setActiveHover, subscribeHover } from "../lib/hoverPreview";
import { useDragSelect } from "../lib/useDragSelect";

const HOVER_DELAY_MS = 220;

export const ClipCard = memo(function ClipCard({
  clip,
  onOpen,
}: {
  clip: Clip;
  onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  // Scoped selectors so unrelated state changes don't re-render this card.
  // The crucial one is `isSelected`: per-card boolean means the only cards
  // that re-render on a selection update are the ones whose membership flipped.
  const enqueueThumbs = useStore((s) => s.enqueueThumbs);
  const getClipFile = useStore((s) => s.getClipFile);
  const levels = useStore((s) => s.levels);
  const levelValues = useStore((s) => s.levelValues);
  const toggleClipSelected = useStore((s) => s.toggleClipSelected);
  const selectRangeTo = useStore((s) => s.selectRangeTo);
  const isSelected = useStore((s) => s.selectedClipIds.has(clip.id));
  const [hoverPlaying, setHoverPlaying] = useState(false);
  const drag = useDragSelect(clip.id);

  function handleOpen() {
    onOpen(clip.id);
  }

  const ext = clip.name.includes(".")
    ? clip.name.slice(clip.name.lastIndexOf(".") + 1).toUpperCase()
    : "FILE";

  const tagChips = useMemo(() => {
    if (!clip.tags) return [];
    const out: { levelName: string; valueName: string; color: string }[] = [];
    for (const [lid, vid] of Object.entries(clip.tags)) {
      const l = levels[lid];
      const v = levelValues[vid];
      if (!l || !v) continue;
      out.push({ levelName: l.name, valueName: v.name, color: v.color });
    }
    out.sort((a, b) => a.levelName.localeCompare(b.levelName));
    return out;
  }, [clip.tags, levels, levelValues]);

  useEffect(() => {
    if (clip.thumb || clip.thumbFailed) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            enqueueThumbs([clip.id]);
            io.disconnect();
          }
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [clip.id, clip.thumb, clip.thumbFailed, enqueueThumbs]);

  function teardownHover() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setHoverPlaying(false);
  }

  useEffect(() => {
    return subscribeHover((activeId) => {
      if (activeId !== clip.id) teardownHover();
    });
  }, [clip.id]);

  useEffect(() => () => teardownHover(), []);

  function onMouseEnter() {
    drag.onMouseEnter();
    if (useStore.getState().dragSelecting) return;
    if (clip.thumbFailed) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(async () => {
      setActiveHover(clip.id);
      const file = await getClipFile(clip.id);
      if (!file) return;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      const v = videoRef.current;
      if (!v) {
        URL.revokeObjectURL(url);
        objectUrlRef.current = null;
        return;
      }
      v.src = url;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      try {
        await v.play();
        setHoverPlaying(true);
      } catch {}
    }, HOVER_DELAY_MS);
  }

  function onMouseLeave() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    teardownHover();
    setActiveHover(null);
  }

  function handleClick(e: React.MouseEvent) {
    if (drag.suppressClickRef.current) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      selectRangeTo(clip.id);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleClipSelected(clip.id);
      return;
    }
    handleOpen();
  }

  function handleCheckboxClick(e: React.MouseEvent) {
    e.stopPropagation();
    toggleClipSelected(clip.id);
  }

  return (
    <div
      ref={ref}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        // Lets the browser skip layout/paint for offscreen cards until they
        // scroll into view. The intrinsic size keeps the grid layout stable.
        contentVisibility: "auto",
        containIntrinsicSize: "280px 240px",
      }}
      className={clsx(
        "group relative rounded-xl bg-ink-900 border overflow-hidden transition pop-in",
        isSelected
          ? "border-accent-400 ring-2 ring-accent-400/40"
          : "border-ink-800 hover:border-ink-700"
      )}
    >
      <div
        onMouseDown={drag.onMouseDown}
        onClick={handleClick}
        className="block w-full relative aspect-video bg-ink-950 overflow-hidden cursor-pointer select-none"
        title={clip.name}
      >
        {clip.thumb ? (
          <img
            src={clip.thumb}
            alt=""
            className={clsx(
              "size-full object-cover transition duration-500",
              isSelected ? "" : "group-hover:scale-[1.03]"
            )}
            loading="lazy"
          />
        ) : clip.thumbFailed ? (
          <div className="size-full bg-gradient-to-br from-ink-900 to-ink-800 flex flex-col items-center justify-center gap-1.5">
            <Film className="size-6 text-ink-500" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
              {ext}
            </span>
          </div>
        ) : (
          <div className="size-full shimmer flex items-center justify-center">
            <Film className="size-6 text-ink-700" />
          </div>
        )}

        <video
          ref={videoRef}
          muted
          playsInline
          loop
          preload="none"
          className={clsx(
            "absolute inset-0 size-full object-cover transition-opacity duration-200 pointer-events-none",
            hoverPlaying ? "opacity-100" : "opacity-0"
          )}
        />

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/95 via-ink-950/40 to-transparent p-2 flex items-end justify-between pointer-events-none">
          {clip.durationMs ? (
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-ink-950/80 backdrop-blur text-ink-50">
              {fmtDuration(clip.durationMs)}
            </span>
          ) : (
            <span />
          )}
          {clip.width ? (
            <span className="text-[10px] font-mono text-ink-100">
              {clip.width}×{clip.height}
            </span>
          ) : null}
        </div>

        {clip.isNew && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent-400 text-ink-950 pointer-events-none">
            <Sparkles className="size-3" />
            new
          </span>
        )}

        <button
          onClick={handleCheckboxClick}
          className={clsx(
            "absolute top-2 right-2 size-6 rounded-md border-2 flex items-center justify-center transition",
            isSelected
              ? "bg-accent-400 border-accent-400 text-ink-950"
              : "bg-ink-950/60 border-ink-50/40 hover:border-ink-50 text-transparent opacity-0 group-hover:opacity-100"
          )}
          title={isSelected ? "Deselect" : "Select"}
        >
          {isSelected && <Check className="size-4" strokeWidth={3} />}
        </button>
      </div>

      <div className="p-2.5">
        <div className="text-[13px] font-medium text-ink-50 truncate" title={clip.name}>
          {clip.name}
        </div>
        <div className="text-[11px] text-ink-300 mt-0.5 truncate">
          <span className="text-ink-400">{fmtBytes(clip.size)}</span>
          <span className="text-ink-500"> · {fmtLongDate(clip.lastModified)}</span>
        </div>
        {tagChips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
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
      </div>
    </div>
  );
});

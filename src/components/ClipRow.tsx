import { memo, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Film, Sparkles } from "lucide-react";
import type { Clip } from "../types";
import { useStore } from "../state/store";
import { fmtBytes, fmtDuration } from "../lib/format";
import { setActiveHover, subscribeHover } from "../lib/hoverPreview";
import { useDragSelect } from "../lib/useDragSelect";

const HOVER_DELAY_MS = 220;

export const ClipRow = memo(function ClipRow({
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
      onMouseDown={drag.onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={handleClick}
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: "100% 72px",
      }}
      className={clsx(
        "group flex items-center gap-3 px-3 py-2 rounded-lg border transition cursor-pointer pop-in select-none",
        isSelected
          ? "border-accent-400 bg-accent-400/10 ring-1 ring-accent-400/40"
          : "border-ink-800 hover:border-ink-700 bg-ink-900/60 hover:bg-ink-900"
      )}
    >
      <button
        onClick={handleCheckboxClick}
        className={clsx(
          "size-5 rounded border-2 shrink-0 flex items-center justify-center transition",
          isSelected
            ? "bg-accent-400 border-accent-400 text-ink-950"
            : "border-ink-700 hover:border-ink-50 text-transparent group-hover:border-ink-500"
        )}
        title={isSelected ? "Deselect" : "Select"}
      >
        {isSelected && <Check className="size-3.5" strokeWidth={3} />}
      </button>

      <div className="relative w-28 aspect-video rounded-md overflow-hidden bg-ink-950 shrink-0">
        {clip.thumb ? (
          <img src={clip.thumb} alt="" className="size-full object-cover" />
        ) : clip.thumbFailed ? (
          <div className="size-full bg-gradient-to-br from-ink-900 to-ink-800 flex flex-col items-center justify-center gap-0.5">
            <Film className="size-4 text-ink-500" />
            <span className="text-[9px] font-mono uppercase tracking-widest text-ink-400">
              {ext}
            </span>
          </div>
        ) : (
          <div className="size-full shimmer" />
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
        {clip.durationMs ? (
          <span className="absolute bottom-1 right-1 text-[10px] font-mono px-1 py-0.5 rounded bg-ink-950/80 text-ink-50">
            {fmtDuration(clip.durationMs)}
          </span>
        ) : null}
        {clip.isNew && (
          <span className="absolute top-1 left-1 inline-flex items-center text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-accent-400 text-ink-950">
            <Sparkles className="size-2.5" />
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-50 truncate" title={clip.name}>
          {clip.name}
        </div>
        <div className="text-[11px] text-ink-300 mt-0.5 truncate">
          {clip.width ? (
            <span className="text-ink-400">{clip.width}×{clip.height}</span>
          ) : null}
        </div>
        {tagChips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
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

      <div className="text-right shrink-0 hidden sm:block">
        <div className="text-[11px] font-mono text-ink-100">{fmtBytes(clip.size)}</div>
        <div className="text-[10px] text-ink-400">
          {new Date(clip.lastModified).toLocaleDateString(undefined, {
            year: "2-digit",
            month: "short",
            day: "numeric",
          })}
        </div>
      </div>
    </div>
  );
});

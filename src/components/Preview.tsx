import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useStore } from "../state/store";
import { fmtBytes, fmtDuration } from "../lib/format";
import { SearchableSelect } from "./SearchableSelect";

export function Preview() {
  const {
    previewClipId,
    clips,
    closePreview,
    steppingPreview,
    getClipFile,
    levels,
    levelValues,
    tagClips,
    addValue,
  } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const videoRef = (el: HTMLVideoElement | null) => setVideoEl(el);
  const [src, setSrc] = useState<string | null>(null);
  const clip = previewClipId ? clips[previewClipId] : undefined;

  useEffect(() => {
    if (!clip) {
      setSrc(null);
      return;
    }
    let active = true;
    let url: string | null = null;
    (async () => {
      const file = await getClipFile(clip.id);
      if (!active) return;
      if (file) {
        url = URL.createObjectURL(file);
        setSrc(url);
      } else setSrc(null);
    })();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [clip?.id]);

  useEffect(() => {
    if (!clip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)
        return;
      if (e.key === "Escape") closePreview();
      else if (e.key === "ArrowRight") steppingPreview(1);
      else if (e.key === "ArrowLeft") steppingPreview(-1);
      else if (e.key === " ") {
        e.preventDefault();
        if (videoEl) videoEl.paused ? videoEl.play() : videoEl.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clip, closePreview, steppingPreview, videoEl]);

  if (!clip) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[60] bg-ink-950/95 backdrop-blur-sm flex flex-col fade-in"
    >
      <div className="flex items-center gap-3 px-5 py-3 border-b border-ink-800">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink-400">
            {[clip.day, clip.event, clip.source].filter((s) => s !== "_").join(" / ")}
          </div>
          <div className="font-medium text-ink-50 truncate">{clip.name}</div>
        </div>
        <div className="text-xs font-mono text-ink-300 flex items-center gap-3">
          {clip.width ? <span>{clip.width}×{clip.height}</span> : null}
          <span>{fmtBytes(clip.size)}</span>
          <span>{fmtDuration(clip.durationMs)}</span>
        </div>
        <button
          onClick={closePreview}
          className="size-9 rounded-md hover:bg-ink-800 text-ink-200 hover:text-ink-50 flex items-center justify-center"
          title="Close (Esc)"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 grid grid-cols-[1fr_320px] min-h-0">
        <div className="relative bg-ink-950 flex items-center justify-center min-h-0">
          {src ? (
            <video
              ref={videoRef}
              src={src}
              autoPlay
              loop
              playsInline
              onClick={() => {
                if (videoEl) videoEl.paused ? videoEl.play() : videoEl.pause();
              }}
              className="max-w-full max-h-full cursor-pointer"
            />
          ) : (
            <div className="text-ink-400 text-sm">Loading video…</div>
          )}
          <button
            onClick={() => steppingPreview(-1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 size-10 rounded-full bg-ink-900/80 hover:bg-ink-800 text-ink-50 backdrop-blur flex items-center justify-center"
            title="Previous (←)"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            onClick={() => steppingPreview(1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 size-10 rounded-full bg-ink-900/80 hover:bg-ink-800 text-ink-50 backdrop-blur flex items-center justify-center"
            title="Next (→)"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        <PreviewSidebar
          clip={clip}
          levels={levels}
          levelValues={levelValues}
          onTag={(levelId, valueId) => tagClips([clip.id], levelId, valueId)}
          onCreate={(levelId, name) => {
            const v = addValue(levelId, name);
            tagClips([clip.id], levelId, v.id);
            return v.id;
          }}
        />
      </div>

      {src && videoEl ? (
        <PlayerControls
          src={src}
          video={videoEl}
          container={containerRef.current}
        />
      ) : (
        <div className="h-[58px] border-t border-ink-800 bg-ink-900" />
      )}
    </div>
  );
}

function PreviewSidebar({
  clip,
  levels,
  levelValues,
  onTag,
  onCreate,
}: {
  clip: { id: string; path: string[]; tags?: Record<string, string> };
  levels: Record<string, { id: string; name: string; order: number }>;
  levelValues: Record<
    string,
    { id: string; levelId: string; name: string; color: string; order: number }
  >;
  onTag: (levelId: string, valueId: string | null) => void;
  onCreate: (levelId: string, name: string) => string;
}) {
  const sortedLevels = useMemo(
    () => Object.values(levels).sort((a, b) => a.order - b.order),
    [levels]
  );

  return (
    <aside className="border-l border-ink-800 bg-ink-900/60 overflow-y-auto p-5 space-y-5">
      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-ink-400 mb-2">
          Tags
        </div>
        {sortedLevels.length === 0 ? (
          <div className="text-xs text-ink-400 leading-relaxed">
            No levels configured yet. Open the hierarchy manager in the sidebar.
          </div>
        ) : (
          <div className="space-y-2.5">
            {sortedLevels.map((l) => {
              const values = Object.values(levelValues)
                .filter((v) => v.levelId === l.id)
                .sort((a, b) => a.order - b.order);
              const current = clip.tags?.[l.id] ?? null;
              return (
                <div key={l.id}>
                  <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-1">
                    {l.name}
                  </div>
                  <SearchableSelect
                    value={current}
                    placeholder={`Pick ${l.name.toLowerCase()}…`}
                    emptyLabel="No values yet"
                    options={values.map((v) => ({
                      id: v.id,
                      label: v.name,
                      color: v.color,
                    }))}
                    onChange={(valueId) => onTag(l.id, valueId)}
                    onCreate={(name) => onCreate(l.id, name)}
                    createLabel={`Create ${l.name.toLowerCase()}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-ink-400 mb-1.5">
          Path
        </div>
        <div className="text-[11px] font-mono text-ink-300 break-all leading-snug">
          {clip.path.join(" / ")}
        </div>
      </div>
    </aside>
  );
}

function PlayerControls({
  src,
  video,
  container,
}: {
  src: string;
  video: HTMLVideoElement;
  container: HTMLDivElement | null;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastSeekAt = useRef(0);
  const pendingSeek = useRef<number | null>(null);

  const [playing, setPlaying] = useState(!video.paused);
  const [duration, setDuration] = useState(isFinite(video.duration) ? video.duration : 0);
  const [currentTime, setCurrentTime] = useState(video.currentTime);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(video.muted);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [shadowReady, setShadowReady] = useState(false);

  useEffect(() => {
    const onTime = () => setCurrentTime(video.currentTime);
    const onMeta = () => setDuration(isFinite(video.duration) ? video.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("durationchange", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("progress", onProgress);
    onMeta();
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("progress", onProgress);
    };
  }, [video]);

  useEffect(() => {
    const onFs = () =>
      setIsFullscreen(document.fullscreenElement === container);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [container]);

  function timeAtClientX(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return 0;
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return pct * duration;
  }

  async function previewAt(t: number) {
    const shadow = shadowRef.current;
    const canvas = canvasRef.current;
    if (!shadow || !canvas || !shadowReady) return;

    const now = performance.now();
    if (now - lastSeekAt.current < 80) {
      pendingSeek.current = t;
      return;
    }
    lastSeekAt.current = now;

    try {
      shadow.currentTime = t;
      await new Promise<void>((resolve, reject) => {
        const onSeek = () => {
          shadow.removeEventListener("seeked", onSeek);
          shadow.removeEventListener("error", onErr);
          resolve();
        };
        const onErr = () => {
          shadow.removeEventListener("seeked", onSeek);
          shadow.removeEventListener("error", onErr);
          reject();
        };
        shadow.addEventListener("seeked", onSeek);
        shadow.addEventListener("error", onErr);
      });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(shadow, 0, 0, canvas.width, canvas.height);
      setPreviewUrl(canvas.toDataURL("image/jpeg", 0.55));
    } catch {}

    if (pendingSeek.current !== null && pendingSeek.current !== t) {
      const next = pendingSeek.current;
      pendingSeek.current = null;
      previewAt(next);
    }
  }

  function onTrackMove(e: React.MouseEvent) {
    const rect = trackRef.current!.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverPct(pct);
    previewAt(pct * duration);
  }
  function onTrackLeave() {
    setHoverPct(null);
    setPreviewUrl(null);
    pendingSeek.current = null;
  }
  function onTrackClick(e: React.MouseEvent) {
    video.currentTime = timeAtClientX(e.clientX);
  }

  function toggleFullscreen() {
    if (!container) return;
    if (document.fullscreenElement === container) document.exitFullscreen();
    else container.requestFullscreen();
  }

  const playedPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div className="px-5 py-2.5 bg-ink-900 border-t border-ink-800 flex items-center gap-4 shrink-0">
      <button
        onClick={() => (video.paused ? video.play() : video.pause())}
        className="size-9 rounded-md hover:bg-ink-800 text-ink-50 flex items-center justify-center transition"
        title={playing ? "Pause (Space)" : "Play (Space)"}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>

      <span className="text-xs font-mono text-ink-200 tabular-nums w-14 text-right">
        {fmtDuration(currentTime * 1000)}
      </span>

      <div
        className="flex-1 relative h-6 flex items-center cursor-pointer group"
        onMouseMove={onTrackMove}
        onMouseLeave={onTrackLeave}
        onClick={onTrackClick}
      >
        <div
          ref={trackRef}
          className="absolute inset-x-0 h-1.5 group-hover:h-2 rounded-full bg-ink-800 overflow-hidden transition-all"
        >
          <div
            className="absolute inset-y-0 left-0 bg-ink-700"
            style={{ width: `${bufPct}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 bg-accent-400"
            style={{ width: `${playedPct}%` }}
          />
        </div>

        <div
          className="absolute size-3 rounded-full bg-ink-50 shadow border border-ink-900 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition pointer-events-none"
          style={{ left: `${playedPct}%` }}
        />

        <video
          ref={shadowRef}
          src={src}
          muted
          preload="auto"
          playsInline
          onLoadedData={() => setShadowReady(true)}
          className="hidden"
        />
        <canvas ref={canvasRef} width={360} height={202} className="hidden" />

        {hoverPct !== null && (
          <div
            className="absolute bottom-7 -translate-x-1/2 pointer-events-none z-10"
            style={{
              left: `clamp(120px, ${hoverPct * 100}%, calc(100% - 120px))`,
            }}
          >
            <div className="bg-ink-850 border border-ink-700 rounded-lg overflow-hidden shadow-xl shadow-ink-950/70">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  className="w-60 h-[135px] object-cover block"
                  alt=""
                />
              ) : (
                <div className="w-60 h-[135px] bg-ink-800 flex items-center justify-center text-[11px] text-ink-500">
                  {shadowReady ? "…" : "loading"}
                </div>
              )}
              <div className="text-center text-xs font-mono tabular-nums py-1 text-ink-100 bg-ink-900">
                {fmtDuration(hoverPct * duration * 1000)}
              </div>
            </div>
          </div>
        )}
      </div>

      <span className="text-xs font-mono text-ink-200 tabular-nums w-14">
        {fmtDuration(duration * 1000)}
      </span>

      <button
        onClick={() => {
          video.muted = !video.muted;
          setMuted(video.muted);
        }}
        className="size-9 rounded-md hover:bg-ink-800 text-ink-200 hover:text-ink-50 flex items-center justify-center transition"
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>

      <button
        onClick={toggleFullscreen}
        className={clsx(
          "size-9 rounded-md hover:bg-ink-800 flex items-center justify-center transition",
          isFullscreen ? "text-accent-300" : "text-ink-200 hover:text-ink-50"
        )}
        title="Fullscreen (F)"
      >
        {isFullscreen ? (
          <Minimize2 className="size-4" />
        ) : (
          <Maximize2 className="size-4" />
        )}
      </button>
    </div>
  );
}

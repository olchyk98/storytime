// Extract a still frame from a video File and return a data URL.
// Seeks to a small offset to avoid black first frames.

const THUMB_W = 320;
const THUMB_H = 180;

// Sample N consecutive frames during a brief play to estimate fps. Uses
// requestVideoFrameCallback (Chromium/Safari) which gives precise mediaTime
// stamps. Returns undefined if rVFC isn't available or sampling failed.
async function detectFps(video: HTMLVideoElement): Promise<number | undefined> {
  type FrameMeta = { mediaTime: number };
  type Cb = (now: number, meta: FrameMeta) => void;
  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: Cb) => number;
  };
  if (typeof v.requestVideoFrameCallback !== "function") return undefined;

  const TARGET_SAMPLES = 6;
  const TIMEOUT_MS = 600;
  const times: number[] = [];

  return new Promise<number | undefined>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      if (times.length < 2) return resolve(undefined);
      const intervals: number[] = [];
      for (let i = 1; i < times.length; i++) {
        const d = times[i] - times[i - 1];
        if (d > 0.001 && d < 1) intervals.push(d);
      }
      if (intervals.length === 0) return resolve(undefined);
      intervals.sort((a, b) => a - b);
      const median = intervals[Math.floor(intervals.length / 2)];
      const fps = 1 / median;
      // Sanity-clamp: 5 fps (low) to 300 fps (slow-mo upper)
      if (fps < 5 || fps > 300) return resolve(undefined);
      resolve(fps);
    };

    const timer = setTimeout(finish, TIMEOUT_MS);
    const cb: Cb = (_now, meta) => {
      times.push(meta.mediaTime);
      if (times.length >= TARGET_SAMPLES) {
        clearTimeout(timer);
        finish();
      } else {
        v.requestVideoFrameCallback!(cb);
      }
    };
    v.requestVideoFrameCallback!(cb);
    video.play().catch(() => {
      clearTimeout(timer);
      finish();
    });
  });
}

// Detect audio presence on a loaded video element. Primary signal:
// video.captureStream() exposes a MediaStream whose audio-track count is
// authoritative (works regardless of muted state). Fallbacks cover older
// browsers. We always return a boolean so callers can persist the result
// and break out of "re-enqueue forever" loops on undecidable clips.
function detectHasAudio(video: HTMLVideoElement): boolean {
  const v = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length: number };
    mozHasAudio?: boolean;
  };
  try {
    if (typeof v.captureStream === "function") {
      const stream = v.captureStream();
      return stream.getAudioTracks().length > 0;
    }
  } catch {
    /* fall through */
  }
  if (typeof v.webkitAudioDecodedByteCount === "number") {
    return v.webkitAudioDecodedByteCount > 0;
  }
  if (v.audioTracks && typeof v.audioTracks.length === "number") {
    return v.audioTracks.length > 0;
  }
  if (typeof v.mozHasAudio === "boolean") return v.mozHasAudio;
  // Truly undetectable — default to "has audio" so FCP doesn't reject
  // relink when the file actually does have audio. Drone-only files will
  // still get the correct false from captureStream.
  return true;
}

export async function extractThumb(file: File): Promise<{
  dataUrl: string;
  durationMs: number;
  width: number;
  height: number;
  fps?: number;
  hasAudio: boolean;
} | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    await new Promise<void>((res, rej) => {
      const onLoaded = () => res();
      const onError = () => rej(new Error("metadata error"));
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    const dur = isFinite(video.duration) ? video.duration : 0;
    const target = Math.min(Math.max(0.4, dur * 0.08), Math.max(0.4, dur - 0.1));

    await new Promise<void>((res, rej) => {
      const onSeek = () => res();
      const onError = () => rej(new Error("seek error"));
      video.addEventListener("seeked", onSeek, { once: true });
      video.addEventListener("error", onError, { once: true });
      try {
        video.currentTime = target;
      } catch {
        res();
      }
    });

    const canvas = document.createElement("canvas");
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const aspect = vw / vh;
    let cw = THUMB_W;
    let ch = Math.round(THUMB_W / aspect);
    if (ch > THUMB_H) {
      ch = THUMB_H;
      cw = Math.round(THUMB_H * aspect);
    }
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, cw, ch);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);

    // Measure fps with a brief play before tearing down. The same play also
    // primes the audio decoder so we can read the audio-byte counter after.
    const fps = await detectFps(video).catch(() => undefined);
    const hasAudio = detectHasAudio(video);

    return {
      dataUrl,
      durationMs: Math.round(dur * 1000),
      width: vw,
      height: vh,
      fps,
      hasAudio,
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

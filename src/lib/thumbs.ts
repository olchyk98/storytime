// Extract a still frame from a video File and return a data URL.
// Seeks to a small offset to avoid black first frames.

const THUMB_W = 320;
const THUMB_H = 180;

export async function extractThumb(file: File): Promise<{
  dataUrl: string;
  durationMs: number;
  width: number;
  height: number;
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

    return {
      dataUrl,
      durationMs: Math.round(dur * 1000),
      width: vw,
      height: vh,
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

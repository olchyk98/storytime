import { useEffect, useRef, useState } from "react";
import { setActiveHover, subscribeHover } from "./hoverPreview";
import { useStore } from "../state/store";

const HOVER_DELAY_MS = 220;

/**
 * Reusable hover-preview machinery for clip thumbnails.
 *
 * After ~220ms hover, fetches the file, creates an object URL, attaches it to
 * the returned videoRef and starts looping muted playback. Coordinated through
 * the hoverPreview singleton so only one tile ever streams at a time. On leave
 * (or when another tile takes over) the video is torn down and the URL revoked.
 */
export function useHoverPreview(clipId: string) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [hoverPlaying, setHoverPlaying] = useState(false);
  const { getClipFile } = useStore();

  function teardown() {
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
      if (activeId !== clipId) teardown();
    });
  }, [clipId]);

  useEffect(() => () => teardown(), []);

  function onMouseEnter() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(async () => {
      setActiveHover(clipId);
      const file = await getClipFile(clipId);
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
    teardown();
    setActiveHover(null);
  }

  return { videoRef, onMouseEnter, onMouseLeave, hoverPlaying };
}

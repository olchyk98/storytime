import { useRef } from "react";
import { useStore } from "../state/store";

const DRAG_THRESHOLD_PX = 6;

/**
 * Mouse-down + drag across clips to select them, like iOS Photos.
 * - Plain left-click + drag past the threshold starts a drag-select.
 * - Each subsequent clip the pointer enters gets added.
 * - Modifier-clicks (shift/cmd/ctrl) and middle/right buttons bypass drag — they fall through
 *   to the host's normal click handler.
 * - When a drag ran, the next click is swallowed so we don't accidentally open preview.
 */
export function useDragSelect(clipId: string) {
  const suppressClickRef = useRef(false);

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const onMove = (ev: PointerEvent) => {
      if (started) return;
      if (
        Math.abs(ev.clientX - startX) > DRAG_THRESHOLD_PX ||
        Math.abs(ev.clientY - startY) > DRAG_THRESHOLD_PX
      ) {
        started = true;
        useStore.getState().beginDragSelect(clipId);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (started) {
        useStore.getState().endDragSelect();
        suppressClickRef.current = true;
        // Click event fires synchronously after mouseup; clear on next tick.
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onMouseEnter() {
    const s = useStore.getState();
    if (s.dragSelecting) s.dragSelectEnter(clipId);
  }

  return { onMouseDown, onMouseEnter, suppressClickRef };
}

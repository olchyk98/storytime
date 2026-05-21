// Singleton coordinator: only one card streams a hover-preview at a time.
type Listener = (activeId: string | null) => void;

let activeId: string | null = null;
const listeners = new Set<Listener>();

export function setActiveHover(id: string | null) {
  if (activeId === id) return;
  activeId = id;
  for (const l of listeners) l(activeId);
}

export function getActiveHover() {
  return activeId;
}

export function subscribeHover(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

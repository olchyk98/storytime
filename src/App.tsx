import { useEffect, useState } from "react";
import { useStore } from "./state/store";
import { Welcome } from "./components/Welcome";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { ClipGrid } from "./components/ClipGrid";
import { Preview } from "./components/Preview";
import { LevelsManager } from "./components/LevelsManager";
import { Board } from "./components/board/Board";
import { GroupModal } from "./components/board/GroupModal";

function App() {
  const {
    init,
    ready,
    meta,
    needsPermission,
    previewClipId,
    viewMode,
    groupModalId,
  } = useStore();
  const [managerOpen, setManagerOpen] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  // Auto-snapshot: debounced takeSnapshot whenever the user-curated state
  // changes. 12s of inactivity → write a rolling backup in IndexedDB.
  useEffect(() => {
    if (!ready) return;
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = window.setTimeout(() => {
        useStore.getState().takeSnapshot().catch(() => {});
        timer = null;
      }, 12000);
    };
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (
        state.clips !== prev.clips ||
        state.levels !== prev.levels ||
        state.levelValues !== prev.levelValues ||
        state.boards !== prev.boards ||
        state.boardNodes !== prev.boardNodes
      ) {
        schedule();
      }
    });
    // Take a baseline snapshot of whatever state we just loaded.
    schedule();
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [ready]);

  if (!ready) {
    return (
      <div className="h-full w-full flex items-center justify-center text-ink-300 text-sm">
        Loading…
      </div>
    );
  }

  if (!meta || needsPermission) return <Welcome />;

  return (
    <div className="h-full w-full flex flex-col">
      <Topbar />
      <div className="flex-1 flex min-h-0">
        {viewMode === "grid" ? (
          <>
            <Sidebar onOpenManager={() => setManagerOpen(true)} />
            <main className="flex-1 min-w-0 min-h-0 flex flex-col">
              <ClipGrid />
            </main>
          </>
        ) : (
          <main className="flex-1 min-w-0 min-h-0 flex flex-col">
            <Board />
          </main>
        )}
      </div>
      {previewClipId && <Preview />}
      {groupModalId && <GroupModal />}
      {managerOpen && <LevelsManager onClose={() => setManagerOpen(false)} />}
    </div>
  );
}

export default App;

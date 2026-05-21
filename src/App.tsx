import { useEffect, useState } from "react";
import { useStore } from "./state/store";
import { Welcome } from "./components/Welcome";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { ClipGrid } from "./components/ClipGrid";
import { Preview } from "./components/Preview";
import { LevelsManager } from "./components/LevelsManager";

function App() {
  const { init, ready, meta, needsPermission, previewClipId } = useStore();
  const [managerOpen, setManagerOpen] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

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
        <Sidebar onOpenManager={() => setManagerOpen(true)} />
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          <ClipGrid />
        </main>
      </div>
      {previewClipId && <Preview />}
      {managerOpen && <LevelsManager onClose={() => setManagerOpen(false)} />}
    </div>
  );
}

export default App;

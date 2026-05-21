import { Clapperboard, FolderOpen, ShieldCheck } from "lucide-react";
import { useStore } from "../state/store";

export function Welcome() {
  const { pickFolder, needsPermission, grantPermission, meta } = useStore();

  return (
    <div className="h-full w-full flex items-center justify-center px-8">
      <div className="max-w-2xl w-full pop-in">
        <div className="flex items-center gap-3 text-ink-400 mb-10 text-xs uppercase tracking-[0.2em]">
          <span className="w-8 h-px bg-ink-700" />
          <span>storytime</span>
          <span className="flex-1 h-px bg-ink-700" />
        </div>

        <div className="flex items-start gap-6 mb-12">
          <div className="size-14 rounded-2xl bg-gradient-to-br from-accent-500 to-rose-500 flex items-center justify-center shrink-0 shadow-lg shadow-accent-500/20">
            <Clapperboard className="size-7 text-ink-950" strokeWidth={2.4} />
          </div>
          <div>
            <h1 className="text-4xl font-medium tracking-tight text-ink-50 leading-tight">
              Track every shot
              <br />
              before it gets cut.
            </h1>
            <p className="text-ink-400 mt-3 leading-relaxed">
              A storyboard for the footage already on your disk. Point it at a folder,
              organize into buckets, mark what's planned vs.&nbsp;captured.
              Nothing leaves your machine.
            </p>
          </div>
        </div>

        {needsPermission && meta ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 mb-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="size-5 text-accent-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-medium text-ink-100">
                  Re-grant access to <span className="text-accent-400">{meta.name}</span>
                </div>
                <p className="text-sm text-ink-400 mt-1">
                  Browsers ask for permission again each session. Your buckets, notes,
                  and planned shots are still here.
                </p>
                <button
                  onClick={grantPermission}
                  className="mt-4 px-4 py-2 rounded-lg bg-accent-400 text-ink-950 font-medium hover:bg-accent-300 transition"
                >
                  Re-grant access
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <button
          onClick={pickFolder}
          className="w-full group relative overflow-hidden rounded-2xl border border-ink-700 hover:border-accent-400/60 bg-ink-900 hover:bg-ink-850 transition px-6 py-5 text-left"
        >
          <div className="flex items-center gap-4">
            <div className="size-11 rounded-xl bg-ink-800 group-hover:bg-accent-400/10 flex items-center justify-center transition">
              <FolderOpen className="size-5 text-ink-300 group-hover:text-accent-400 transition" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-ink-100">Choose your project folder</div>
              <div className="text-sm text-ink-500 mt-0.5">
                Scans for video files, three folders deep: day → event → source.
              </div>
            </div>
            <kbd className="hidden md:inline px-2 py-1 text-[10px] font-mono rounded bg-ink-800 text-ink-400 border border-ink-700">
              ⏎
            </kbd>
          </div>
        </button>

        <div className="mt-10 grid grid-cols-3 gap-3 text-xs">
          <Feature title="No upload" body="Files stay on disk. Read-only access." />
          <Feature title="Resumable" body="Buckets and notes persist between sessions." />
          <Feature title="Chromium only" body="Uses the File System Access API." />
        </div>
      </div>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-ink-800 px-3 py-3 bg-ink-900/40">
      <div className="text-ink-200 font-medium">{title}</div>
      <div className="text-ink-500 mt-0.5 leading-snug">{body}</div>
    </div>
  );
}

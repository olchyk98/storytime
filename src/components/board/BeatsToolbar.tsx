import clsx from "clsx";
import { MousePointer2, SquareDashedKanban } from "lucide-react";
import { useStore, type BoardTool } from "../../state/store";

const TOOLS: {
  key: BoardTool;
  label: string;
  hint: string;
  shortcut: string;
  icon: typeof MousePointer2;
}[] = [
  {
    key: "select",
    label: "Select",
    hint: "Move and edit beats",
    shortcut: "V",
    icon: MousePointer2,
  },
  {
    key: "annotation",
    label: "Annotation",
    hint: "Drag to draw a labeled region around beats",
    shortcut: "A",
    icon: SquareDashedKanban,
  },
];

export function BeatsToolbar() {
  const { boardTool, setBoardTool } = useStore();
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1 rounded-xl bg-ink-850/90 backdrop-blur border border-ink-700 shadow-xl shadow-ink-950/60">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const active = boardTool === t.key;
        return (
          <div key={t.key} className="relative group/tt">
            <button
              onClick={() => setBoardTool(t.key)}
              className={clsx(
                "size-9 rounded-lg flex items-center justify-center transition",
                active
                  ? "bg-ink-700 text-ink-50"
                  : "text-ink-300 hover:bg-ink-800 hover:text-ink-50"
              )}
            >
              <Icon className="size-4" />
            </button>
            <div
              role="tooltip"
              className="absolute left-1/2 -translate-x-1/2 top-[calc(100%+8px)] z-30 pointer-events-none
                opacity-0 translate-y-0.5
                group-hover/tt:opacity-100 group-hover/tt:translate-y-0
                transition duration-150 ease-out delay-100"
            >
              <div className="px-2.5 py-1.5 rounded-lg bg-ink-50 text-ink-950 text-[11px] font-medium shadow-xl shadow-ink-950/40 whitespace-nowrap flex items-center gap-2">
                <span>{t.label}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-ink-200 text-ink-700 font-mono text-[10px] leading-none">
                  {t.shortcut}
                </kbd>
              </div>
              <div className="text-[10px] text-ink-300 text-center mt-1 px-1 leading-tight max-w-[180px] mx-auto">
                {t.hint}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

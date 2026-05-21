import clsx from "clsx";
import { LayoutGrid, Loader2, ScanLine } from "lucide-react";
import { useStore } from "../state/store";
import { fmtBytes } from "../lib/format";

export function Topbar() {
  const { clips, scan, viewMode, setViewMode, ensureBoard } = useStore();
  const captured = Object.keys(clips).length;
  const totalSize = Object.values(clips).reduce((s, c) => s + c.size, 0);

  async function switchToBoard() {
    await ensureBoard();
    setViewMode("board");
  }

  return (
    <div className="h-12 border-b border-ink-800 bg-ink-950 flex items-center px-3 gap-5 shrink-0">
      <div className="inline-flex h-8 rounded-lg border border-ink-800 overflow-hidden p-0.5 bg-ink-900">
        <ToggleBtn
          active={viewMode === "grid"}
          onClick={() => setViewMode("grid")}
          icon={<LayoutGrid className="size-3.5" />}
          label="Grid"
        />
        <ToggleBtn
          active={viewMode === "board"}
          onClick={switchToBoard}
          icon={<ScanLine className="size-3.5" />}
          label="Board"
        />
      </div>

      <span className="w-px h-5 bg-ink-800" />

      <Pill label="clips" value={captured.toString()} />
      <Pill label="total" value={fmtBytes(totalSize)} />
      <div className="flex-1" />
      <div className="flex items-center gap-2 text-[11px] text-ink-400 min-w-0">
        {scan.active && (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            <span>scanning · {scan.count} found</span>
            {scan.current && (
              <span className="truncate max-w-[220px] font-mono opacity-70">
                {scan.current}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-3 rounded-md text-xs inline-flex items-center gap-1.5 transition",
        active ? "bg-ink-700 text-ink-50" : "text-ink-300 hover:text-ink-50"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-baseline gap-1.5">
      <span className="font-mono text-sm text-ink-100">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
    </div>
  );
}

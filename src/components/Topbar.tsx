import { Loader2 } from "lucide-react";
import { useStore } from "../state/store";
import { fmtBytes } from "../lib/format";

export function Topbar() {
  const { clips, scan } = useStore();
  const captured = Object.keys(clips).length;
  const totalSize = Object.values(clips).reduce((s, c) => s + c.size, 0);

  return (
    <div className="h-12 border-b border-ink-800 bg-ink-950 flex items-center px-4 gap-5 shrink-0">
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

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-baseline gap-1.5">
      <span className="font-mono text-sm text-ink-100">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
    </div>
  );
}

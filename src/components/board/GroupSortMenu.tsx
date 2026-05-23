import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  Check,
} from "lucide-react";
import type { BoardEventSort } from "../../types";

const OPTIONS: {
  key: BoardEventSort;
  label: string;
  icon: typeof ArrowDownAZ;
}[] = [
  { key: "name-asc", label: "Name A → Z", icon: ArrowDownAZ },
  { key: "name-desc", label: "Name Z → A", icon: ArrowUpAZ },
  { key: "date-desc", label: "Newest first", icon: CalendarArrowDown },
  { key: "date-asc", label: "Oldest first", icon: CalendarArrowUp },
];

export function GroupSortMenu({
  value,
  onChange,
  compact = false,
}: {
  value: BoardEventSort;
  onChange: (v: BoardEventSort) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.key === value) ?? OPTIONS[0];
  const Icon = current.icon;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        title={`Sort: ${current.label}`}
        className={clsx(
          "rounded hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center transition",
          compact ? "size-6" : "h-7 px-2 gap-1 text-[11px]"
        )}
      >
        <Icon className="size-3.5" />
        {!compact && <span>{current.label}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-44 rounded-lg bg-ink-850 border border-ink-700 shadow-xl shadow-ink-950/60 p-1 pop-in">
          {OPTIONS.map((o) => {
            const I = o.icon;
            const active = o.key === value;
            return (
              <button
                key={o.key}
                onClick={() => {
                  if (o.key !== value) onChange(o.key);
                  setOpen(false);
                }}
                className={clsx(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition",
                  active
                    ? "bg-ink-700 text-ink-50"
                    : "hover:bg-ink-700 text-ink-100"
                )}
              >
                <I className="size-3.5 text-ink-300" />
                <span className="flex-1">{o.label}</span>
                {active && <Check className="size-3.5 text-accent-300" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Search, X } from "lucide-react";

export interface SearchableOption {
  id: string;
  label: string;
  color?: string;
}

interface Props {
  value: string | null;
  options: SearchableOption[];
  placeholder?: string;
  emptyLabel?: string;
  allowClear?: boolean;
  className?: string;
  triggerClassName?: string;
  onChange: (id: string | null) => void;
  align?: "left" | "right";
  /** "down" opens below the trigger (default); "up" opens above with search at the bottom. */
  direction?: "up" | "down";
  /** Optional "create new" action shown at the bottom when query has no exact match */
  onCreate?: (name: string) => string | undefined;
  createLabel?: string;
}

export function SearchableSelect({
  value,
  options,
  placeholder = "Select…",
  emptyLabel = "No results",
  allowClear = true,
  className,
  triggerClassName,
  onChange,
  align = "left",
  direction = "down",
  onCreate,
  createLabel = "Create",
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [q, options]);

  const exactMatch = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.find((o) => o.label.toLowerCase() === needle);
  }, [q, options]);

  const showCreate =
    !!onCreate && q.trim().length > 0 && !exactMatch;

  useEffect(() => {
    setHighlight(0);
  }, [q, open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQ("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = options.find((o) => o.id === value);

  function commit(id: string | null) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const max = filtered.length + (showCreate ? 1 : 0);
      setHighlight((h) => Math.min(max - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Single-result shortcut: if exactly one filtered item, pick it regardless of highlight.
      if (filtered.length === 1 && q.trim().length > 0) {
        commit(filtered[0].id);
        return;
      }
      if (highlight < filtered.length) {
        commit(filtered[highlight].id);
      } else if (showCreate && onCreate) {
        const newId = onCreate(q.trim());
        if (newId) commit(newId);
        else setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "w-full h-9 px-3 rounded-lg border bg-ink-900 hover:border-ink-700 text-sm inline-flex items-center gap-2 transition",
          open ? "border-accent-400" : "border-ink-800",
          triggerClassName
        )}
      >
        {selected ? (
          <>
            {selected.color && (
              <span
                className="size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: selected.color }}
              />
            )}
            <span className="truncate text-ink-50">{selected.label}</span>
          </>
        ) : (
          <span className="truncate text-ink-400">{placeholder}</span>
        )}
        <span className="flex-1" />
        {allowClear && selected && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="size-5 rounded hover:bg-ink-800 text-ink-400 hover:text-ink-50 flex items-center justify-center"
            title="Clear"
          >
            <X className="size-3.5" />
          </span>
        )}
        <ChevronDown
          className={clsx(
            "size-3.5 text-ink-400 transition",
            direction === "up" ? "rotate-180" : "",
            open && (direction === "up" ? "rotate-0" : "rotate-180")
          )}
        />
      </button>

      {open && (
        <div
          className={clsx(
            "absolute z-30 w-full min-w-[14rem] rounded-lg bg-ink-850 border border-ink-700 shadow-xl shadow-ink-950/70 overflow-hidden pop-in",
            direction === "up" ? "bottom-10" : "top-10",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {(() => {
            const searchBar = (
              <div
                className={clsx(
                  "px-2 py-1.5",
                  direction === "up"
                    ? "border-t border-ink-800"
                    : "border-b border-ink-800"
                )}
              >
                <div className="relative">
                  <Search className="size-3.5 text-ink-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search…"
                    className="w-full h-8 pl-8 pr-2 rounded bg-ink-900 border border-ink-800 focus:border-accent-400 text-sm text-ink-100 placeholder:text-ink-500"
                  />
                </div>
              </div>
            );

            const list = (
              <div className="max-h-64 overflow-y-auto py-1">
                {filtered.length === 0 && !showCreate ? (
                  <div className="px-3 py-3 text-xs text-ink-500 text-center">
                    {emptyLabel}
                  </div>
                ) : (
                  filtered.map((o, i) => {
                    const isSelected = o.id === value;
                    const isHL = i === highlight;
                    return (
                      <button
                        key={o.id}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => commit(o.id)}
                        className={clsx(
                          "w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm transition",
                          isHL ? "bg-ink-700 text-ink-50" : "text-ink-100 hover:bg-ink-800"
                        )}
                      >
                        {o.color && (
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: o.color }}
                          />
                        )}
                        <span className="flex-1 truncate">{o.label}</span>
                        {isSelected && <Check className="size-3.5 text-accent-300" />}
                      </button>
                    );
                  })
                )}
                {showCreate && (
                  <button
                    onMouseEnter={() => setHighlight(filtered.length)}
                    onClick={() => {
                      const id = onCreate?.(q.trim());
                      if (id) commit(id);
                      else setOpen(false);
                    }}
                    className={clsx(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm border-t border-ink-800 mt-1",
                      highlight === filtered.length
                        ? "bg-ink-700 text-ink-50"
                        : "text-accent-300 hover:bg-ink-800"
                    )}
                  >
                    <span className="size-2.5 rounded-full border border-current shrink-0" />
                    <span className="flex-1 truncate">
                      {createLabel} <span className="font-medium">"{q}"</span>
                    </span>
                  </button>
                )}
              </div>
            );

            return direction === "up" ? (
              <>
                {list}
                {searchBar}
              </>
            ) : (
              <>
                {searchBar}
                {list}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

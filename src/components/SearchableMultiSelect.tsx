import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { SearchableOption } from "./SearchableSelect";

interface Props {
  values: string[];
  options: SearchableOption[];
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  triggerClassName?: string;
  onChange: (values: string[]) => void;
  align?: "left" | "right";
  direction?: "up" | "down";
  /** Optional "create new" action — invoked when user hits Enter on a non-matching query. */
  onCreate?: (name: string) => string | undefined;
  createLabel?: string;
}

export function SearchableMultiSelect({
  values,
  options,
  placeholder = "Select…",
  emptyLabel = "No results",
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

  const showCreate = !!onCreate && q.trim().length > 0 && !exactMatch;

  useEffect(() => {
    setHighlight(0);
  }, [q, open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
    else setQ("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  function toggle(id: string) {
    if (values.includes(id)) onChange(values.filter((v) => v !== id));
    else onChange([...values, id]);
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
      // Single-result shortcut: if only one filtered match, toggle it and clear search
      if (filtered.length === 1 && q.trim().length > 0) {
        toggle(filtered[0].id);
        setQ("");
        return;
      }
      if (highlight < filtered.length) {
        toggle(filtered[highlight].id);
        setQ("");
      } else if (showCreate && onCreate) {
        const newId = onCreate(q.trim());
        if (newId && !values.includes(newId)) onChange([...values, newId]);
        setQ("");
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && q.length === 0 && values.length > 0) {
      // Quick remove: empty query + backspace pops the last selection
      onChange(values.slice(0, -1));
    }
  }

  const selectedOptions = options.filter((o) => values.includes(o.id));

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "w-full min-h-9 px-2 py-1 rounded-lg border bg-ink-900 hover:border-ink-700 text-sm inline-flex items-center gap-1.5 flex-wrap transition text-left",
          open ? "border-accent-400" : "border-ink-800",
          triggerClassName
        )}
      >
        {selectedOptions.length === 0 ? (
          <span className="truncate text-ink-400 px-1">{placeholder}</span>
        ) : (
          selectedOptions.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[12px] font-medium"
              style={{
                backgroundColor: o.color ? `${o.color}33` : "oklch(0.30 0.014 265)",
                color: o.color ?? "oklch(0.97 0.006 270)",
              }}
            >
              {o.color && (
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: o.color }}
                />
              )}
              {o.label}
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(o.id);
                }}
                className="hover:bg-ink-950/30 rounded p-0.5 -mr-0.5"
                title="Remove"
              >
                <X className="size-3" />
              </span>
            </span>
          ))
        )}
        <span className="flex-1" />
        <ChevronDown
          className={clsx(
            "size-3.5 text-ink-400 transition shrink-0",
            direction === "up" ? "rotate-180" : "",
            open && (direction === "up" ? "rotate-0" : "rotate-180")
          )}
        />
      </button>

      {open && (
        <div
          className={clsx(
            "absolute z-30 w-full min-w-[14rem] rounded-lg bg-ink-850 border border-ink-700 shadow-xl shadow-ink-950/70 overflow-hidden pop-in",
            direction === "up" ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]",
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
                    const isSelected = values.includes(o.id);
                    const isHL = i === highlight;
                    return (
                      <button
                        key={o.id}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => toggle(o.id)}
                        className={clsx(
                          "w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm transition",
                          isHL ? "bg-ink-700 text-ink-50" : "text-ink-100 hover:bg-ink-800"
                        )}
                      >
                        <span
                          className={clsx(
                            "size-3 rounded-sm border flex items-center justify-center shrink-0",
                            isSelected
                              ? "bg-accent-400 border-accent-400"
                              : "border-ink-600"
                          )}
                        >
                          {isSelected && (
                            <Check className="size-2.5 text-ink-950" strokeWidth={3} />
                          )}
                        </span>
                        {o.color && (
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: o.color }}
                          />
                        )}
                        <span className="flex-1 truncate">{o.label}</span>
                      </button>
                    );
                  })
                )}
                {showCreate && (
                  <button
                    onMouseEnter={() => setHighlight(filtered.length)}
                    onClick={() => {
                      if (!onCreate) return;
                      const id = onCreate(q.trim());
                      if (id && !values.includes(id)) onChange([...values, id]);
                      setQ("");
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

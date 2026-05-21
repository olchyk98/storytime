import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useStore } from "../state/store";
import type { Level, LevelValue } from "../types";

export function LevelsManager({ onClose }: { onClose: () => void }) {
  const {
    levels,
    levelValues,
    addLevel,
    renameLevel,
    reorderLevels,
    deleteLevel,
    countClipsTaggedAtLevel,
    addValue,
    renameValue,
    recolorValue,
    reorderValues,
    deleteValue,
    countClipsTaggedWithValue,
  } = useStore();

  const sortedLevels = useMemo(
    () => Object.values(levels).sort((a, b) => a.order - b.order),
    [levels]
  );

  const valuesByLevel = useMemo(() => {
    const m = new Map<string, LevelValue[]>();
    for (const v of Object.values(levelValues)) {
      if (!m.has(v.levelId)) m.set(v.levelId, []);
      m.get(v.levelId)!.push(v);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.order - b.order);
    return m;
  }, [levelValues]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sortedLevels.map((l) => [l.id, true]))
  );
  const [newLevelName, setNewLevelName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: "level"; level: Level; affected: number }
    | { kind: "value"; value: LevelValue; affected: number }
    | null
  >(null);

  function addLevelInline() {
    const n = newLevelName.trim();
    if (!n) return;
    const l = addLevel(n);
    setNewLevelName("");
    setExpanded((s) => ({ ...s, [l.id]: true }));
  }

  function moveLevel(idx: number, dir: -1 | 1) {
    const next = [...sortedLevels];
    const t = idx + dir;
    if (t < 0 || t >= next.length) return;
    [next[idx], next[t]] = [next[t], next[idx]];
    reorderLevels(next.map((l) => l.id));
  }
  function moveValue(levelId: string, idx: number, dir: -1 | 1) {
    const arr = valuesByLevel.get(levelId) ?? [];
    const next = [...arr];
    const t = idx + dir;
    if (t < 0 || t >= next.length) return;
    [next[idx], next[t]] = [next[t], next[idx]];
    reorderValues(levelId, next.map((v) => v.id));
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/85 backdrop-blur-sm flex items-center justify-center p-6 fade-in">
      <div className="w-[600px] max-h-[80vh] flex flex-col rounded-2xl bg-ink-900 border border-ink-700 shadow-2xl shadow-ink-950/80 overflow-hidden pop-in">
        <header className="px-5 py-4 border-b border-ink-800 flex items-center gap-3">
          <div className="size-8 rounded-lg bg-accent-400/20 text-accent-300 flex items-center justify-center">
            <Settings2 className="size-4" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-ink-50">Manage hierarchy</div>
            <div className="text-xs text-ink-400">
              Define levels (dimensions) and the values within them.
            </div>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded-md hover:bg-ink-800 text-ink-300 hover:text-ink-50 flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {sortedLevels.length === 0 && (
            <div className="text-center text-sm text-ink-400 py-8">
              No levels yet. Add one below — e.g. "Day", "Event", "Camera".
            </div>
          )}

          {sortedLevels.map((l, levelIdx) => {
            const values = valuesByLevel.get(l.id) ?? [];
            const open = expanded[l.id] ?? true;
            return (
              <div
                key={l.id}
                className="rounded-xl border border-ink-800 bg-ink-850 overflow-hidden"
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    onClick={() => setExpanded((s) => ({ ...s, [l.id]: !open }))}
                    className="size-6 text-ink-300 hover:text-ink-50 flex items-center justify-center"
                  >
                    {open ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </button>
                  <input
                    value={l.name}
                    onChange={(e) => renameLevel(l.id, e.target.value)}
                    className="flex-1 bg-transparent border-none focus:outline-none text-sm font-medium text-ink-50"
                  />
                  <span className="text-[10px] font-mono text-ink-400 mr-2">
                    {values.length} {values.length === 1 ? "value" : "values"}
                  </span>
                  <button
                    onClick={() => moveLevel(levelIdx, -1)}
                    disabled={levelIdx === 0}
                    className="size-6 text-ink-400 hover:text-ink-50 disabled:opacity-30 flex items-center justify-center"
                    title="Move up"
                  >
                    <GripVertical className="size-3.5 rotate-90 -translate-y-px" />
                  </button>
                  <button
                    onClick={() => moveLevel(levelIdx, 1)}
                    disabled={levelIdx === sortedLevels.length - 1}
                    className="size-6 text-ink-400 hover:text-ink-50 disabled:opacity-30 flex items-center justify-center"
                    title="Move down"
                  >
                    <GripVertical className="size-3.5 -rotate-90 translate-y-px" />
                  </button>
                  <button
                    onClick={() => {
                      const affected = countClipsTaggedAtLevel(l.id);
                      if (affected === 0) {
                        if (
                          confirm(`Delete level "${l.name}"? No clips are tagged here.`)
                        )
                          deleteLevel(l.id);
                      } else {
                        setConfirmDelete({ kind: "level", level: l, affected });
                      }
                    }}
                    className="size-7 rounded-md hover:bg-rose-500/10 text-ink-400 hover:text-rose-500 flex items-center justify-center transition"
                    title="Delete level"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {open && (
                  <div className="border-t border-ink-800 px-3 py-2 space-y-1">
                    {values.length === 0 && (
                      <div className="text-[11px] text-ink-500 px-1 py-1">
                        No values yet.
                      </div>
                    )}
                    {values.map((v, vIdx) => (
                      <div
                        key={v.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-900/60"
                      >
                        <ColorDot
                          color={v.color}
                          onPick={(c) => recolorValue(v.id, c)}
                        />
                        <input
                          value={v.name}
                          onChange={(e) => renameValue(v.id, e.target.value)}
                          className="flex-1 bg-transparent border-none focus:outline-none text-sm text-ink-100"
                        />
                        <button
                          onClick={() => moveValue(l.id, vIdx, -1)}
                          disabled={vIdx === 0}
                          className="size-6 text-ink-500 hover:text-ink-100 disabled:opacity-30 flex items-center justify-center"
                          title="Up"
                        >
                          <GripVertical className="size-3.5 rotate-90 -translate-y-px" />
                        </button>
                        <button
                          onClick={() => moveValue(l.id, vIdx, 1)}
                          disabled={vIdx === values.length - 1}
                          className="size-6 text-ink-500 hover:text-ink-100 disabled:opacity-30 flex items-center justify-center"
                          title="Down"
                        >
                          <GripVertical className="size-3.5 -rotate-90 translate-y-px" />
                        </button>
                        <button
                          onClick={() => {
                            const affected = countClipsTaggedWithValue(v.id);
                            if (affected === 0) {
                              deleteValue(v.id);
                            } else {
                              setConfirmDelete({
                                kind: "value",
                                value: v,
                                affected,
                              });
                            }
                          }}
                          className="size-6 rounded hover:bg-rose-500/10 text-ink-500 hover:text-rose-500 flex items-center justify-center"
                          title="Delete value"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ))}
                    <AddValueInline
                      onAdd={(name) => addValue(l.id, name)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <footer className="px-4 py-3 border-t border-ink-800 bg-ink-900 flex items-center gap-2">
          <input
            value={newLevelName}
            onChange={(e) => setNewLevelName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLevelInline()}
            placeholder="New level name…"
            className="flex-1 h-9 px-3 rounded-lg bg-ink-850 border border-ink-700 focus:border-accent-400 text-sm text-ink-100 placeholder:text-ink-500"
          />
          <button
            onClick={addLevelInline}
            disabled={!newLevelName.trim()}
            className="h-9 px-3 rounded-lg bg-accent-400 hover:bg-accent-300 text-ink-950 font-medium text-sm inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <Plus className="size-4" /> Add level
          </button>
        </footer>
      </div>

      {confirmDelete && (
        <ConfirmDelete
          info={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            if (confirmDelete.kind === "level") deleteLevel(confirmDelete.level.id);
            else deleteValue(confirmDelete.value.id);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function AddValueInline({ onAdd }: { onAdd: (name: string) => void }) {
  const [n, setN] = useState("");
  return (
    <div className="flex items-center gap-2 px-2 pt-1">
      <input
        value={n}
        onChange={(e) => setN(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && n.trim()) {
            onAdd(n.trim());
            setN("");
          }
        }}
        placeholder="Add value…"
        className="flex-1 h-7 px-2 rounded bg-ink-900 border border-ink-800 focus:border-accent-400 text-[13px] text-ink-100 placeholder:text-ink-500"
      />
      <button
        onClick={() => {
          if (n.trim()) {
            onAdd(n.trim());
            setN("");
          }
        }}
        disabled={!n.trim()}
        className="size-7 rounded-md bg-ink-800 hover:bg-ink-700 text-ink-200 hover:text-ink-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

const COLOR_PALETTE = [
  "#f59e0b", "#fb7185", "#a78bfa", "#22d3ee", "#34d399",
  "#f472b6", "#60a5fa", "#fbbf24", "#94a3b8", "#fb923c",
];

function ColorDot({
  color,
  onPick,
}: {
  color: string;
  onPick: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="size-4 rounded-full border border-ink-700"
        style={{ backgroundColor: color }}
        title="Color"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 p-2 rounded-lg bg-ink-850 border border-ink-700 shadow-xl shadow-ink-950/70 grid grid-cols-5 gap-1.5">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
                className={clsx(
                  "size-4 rounded-full border",
                  c === color ? "border-ink-50" : "border-ink-700"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ConfirmDelete({
  info,
  onCancel,
  onConfirm,
}: {
  info:
    | { kind: "level"; level: Level; affected: number }
    | { kind: "value"; value: LevelValue; affected: number };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isLevel = info.kind === "level";
  const name = isLevel ? info.level.name : info.value.name;
  return (
    <div
      className="fixed inset-0 z-[60] bg-ink-950/75 backdrop-blur-sm flex items-center justify-center p-6 fade-in"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[400px] rounded-xl bg-ink-900 border border-ink-700 shadow-2xl shadow-ink-950/80 p-5 pop-in"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="size-9 rounded-lg bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
            <Trash2 className="size-4" />
          </div>
          <div>
            <div className="font-medium text-ink-50">
              Delete {isLevel ? "level" : "value"} "{name}"?
            </div>
            <div className="text-sm text-ink-300 mt-1 leading-relaxed">
              {info.affected} clip{info.affected === 1 ? "" : "s"}{" "}
              {info.affected === 1 ? "is" : "are"} currently tagged{" "}
              {isLevel ? "at this level" : "with this value"}. They'll be untagged.
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="h-9 px-4 rounded-lg border border-ink-700 hover:border-ink-600 text-ink-200 hover:text-ink-50 text-sm transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="h-9 px-4 rounded-lg bg-rose-500 hover:bg-rose-500/90 text-ink-50 font-medium text-sm transition"
          >
            Untag {info.affected} & delete
          </button>
        </div>
      </div>
    </div>
  );
}

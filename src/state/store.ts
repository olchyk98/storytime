import { create } from "zustand";
import type { Bucket, Clip, Level, LevelValue, PlannedShot, ProjectMeta } from "../types";
import * as db from "../lib/db";
import { ensurePermission, getFileByPath, scanDirectory } from "../lib/fs";
import { extractThumb } from "../lib/thumbs";

export type Selection =
  | { kind: "all" }
  | { kind: "new" }
  | { kind: "untagged"; levelId: string }
  | { kind: "level-value"; levelId: string; valueId: string }
  | { kind: "folder-day"; day: string }
  | { kind: "folder-event"; day: string; event: string }
  | { kind: "folder-source"; day: string; event: string; source: string };

export interface ScanState {
  active: boolean;
  count: number;
  current?: string;
}

interface StoreState {
  ready: boolean;
  meta?: ProjectMeta;
  clips: Record<string, Clip>;
  buckets: Record<string, Bucket>;
  planned: Record<string, PlannedShot>;
  levels: Record<string, Level>;
  levelValues: Record<string, LevelValue>;
  selection: Selection;
  selectedClipIds: Set<string>;
  lastClickedClipId?: string;
  dragSelecting: boolean;
  scan: ScanState;
  previewClipId?: string;
  needsPermission: boolean;
  fileCache: Map<string, File>;

  // bootstrap
  init: () => Promise<void>;

  // project / scan
  pickFolder: () => Promise<void>;
  grantPermission: () => Promise<void>;
  rescan: () => Promise<void>;

  // selection
  setSelection: (s: Selection) => void;

  // clip ops
  setClipNotes: (id: string, notes: string) => void;
  toggleClipBucket: (clipId: string, bucketId: string) => void;
  linkClipToPlanned: (clipId: string, plannedId: string | undefined) => void;
  getClipFile: (clipId: string) => Promise<File | null>;
  ensureThumb: (clipId: string) => Promise<void>;
  enqueueThumbs: (clipIds: string[]) => void;

  // buckets (unused; kept for data preservation)
  addBucket: (name: string) => Bucket;
  renameBucket: (id: string, name: string) => void;
  recolorBucket: (id: string, color: string) => void;
  deleteBucket: (id: string) => void;
  toggleBucketCollapsed: (id: string) => void;
  reorderBuckets: (ids: string[]) => void;

  // planned (unused; kept for data preservation)
  addPlanned: (p: Partial<PlannedShot> & { title: string }) => PlannedShot;
  updatePlanned: (id: string, patch: Partial<PlannedShot>) => void;
  togglePlannedDone: (id: string) => void;
  deletePlanned: (id: string) => void;

  // levels + values
  addLevel: (name: string) => Level;
  renameLevel: (id: string, name: string) => void;
  reorderLevels: (ids: string[]) => void;
  deleteLevel: (id: string) => void;
  countClipsTaggedAtLevel: (levelId: string) => number;
  addValue: (levelId: string, name: string) => LevelValue;
  renameValue: (id: string, name: string) => void;
  recolorValue: (id: string, color: string) => void;
  reorderValues: (levelId: string, ids: string[]) => void;
  deleteValue: (id: string) => void;
  countClipsTaggedWithValue: (valueId: string) => number;
  tagClips: (clipIds: string[], levelId: string, valueId: string | null) => void;

  // multi-select
  selectOnlyClip: (id: string) => void;
  toggleClipSelected: (id: string) => void;
  selectRangeTo: (id: string) => void;
  clearSelection: () => void;
  selectAllVisible: () => void;
  beginDragSelect: (id: string) => void;
  dragSelectEnter: (id: string) => void;
  endDragSelect: () => void;

  // preview
  openPreview: (id: string) => void;
  closePreview: () => void;
  steppingPreview: (dir: 1 | -1) => void;

  // helpers
  visibleClips: () => Clip[];
}

const PALETTE = [
  "#f59e0b", "#fb7185", "#a78bfa", "#22d3ee", "#34d399", "#f472b6", "#60a5fa", "#fbbf24",
];

function uid() {
  return crypto.randomUUID();
}

// throttle thumb extraction
class ThumbQueue {
  private q: string[] = [];
  private inFlight = 0;
  private max = 3;
  private run: (id: string) => Promise<void>;
  constructor(run: (id: string) => Promise<void>) {
    this.run = run;
  }
  push(ids: string[]) {
    for (const id of ids) if (!this.q.includes(id)) this.q.push(id);
    this.kick();
  }
  private kick() {
    while (this.inFlight < this.max && this.q.length) {
      const id = this.q.shift()!;
      this.inFlight++;
      this.run(id)
        .catch(() => {})
        .finally(() => {
          this.inFlight--;
          this.kick();
        });
    }
  }
}

export const useStore = create<StoreState>((set, get) => {
  const thumbQueue = new ThumbQueue(async (id) => {
    await get().ensureThumb(id);
  });

  return {
    ready: false,
    clips: {},
    buckets: {},
    planned: {},
    levels: {},
    levelValues: {},
    selection: { kind: "all" },
    selectedClipIds: new Set<string>(),
    dragSelecting: false,
    scan: { active: false, count: 0 },
    needsPermission: false,
    fileCache: new Map(),

    async init() {
      const meta = await db.loadMeta();
      const clips = await db.getAll<Clip>("clips");
      const buckets = await db.getAll<Bucket>("buckets");
      const planned = await db.getAll<PlannedShot>("planned");
      const levels = await db.getAll<Level>("levels");
      const levelValues = await db.getAll<LevelValue>("levelValues");

      const clipMap: Record<string, Clip> = {};
      for (const c of clips) clipMap[c.id] = c;
      const bucketMap: Record<string, Bucket> = {};
      for (const b of buckets) bucketMap[b.id] = b;
      const plannedMap: Record<string, PlannedShot> = {};
      for (const p of planned) plannedMap[p.id] = p;
      const levelMap: Record<string, Level> = {};
      for (const l of levels) levelMap[l.id] = l;
      const valueMap: Record<string, LevelValue> = {};
      for (const v of levelValues) valueMap[v.id] = v;

      let needsPerm = false;
      if (meta?.rootHandle) {
        const ok = await (meta.rootHandle as any).queryPermission({ mode: "read" });
        needsPerm = ok !== "granted";
      }

      set({
        ready: true,
        meta,
        clips: clipMap,
        buckets: bucketMap,
        planned: plannedMap,
        levels: levelMap,
        levelValues: valueMap,
        needsPermission: needsPerm,
      });

      // hydrate thumbs from idb in background
      (async () => {
        const next: Record<string, Clip> = { ...get().clips };
        let dirty = false;
        for (const id of Object.keys(next)) {
          if (!next[id].thumb) {
            const t = await db.getThumb(id);
            if (t) {
              next[id] = { ...next[id], thumb: t };
              dirty = true;
            }
          }
        }
        if (dirty) set({ clips: next });
      })();
    },

    async pickFolder() {
      const w = window as any;
      if (!w.showDirectoryPicker) {
        alert(
          "This app needs the File System Access API. Use Chrome, Edge, or Arc (or another Chromium browser)."
        );
        return;
      }
      const root: FileSystemDirectoryHandle = await w.showDirectoryPicker({
        id: "storytime-project",
        mode: "read",
      });
      const meta: ProjectMeta = {
        id: "current",
        name: root.name,
        rootHandle: root,
        lastScanAt: 0,
        createdAt: Date.now(),
      };
      await db.saveMeta(meta);
      set({ meta, needsPermission: false });
      await get().rescan();
    },

    async grantPermission() {
      const meta = get().meta;
      if (!meta?.rootHandle) return;
      const ok = await ensurePermission(meta.rootHandle, "read");
      set({ needsPermission: !ok });
      if (ok) await get().rescan();
    },

    async rescan() {
      const meta = get().meta;
      if (!meta?.rootHandle) return;
      const ok = await ensurePermission(meta.rootHandle, "read");
      if (!ok) {
        set({ needsPermission: true });
        return;
      }
      set({ scan: { active: true, count: 0 } });

      const found = await scanDirectory(meta.rootHandle, (p) =>
        set({ scan: { active: true, count: p.count, current: p.current } })
      );

      const prev = get().clips;
      const next: Record<string, Clip> = {};
      const isInitial = Object.keys(prev).length === 0;
      const newIds: string[] = [];

      for (const f of found) {
        const existing = prev[f.id];
        if (existing) {
          next[f.id] = { ...existing, ...f, isNew: existing.isNew ?? false };
        } else {
          next[f.id] = {
            ...f,
            bucketIds: [],
            isNew: !isInitial,
          };
          if (!isInitial) newIds.push(f.id);
        }
      }
      // Clips not present anymore — drop. (user can re-scan after re-organizing).
      // But preserve clips that the root simply lost permission to (we still have them).

      await db.putAll("clips", Object.values(next));
      // Remove deleted ones from db
      const removed = Object.keys(prev).filter((id) => !next[id]);
      for (const id of removed) await db.deleteOne("clips", id);

      const nextMeta = { ...meta, lastScanAt: Date.now() };
      await db.saveMeta(nextMeta);

      set({
        clips: next,
        meta: nextMeta,
        scan: { active: false, count: Object.keys(next).length },
      });

      // enqueue thumb extraction for any clip missing thumb
      const needsThumb = Object.values(next)
        .filter((c) => !c.thumb)
        .map((c) => c.id);
      thumbQueue.push(needsThumb);
    },

    setSelection(s) {
      set({ selection: s });
    },

    setClipNotes(id, notes) {
      const c = get().clips[id];
      if (!c) return;
      const updated = { ...c, notes };
      set({ clips: { ...get().clips, [id]: updated } });
      db.putOne("clips", updated);
    },

    toggleClipBucket(clipId, bucketId) {
      const c = get().clips[clipId];
      if (!c) return;
      const has = c.bucketIds.includes(bucketId);
      const updated = {
        ...c,
        bucketIds: has
          ? c.bucketIds.filter((b) => b !== bucketId)
          : [...c.bucketIds, bucketId],
      };
      set({ clips: { ...get().clips, [clipId]: updated } });
      db.putOne("clips", updated);
    },

    linkClipToPlanned(clipId, plannedId) {
      const c = get().clips[clipId];
      if (!c) return;
      const updated = { ...c, fulfillsPlannedId: plannedId };
      const next = { ...get().clips, [clipId]: updated };
      set({ clips: next });
      db.putOne("clips", updated);
      // mark planned done if linked
      if (plannedId) {
        const p = get().planned[plannedId];
        if (p && !p.done) {
          const up = { ...p, done: true };
          set({ planned: { ...get().planned, [plannedId]: up } });
          db.putOne("planned", up);
        }
      }
    },

    async getClipFile(clipId) {
      const cache = get().fileCache;
      if (cache.has(clipId)) return cache.get(clipId)!;
      const meta = get().meta;
      const c = get().clips[clipId];
      if (!meta?.rootHandle || !c) return null;
      const ok = await ensurePermission(meta.rootHandle, "read");
      if (!ok) {
        set({ needsPermission: true });
        return null;
      }
      const file = await getFileByPath(meta.rootHandle, c.path);
      if (file) cache.set(clipId, file);
      return file;
    },

    async ensureThumb(clipId) {
      const c = get().clips[clipId];
      if (!c || c.thumb || c.thumbFailed) return;
      const file = await get().getClipFile(clipId);
      if (!file) return;
      const r = await extractThumb(file);
      if (!r) {
        const failed: Clip = { ...c, thumbFailed: true };
        set({ clips: { ...get().clips, [clipId]: failed } });
        await db.putOne("clips", failed);
        return;
      }
      const updated: Clip = {
        ...c,
        thumb: r.dataUrl,
        durationMs: r.durationMs,
        width: r.width,
        height: r.height,
      };
      set({ clips: { ...get().clips, [clipId]: updated } });
      await db.putOne("clips", { ...updated, thumb: undefined });
      await db.putThumb(clipId, r.dataUrl);
    },

    enqueueThumbs(ids) {
      thumbQueue.push(ids);
    },

    addBucket(name) {
      const order = Object.values(get().buckets).length;
      const b: Bucket = {
        id: uid(),
        name,
        color: PALETTE[order % PALETTE.length],
        collapsed: false,
        order,
      };
      set({ buckets: { ...get().buckets, [b.id]: b } });
      db.putOne("buckets", b);
      return b;
    },
    renameBucket(id, name) {
      const b = get().buckets[id];
      if (!b) return;
      const u = { ...b, name };
      set({ buckets: { ...get().buckets, [id]: u } });
      db.putOne("buckets", u);
    },
    recolorBucket(id, color) {
      const b = get().buckets[id];
      if (!b) return;
      const u = { ...b, color };
      set({ buckets: { ...get().buckets, [id]: u } });
      db.putOne("buckets", u);
    },
    deleteBucket(id) {
      const { [id]: _, ...rest } = get().buckets;
      const nextClips: Record<string, Clip> = {};
      for (const c of Object.values(get().clips)) {
        if (c.bucketIds.includes(id)) {
          const u = { ...c, bucketIds: c.bucketIds.filter((b) => b !== id) };
          nextClips[c.id] = u;
          db.putOne("clips", u);
        } else nextClips[c.id] = c;
      }
      set({ buckets: rest, clips: nextClips });
      db.deleteOne("buckets", id);
    },
    toggleBucketCollapsed(id) {
      const b = get().buckets[id];
      if (!b) return;
      const u = { ...b, collapsed: !b.collapsed };
      set({ buckets: { ...get().buckets, [id]: u } });
      db.putOne("buckets", u);
    },
    reorderBuckets(ids) {
      const next = { ...get().buckets };
      ids.forEach((id, i) => {
        if (next[id]) {
          next[id] = { ...next[id], order: i };
          db.putOne("buckets", next[id]);
        }
      });
      set({ buckets: next });
    },

    addPlanned(input) {
      const p: PlannedShot = {
        id: uid(),
        title: input.title,
        notes: input.notes,
        day: input.day,
        event: input.event,
        source: input.source,
        bucketIds: input.bucketIds ?? [],
        done: input.done ?? false,
        createdAt: Date.now(),
      };
      set({ planned: { ...get().planned, [p.id]: p } });
      db.putOne("planned", p);
      return p;
    },
    updatePlanned(id, patch) {
      const p = get().planned[id];
      if (!p) return;
      const u = { ...p, ...patch };
      set({ planned: { ...get().planned, [id]: u } });
      db.putOne("planned", u);
    },
    togglePlannedDone(id) {
      const p = get().planned[id];
      if (!p) return;
      const u = { ...p, done: !p.done };
      set({ planned: { ...get().planned, [id]: u } });
      db.putOne("planned", u);
      // if marked undone, unlink any clip that fulfilled it
      if (!u.done) {
        const next: Record<string, Clip> = { ...get().clips };
        let dirty = false;
        for (const c of Object.values(next)) {
          if (c.fulfillsPlannedId === id) {
            next[c.id] = { ...c, fulfillsPlannedId: undefined };
            db.putOne("clips", next[c.id]);
            dirty = true;
          }
        }
        if (dirty) set({ clips: next });
      }
    },
    deletePlanned(id) {
      const { [id]: _, ...rest } = get().planned;
      set({ planned: rest });
      db.deleteOne("planned", id);
      // unlink clips
      const next: Record<string, Clip> = { ...get().clips };
      let dirty = false;
      for (const c of Object.values(next)) {
        if (c.fulfillsPlannedId === id) {
          next[c.id] = { ...c, fulfillsPlannedId: undefined };
          db.putOne("clips", next[c.id]);
          dirty = true;
        }
      }
      if (dirty) set({ clips: next });
    },

    openPreview(id) {
      set({ previewClipId: id });
    },
    closePreview() {
      set({ previewClipId: undefined });
    },
    steppingPreview(dir) {
      const id = get().previewClipId;
      if (!id) return;
      const visible = get().visibleClips();
      const idx = visible.findIndex((c) => c.id === id);
      if (idx < 0) return;
      const ni = (idx + dir + visible.length) % visible.length;
      set({ previewClipId: visible[ni].id });
    },

    visibleClips() {
      const { clips, selection } = get();
      const arr = Object.values(clips);
      let out = arr;
      switch (selection.kind) {
        case "all":
          break;
        case "new":
          out = arr.filter((c) => c.isNew);
          break;
        case "untagged":
          out = arr.filter((c) => !c.tags?.[selection.levelId]);
          break;
        case "level-value":
          out = arr.filter((c) => c.tags?.[selection.levelId] === selection.valueId);
          break;
        case "folder-day":
          out = arr.filter((c) => c.day === selection.day);
          break;
        case "folder-event":
          out = arr.filter((c) => c.day === selection.day && c.event === selection.event);
          break;
        case "folder-source":
          out = arr.filter(
            (c) =>
              c.day === selection.day &&
              c.event === selection.event &&
              c.source === selection.source
          );
          break;
      }
      return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    },

    addLevel(name) {
      const order = Object.values(get().levels).length;
      const l: Level = { id: uid(), name, order };
      set({ levels: { ...get().levels, [l.id]: l } });
      db.putOne("levels", l);
      return l;
    },
    renameLevel(id, name) {
      const l = get().levels[id];
      if (!l) return;
      const u = { ...l, name };
      set({ levels: { ...get().levels, [id]: u } });
      db.putOne("levels", u);
    },
    reorderLevels(ids) {
      const next = { ...get().levels };
      ids.forEach((id, i) => {
        if (next[id]) {
          next[id] = { ...next[id], order: i };
          db.putOne("levels", next[id]);
        }
      });
      set({ levels: next });
    },
    deleteLevel(id) {
      // remove the level, its values, and clear any clip.tags[id]
      const { [id]: _gone, ...restLevels } = get().levels;
      const nextValues: Record<string, LevelValue> = {};
      const removedValueIds: string[] = [];
      for (const v of Object.values(get().levelValues)) {
        if (v.levelId === id) removedValueIds.push(v.id);
        else nextValues[v.id] = v;
      }
      const nextClips: Record<string, Clip> = { ...get().clips };
      for (const c of Object.values(nextClips)) {
        if (c.tags && c.tags[id]) {
          const { [id]: _g, ...remaining } = c.tags;
          const u = { ...c, tags: remaining };
          nextClips[c.id] = u;
          db.putOne("clips", u);
        }
      }
      set({ levels: restLevels, levelValues: nextValues, clips: nextClips });
      db.deleteOne("levels", id);
      for (const vid of removedValueIds) db.deleteOne("levelValues", vid);
      // reset selection if it pointed at this level
      const s = get().selection;
      if ((s.kind === "level-value" || s.kind === "untagged") && s.levelId === id) {
        set({ selection: { kind: "all" } });
      }
    },
    countClipsTaggedAtLevel(levelId) {
      let n = 0;
      for (const c of Object.values(get().clips)) {
        if (c.tags && c.tags[levelId]) n++;
      }
      return n;
    },

    addValue(levelId, name) {
      const peers = Object.values(get().levelValues).filter((v) => v.levelId === levelId);
      const order = peers.length;
      const color = PALETTE[order % PALETTE.length];
      const v: LevelValue = { id: uid(), levelId, name, color, order };
      set({ levelValues: { ...get().levelValues, [v.id]: v } });
      db.putOne("levelValues", v);
      return v;
    },
    renameValue(id, name) {
      const v = get().levelValues[id];
      if (!v) return;
      const u = { ...v, name };
      set({ levelValues: { ...get().levelValues, [id]: u } });
      db.putOne("levelValues", u);
    },
    recolorValue(id, color) {
      const v = get().levelValues[id];
      if (!v) return;
      const u = { ...v, color };
      set({ levelValues: { ...get().levelValues, [id]: u } });
      db.putOne("levelValues", u);
    },
    reorderValues(levelId, ids) {
      const next = { ...get().levelValues };
      ids.forEach((id, i) => {
        if (next[id] && next[id].levelId === levelId) {
          next[id] = { ...next[id], order: i };
          db.putOne("levelValues", next[id]);
        }
      });
      set({ levelValues: next });
    },
    deleteValue(id) {
      const v = get().levelValues[id];
      if (!v) return;
      const { [id]: _gone, ...rest } = get().levelValues;
      // clear from clip.tags where used
      const nextClips: Record<string, Clip> = { ...get().clips };
      for (const c of Object.values(nextClips)) {
        if (c.tags && c.tags[v.levelId] === id) {
          const { [v.levelId]: _g, ...remaining } = c.tags;
          const u = { ...c, tags: remaining };
          nextClips[c.id] = u;
          db.putOne("clips", u);
        }
      }
      set({ levelValues: rest, clips: nextClips });
      db.deleteOne("levelValues", id);
      const s = get().selection;
      if (s.kind === "level-value" && s.valueId === id) {
        set({ selection: { kind: "all" } });
      }
    },
    countClipsTaggedWithValue(valueId) {
      const v = get().levelValues[valueId];
      if (!v) return 0;
      let n = 0;
      for (const c of Object.values(get().clips)) {
        if (c.tags && c.tags[v.levelId] === valueId) n++;
      }
      return n;
    },

    tagClips(clipIds, levelId, valueId) {
      const next: Record<string, Clip> = { ...get().clips };
      for (const id of clipIds) {
        const c = next[id];
        if (!c) continue;
        const currentTags = c.tags ?? {};
        let newTags: Record<string, string>;
        if (valueId === null) {
          if (!(levelId in currentTags)) continue;
          const { [levelId]: _g, ...rest } = currentTags;
          newTags = rest;
        } else {
          newTags = { ...currentTags, [levelId]: valueId };
        }
        const u = { ...c, tags: newTags };
        next[id] = u;
        db.putOne("clips", u);
      }
      set({ clips: next });
    },

    selectOnlyClip(id) {
      set({ selectedClipIds: new Set([id]), lastClickedClipId: id });
    },
    toggleClipSelected(id) {
      const cur = new Set(get().selectedClipIds);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      set({ selectedClipIds: cur, lastClickedClipId: id });
    },
    selectRangeTo(id) {
      const anchor = get().lastClickedClipId;
      const visible = get().visibleClips();
      if (!anchor) {
        set({ selectedClipIds: new Set([id]), lastClickedClipId: id });
        return;
      }
      const a = visible.findIndex((c) => c.id === anchor);
      const b = visible.findIndex((c) => c.id === id);
      if (a < 0 || b < 0) {
        set({ selectedClipIds: new Set([id]), lastClickedClipId: id });
        return;
      }
      const [from, to] = a < b ? [a, b] : [b, a];
      const next = new Set(get().selectedClipIds);
      for (let i = from; i <= to; i++) next.add(visible[i].id);
      set({ selectedClipIds: next, lastClickedClipId: id });
    },
    clearSelection() {
      set({ selectedClipIds: new Set(), lastClickedClipId: undefined });
    },
    selectAllVisible() {
      const ids = get().visibleClips().map((c) => c.id);
      set({ selectedClipIds: new Set(ids) });
    },
    beginDragSelect(id) {
      const next = new Set(get().selectedClipIds);
      next.add(id);
      set({
        dragSelecting: true,
        selectedClipIds: next,
        lastClickedClipId: id,
      });
    },
    dragSelectEnter(id) {
      if (!get().dragSelecting) return;
      if (get().selectedClipIds.has(id)) return;
      const next = new Set(get().selectedClipIds);
      next.add(id);
      set({ selectedClipIds: next, lastClickedClipId: id });
    },
    endDragSelect() {
      if (!get().dragSelecting) return;
      set({ dragSelecting: false });
    },
  };
});

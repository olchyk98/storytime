import { create } from "zustand";
import type {
  Board,
  BoardArrowNode,
  BoardGroupNode,
  BoardNode,
  BoardRectNode,
  BoardTextNode,
  Bucket,
  Clip,
  Level,
  LevelValue,
  PlannedShot,
  ProjectMeta,
} from "../types";
import * as db from "../lib/db";
import { ensurePermission, getFileByPath, scanDirectory } from "../lib/fs";
import { extractThumb } from "../lib/thumbs";

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  project?: string;
  levels: Level[];
  levelValues: LevelValue[];
  clipTags: {
    fingerprint: string;
    path: string[];
    tags: Record<string, string>;
  }[];
  // Boards added in a later session — optional for older backups.
  boards?: Board[];
  boardNodes?: BoardNode[];
}

export interface ImportSummary {
  levels: number;
  values: number;
  taggedClips: number;
  unmatchedClips: number;
}

export type ViewMode = "grid" | "board";
export type BoardTool = "select" | "group" | "rect" | "text" | "arrow";

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

  // board / canvas
  viewMode: ViewMode;
  boards: Record<string, Board>;
  boardNodes: Record<string, BoardNode>;
  currentBoardId: string | null;
  boardTool: BoardTool;
  boardSelectedIds: Set<string>;
  groupModalId: string | null;
  boardHistory: BoardNode[][];
  boardFuture: BoardNode[][];
  boardClipboard: BoardNode[];
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

  // board
  setViewMode: (m: ViewMode) => void;
  ensureBoard: () => Promise<string>;
  setBoardTool: (t: BoardTool) => void;
  setBoardViewport: (boardId: string, panX: number, panY: number, zoom: number) => void;
  createGroupNode: (boardId: string, x: number, y: number, w: number, h: number) => BoardGroupNode;
  createBeat: (
    boardId: string,
    params: {
      label: string;
      tags?: Record<string, string>;
      excludedClipIds?: string[];
    }
  ) => BoardGroupNode;
  reorderBeat: (id: string, direction: -1 | 1) => void;
  cloneBeat: (id: string) => BoardGroupNode | null;
  createRectNode: (boardId: string, x: number, y: number, w: number, h: number) => BoardRectNode;
  createTextNode: (boardId: string, x: number, y: number) => BoardTextNode;
  createArrowNode: (
    boardId: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    fromNodeId?: string,
    toNodeId?: string
  ) => BoardArrowNode;
  updateBoardNode: (id: string, patch: Partial<BoardNode>) => void;
  deleteBoardNodes: (ids: string[]) => void;
  selectBoardNodes: (ids: string[]) => void;
  toggleBoardNodeSelected: (id: string) => void;
  clearBoardSelection: () => void;
  openGroupModal: (id: string) => void;
  closeGroupModal: () => void;
  pushBoardHistory: () => void;
  undoBoard: () => void;
  redoBoard: () => void;
  copySelectedBoardNodes: () => void;
  pasteBoardClipboard: () => void;

  // backup
  exportBackup: () => BackupPayload;
  importBackup: (
    payload: BackupPayload,
    opts?: { mode?: "replace" | "merge" }
  ) => Promise<ImportSummary>;

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
    viewMode: "grid" as ViewMode,
    boards: {},
    boardNodes: {},
    currentBoardId: null,
    boardTool: "select" as BoardTool,
    boardSelectedIds: new Set<string>(),
    groupModalId: null,
    boardHistory: [],
    boardFuture: [],
    boardClipboard: [],
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
      const boards = await db.getAll<Board>("boards");
      const boardNodes = await db.getAll<BoardNode>("boardNodes");

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
      const boardMap: Record<string, Board> = {};
      for (const b of boards) boardMap[b.id] = b;
      const boardNodeMap: Record<string, BoardNode> = {};
      for (const n of boardNodes) boardNodeMap[n.id] = n;

      // One-time migration to the Beats model: wipe any existing board content
      // (free-form rectangles, text, arrows, and old groups). Future installs
      // start with an empty boardNodes anyway.
      const BEATS_MIGRATION_KEY = "storytime.beatsMigration.v1";
      try {
        if (
          localStorage.getItem(BEATS_MIGRATION_KEY) !== "done" &&
          Object.keys(boardNodeMap).length > 0
        ) {
          for (const id of Object.keys(boardNodeMap)) {
            delete boardNodeMap[id];
            db.deleteOne("boardNodes", id);
          }
        }
        localStorage.setItem(BEATS_MIGRATION_KEY, "done");
      } catch {}

      let needsPerm = false;
      if (meta?.rootHandle) {
        const ok = await (meta.rootHandle as any).queryPermission({ mode: "read" });
        needsPerm = ok !== "granted";
      }

      const sortedBoards = Object.values(boardMap).sort(
        (a, b) => a.createdAt - b.createdAt
      );
      const currentBoardId = sortedBoards[0]?.id ?? null;

      let savedViewMode: ViewMode = "grid";
      try {
        const raw = localStorage.getItem("storytime.viewMode");
        if (raw === "grid" || raw === "board") savedViewMode = raw;
      } catch {}

      set({
        ready: true,
        meta,
        clips: clipMap,
        buckets: bucketMap,
        planned: plannedMap,
        levels: levelMap,
        levelValues: valueMap,
        boards: boardMap,
        boardNodes: boardNodeMap,
        currentBoardId,
        viewMode: savedViewMode,
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

    setViewMode(m) {
      try {
        localStorage.setItem("storytime.viewMode", m);
      } catch {}
      set({ viewMode: m });
    },
    async ensureBoard() {
      const existing = get().currentBoardId;
      if (existing) return existing;
      const board: Board = {
        id: uid(),
        name: "Storyboard",
        panX: 0,
        panY: 0,
        zoom: 1,
        createdAt: Date.now(),
      };
      set({
        boards: { ...get().boards, [board.id]: board },
        currentBoardId: board.id,
      });
      await db.putOne("boards", board);
      return board.id;
    },
    setBoardTool(t) {
      set({ boardTool: t });
    },
    setBoardViewport(boardId, panX, panY, zoom) {
      const b = get().boards[boardId];
      if (!b) return;
      const u = { ...b, panX, panY, zoom };
      set({ boards: { ...get().boards, [boardId]: u } });
      db.putOne("boards", u);
    },

    createGroupNode(boardId, x, y, w, h) {
      get().pushBoardHistory();
      const peers = Object.values(get().boardNodes).filter((n) => n.boardId === boardId);
      const z = peers.length;
      const n: BoardGroupNode = {
        id: uid(),
        boardId,
        parentId: null,
        kind: "group",
        x,
        y,
        w,
        h,
        z,
        label: "Group",
      };
      set({
        boardNodes: { ...get().boardNodes, [n.id]: n },
        boardSelectedIds: new Set([n.id]),
      });
      db.putOne("boardNodes", n);
      return n;
    },
    createBeat(boardId, params) {
      get().pushBoardHistory();
      const peers = Object.values(get().boardNodes).filter(
        (n): n is BoardGroupNode => n.boardId === boardId && n.kind === "group"
      );
      const maxOrder = peers.reduce(
        (m, n) => Math.max(m, n.order ?? 0),
        -1
      );
      const n: BoardGroupNode = {
        id: uid(),
        boardId,
        parentId: null,
        kind: "group",
        x: 0,
        y: 0,
        w: 260,
        h: 200,
        z: peers.length,
        label: params.label,
        tags: params.tags,
        excludedClipIds: params.excludedClipIds,
        order: maxOrder + 1,
      };
      set({ boardNodes: { ...get().boardNodes, [n.id]: n } });
      db.putOne("boardNodes", n);
      return n;
    },
    cloneBeat(id) {
      const source = get().boardNodes[id];
      if (!source || source.kind !== "group") return null;
      get().pushBoardHistory();
      const sourceOrder = source.order ?? 0;
      // Bump every beat that sits at-or-after the source's NEXT slot by 1
      // so the clone slides in immediately after the original.
      const next: Record<string, BoardNode> = { ...get().boardNodes };
      for (const n of Object.values(next)) {
        if (n.kind !== "group" || n.boardId !== source.boardId) continue;
        if (n.id === source.id) continue;
        const o = n.order ?? 0;
        if (o > sourceOrder) {
          const u: BoardGroupNode = { ...n, order: o + 1 };
          next[n.id] = u;
          db.putOne("boardNodes", u);
        }
      }
      const peers = Object.values(next).filter(
        (n) => n.boardId === source.boardId
      );
      const cloned: BoardGroupNode = {
        ...source,
        id: uid(),
        label: `${source.label ?? "Untitled beat"} COPY`,
        order: sourceOrder + 1,
        z: peers.length,
        // arrays must be cloned so they don't share refs
        excludedClipIds: source.excludedClipIds
          ? [...source.excludedClipIds]
          : undefined,
        tags: source.tags ? { ...source.tags } : undefined,
      };
      next[cloned.id] = cloned;
      db.putOne("boardNodes", cloned);
      set({ boardNodes: next });
      return cloned;
    },
    reorderBeat(id, direction) {
      const node = get().boardNodes[id];
      if (!node || node.kind !== "group") return;
      const boardId = node.boardId;
      const beats = Object.values(get().boardNodes)
        .filter(
          (n): n is BoardGroupNode => n.boardId === boardId && n.kind === "group"
        )
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const idx = beats.findIndex((b) => b.id === id);
      if (idx < 0) return;
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= beats.length) return;
      get().pushBoardHistory();
      const a = beats[idx];
      const b = beats[swapIdx];
      const ao = a.order ?? idx;
      const bo = b.order ?? swapIdx;
      const ua: BoardGroupNode = { ...a, order: bo };
      const ub: BoardGroupNode = { ...b, order: ao };
      set({
        boardNodes: {
          ...get().boardNodes,
          [a.id]: ua,
          [b.id]: ub,
        },
      });
      db.putOne("boardNodes", ua);
      db.putOne("boardNodes", ub);
    },
    createRectNode(boardId, x, y, w, h) {
      get().pushBoardHistory();
      const peers = Object.values(get().boardNodes).filter((n) => n.boardId === boardId);
      const z = peers.length;
      const n: BoardRectNode = {
        id: uid(),
        boardId,
        parentId: null,
        kind: "rect",
        x,
        y,
        w,
        h,
        z,
        color: "#94a3b8",
      };
      set({
        boardNodes: { ...get().boardNodes, [n.id]: n },
        boardSelectedIds: new Set([n.id]),
      });
      db.putOne("boardNodes", n);
      return n;
    },
    createTextNode(boardId, x, y) {
      get().pushBoardHistory();
      const peers = Object.values(get().boardNodes).filter((n) => n.boardId === boardId);
      const z = peers.length;
      const n: BoardTextNode = {
        id: uid(),
        boardId,
        parentId: null,
        kind: "text",
        x,
        y,
        w: 220,
        h: 48,
        z,
        text: "",
        fontSize: 20,
      };
      set({
        boardNodes: { ...get().boardNodes, [n.id]: n },
        boardSelectedIds: new Set([n.id]),
      });
      db.putOne("boardNodes", n);
      return n;
    },
    createArrowNode(boardId, x1, y1, x2, y2, fromNodeId, toNodeId) {
      get().pushBoardHistory();
      const peers = Object.values(get().boardNodes).filter((n) => n.boardId === boardId);
      const z = peers.length;
      // x/y/w/h serve as a bbox for hit-test / move purposes.
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      const n: BoardArrowNode = {
        id: uid(),
        boardId,
        parentId: null,
        kind: "arrow",
        x,
        y,
        w,
        h,
        z,
        x1,
        y1,
        x2,
        y2,
        fromNodeId,
        toNodeId,
      };
      set({
        boardNodes: { ...get().boardNodes, [n.id]: n },
        boardSelectedIds: new Set([n.id]),
      });
      db.putOne("boardNodes", n);
      return n;
    },
    updateBoardNode(id, patch) {
      const n = get().boardNodes[id];
      if (!n) return;
      const u = { ...n, ...patch } as BoardNode;
      set({ boardNodes: { ...get().boardNodes, [id]: u } });
      db.putOne("boardNodes", u);
    },
    deleteBoardNodes(ids) {
      get().pushBoardHistory();
      const next = { ...get().boardNodes };
      for (const id of ids) {
        if (next[id]) {
          delete next[id];
          db.deleteOne("boardNodes", id);
        }
      }
      const nextSel = new Set(get().boardSelectedIds);
      for (const id of ids) nextSel.delete(id);
      set({ boardNodes: next, boardSelectedIds: nextSel });
    },

    selectBoardNodes(ids) {
      set({ boardSelectedIds: new Set(ids) });
    },
    toggleBoardNodeSelected(id) {
      const next = new Set(get().boardSelectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      set({ boardSelectedIds: next });
    },
    clearBoardSelection() {
      set({ boardSelectedIds: new Set() });
    },

    openGroupModal(id) {
      set({ groupModalId: id });
    },
    closeGroupModal() {
      set({ groupModalId: null });
    },

    pushBoardHistory() {
      const snapshot = Object.values(get().boardNodes).map((n) => ({ ...n }));
      const next = [...get().boardHistory, snapshot];
      if (next.length > 50) next.shift();
      set({ boardHistory: next, boardFuture: [] });
    },
    undoBoard() {
      const history = [...get().boardHistory];
      if (history.length === 0) return;
      const past = history.pop()!;
      const current = Object.values(get().boardNodes).map((n) => ({ ...n }));
      const future = [...get().boardFuture, current];
      // Apply snapshot
      const pastMap: Record<string, BoardNode> = {};
      for (const n of past) pastMap[n.id] = n;
      // DB sync: delete current nodes not in past; upsert past nodes
      const currentIds = new Set(current.map((n) => n.id));
      const pastIds = new Set(past.map((n) => n.id));
      for (const id of currentIds) {
        if (!pastIds.has(id)) db.deleteOne("boardNodes", id);
      }
      for (const n of past) db.putOne("boardNodes", n);
      // Filter selection to ids that still exist
      const nextSel = new Set<string>();
      for (const id of get().boardSelectedIds) if (pastMap[id]) nextSel.add(id);
      set({
        boardNodes: pastMap,
        boardHistory: history,
        boardFuture: future,
        boardSelectedIds: nextSel,
      });
    },
    redoBoard() {
      const future = [...get().boardFuture];
      if (future.length === 0) return;
      const ahead = future.pop()!;
      const current = Object.values(get().boardNodes).map((n) => ({ ...n }));
      const history = [...get().boardHistory, current];
      const aheadMap: Record<string, BoardNode> = {};
      for (const n of ahead) aheadMap[n.id] = n;
      const currentIds = new Set(current.map((n) => n.id));
      const aheadIds = new Set(ahead.map((n) => n.id));
      for (const id of currentIds) {
        if (!aheadIds.has(id)) db.deleteOne("boardNodes", id);
      }
      for (const n of ahead) db.putOne("boardNodes", n);
      const nextSel = new Set<string>();
      for (const id of get().boardSelectedIds) if (aheadMap[id]) nextSel.add(id);
      set({
        boardNodes: aheadMap,
        boardHistory: history,
        boardFuture: future,
        boardSelectedIds: nextSel,
      });
    },

    copySelectedBoardNodes() {
      const ids = get().boardSelectedIds;
      if (ids.size === 0) return;
      const snapshot: BoardNode[] = [];
      for (const id of ids) {
        const n = get().boardNodes[id];
        if (n) snapshot.push({ ...n });
      }
      set({ boardClipboard: snapshot });
    },
    pasteBoardClipboard() {
      const clipboard = get().boardClipboard;
      if (clipboard.length === 0) return;
      const boardId = get().currentBoardId;
      if (!boardId) return;
      // snapshot for undo BEFORE applying
      get().pushBoardHistory();

      const peers = Object.values(get().boardNodes).filter((n) => n.boardId === boardId);
      let z = peers.length;
      const idMap: Record<string, string> = {};
      for (const n of clipboard) idMap[n.id] = uid();

      const offset = 24;
      const next: Record<string, BoardNode> = { ...get().boardNodes };
      const newIds: string[] = [];

      for (const old of clipboard) {
        const newId = idMap[old.id];
        let newNode: BoardNode;
        const base = { id: newId, boardId, parentId: null, z: z++ };
        if (old.kind === "arrow") {
          newNode = {
            ...old,
            ...base,
            x: old.x + offset,
            y: old.y + offset,
            x1: old.x1 + offset,
            y1: old.y1 + offset,
            x2: old.x2 + offset,
            y2: old.y2 + offset,
            // Remap attachments only if both ends were copied too
            fromNodeId:
              old.fromNodeId && idMap[old.fromNodeId]
                ? idMap[old.fromNodeId]
                : undefined,
            toNodeId:
              old.toNodeId && idMap[old.toNodeId]
                ? idMap[old.toNodeId]
                : undefined,
          };
        } else if (old.kind === "group") {
          newNode = { ...old, ...base, x: old.x + offset, y: old.y + offset };
        } else if (old.kind === "rect") {
          newNode = { ...old, ...base, x: old.x + offset, y: old.y + offset };
        } else if (old.kind === "text") {
          newNode = { ...old, ...base, x: old.x + offset, y: old.y + offset };
        } else continue;
        next[newId] = newNode;
        newIds.push(newId);
        db.putOne("boardNodes", newNode);
      }
      set({ boardNodes: next, boardSelectedIds: new Set(newIds) });
    },

    exportBackup() {
      const s = get();
      const clipTags: BackupPayload["clipTags"] = [];
      for (const c of Object.values(s.clips)) {
        if (c.tags && Object.keys(c.tags).length > 0) {
          clipTags.push({
            fingerprint: c.fingerprint,
            path: c.path,
            tags: { ...c.tags },
          });
        }
      }
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        project: s.meta?.name,
        levels: Object.values(s.levels),
        levelValues: Object.values(s.levelValues),
        clipTags,
        boards: Object.values(s.boards),
        boardNodes: Object.values(s.boardNodes),
      };
    },

    async importBackup(payload, opts) {
      const mode = opts?.mode ?? "replace";

      // Replace mode: wipe current levels/values/boards & clear clip.tags first
      let nextLevels: Record<string, Level>;
      let nextValues: Record<string, LevelValue>;
      let nextBoards: Record<string, Board>;
      let nextBoardNodes: Record<string, BoardNode>;
      let nextClips = { ...get().clips };

      if (mode === "replace") {
        for (const id of Object.keys(get().levels)) await db.deleteOne("levels", id);
        for (const id of Object.keys(get().levelValues))
          await db.deleteOne("levelValues", id);
        for (const id of Object.keys(get().boards)) await db.deleteOne("boards", id);
        for (const id of Object.keys(get().boardNodes))
          await db.deleteOne("boardNodes", id);
        nextLevels = {};
        nextValues = {};
        nextBoards = {};
        nextBoardNodes = {};
        for (const c of Object.values(nextClips)) {
          if (c.tags && Object.keys(c.tags).length > 0) {
            const u = { ...c, tags: {} };
            nextClips[c.id] = u;
            await db.putOne("clips", u);
          }
        }
      } else {
        nextLevels = { ...get().levels };
        nextValues = { ...get().levelValues };
        nextBoards = { ...get().boards };
        nextBoardNodes = { ...get().boardNodes };
      }

      // Apply levels
      for (const l of payload.levels) {
        nextLevels[l.id] = l;
        await db.putOne("levels", l);
      }
      // Apply values
      for (const v of payload.levelValues) {
        nextValues[v.id] = v;
        await db.putOne("levelValues", v);
      }
      // Apply boards + nodes (optional)
      for (const b of payload.boards ?? []) {
        nextBoards[b.id] = b;
        await db.putOne("boards", b);
      }
      for (const n of payload.boardNodes ?? []) {
        nextBoardNodes[n.id] = n;
        await db.putOne("boardNodes", n);
      }

      // Build lookup maps for matching clips
      const byFingerprint = new Map<string, string>();
      const byPath = new Map<string, string>();
      for (const c of Object.values(nextClips)) {
        byFingerprint.set(c.fingerprint, c.id);
        byPath.set(c.path.join("/"), c.id);
      }

      let tagged = 0;
      let unmatched = 0;
      for (const entry of payload.clipTags) {
        let clipId =
          byFingerprint.get(entry.fingerprint) ??
          byPath.get(entry.path.join("/"));
        if (!clipId) {
          unmatched++;
          continue;
        }
        const existing = nextClips[clipId];
        const mergedTags =
          mode === "merge"
            ? { ...(existing.tags ?? {}), ...entry.tags }
            : { ...entry.tags };
        const u = { ...existing, tags: mergedTags };
        nextClips[clipId] = u;
        await db.putOne("clips", u);
        tagged++;
      }

      const sortedBoards = Object.values(nextBoards).sort(
        (a, b) => a.createdAt - b.createdAt
      );
      const currentBoardId = sortedBoards[0]?.id ?? null;

      set({
        levels: nextLevels,
        levelValues: nextValues,
        boards: nextBoards,
        boardNodes: nextBoardNodes,
        currentBoardId,
        clips: nextClips,
        selection: { kind: "all" },
        selectedClipIds: new Set(),
      });

      return {
        levels: payload.levels.length,
        values: payload.levelValues.length,
        taggedClips: tagged,
        unmatchedClips: unmatched,
      };
    },
  };
});

import { create } from "zustand";
import type {
  Board,
  BoardAnnotationNode,
  BoardArrowNode,
  BoardEventNode,
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
import { computeAutoLayout } from "../lib/eventLayout";

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
export type BoardTool = "select" | "annotation";

export type Selection =
  | { kind: "all" }
  | { kind: "new" }
  | { kind: "untagged"; levelId: string }
  // Multi-level AND filter: one value per level. Clip must match each entry.
  | { kind: "filter"; tags: Record<string, string> }
  | { kind: "folder-day"; day: string }
  | { kind: "folder-event"; day: string; event: string }
  | { kind: "folder-source"; day: string; event: string; source: string };

export interface ScanState {
  active: boolean;
  count: number;
  current?: string;
}

export interface ExtractionState {
  active: boolean;
  done: number;
  total: number;
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
  extraction: ExtractionState;
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
  setClipFps: (clipId: string, fps: number) => Promise<void>;
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
  createGroupNode: (boardId: string, x: number, y: number, w: number, h: number) => BoardEventNode;
  createEvent: (
    boardId: string,
    params: {
      label: string;
      tags?: Record<string, string[]>;
      excludedClipIds?: string[];
      x?: number;
      y?: number;
    }
  ) => BoardEventNode;
  reorderEvent: (id: string, direction: -1 | 1) => void;
  cloneEvent: (id: string, opts?: { defaultDx?: number }) => BoardEventNode | null;
  connectEvents: (fromId: string, toId: string) => boolean;
  disconnectEvents: (fromId: string, toId: string) => void;
  createRectNode: (boardId: string, x: number, y: number, w: number, h: number) => BoardRectNode;
  createTextNode: (boardId: string, x: number, y: number) => BoardTextNode;
  createAnnotation: (
    boardId: string,
    x: number,
    y: number,
    w: number,
    h: number,
    label?: string
  ) => BoardAnnotationNode;
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

  // automatic in-app rolling snapshots
  lastSnapshotAt: number;
  takeSnapshot: () => Promise<void>;
  restoreSnapshot: (snapshot: db.SnapshotRecord) => Promise<void>;

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

// Module-level scratch for the debounced viewport persistence — keeps
// pan/zoom drags off the IndexedDB hot path.
let viewportPersistTimer: number | null = null;
let viewportPersistPending: Board | null = null;

// throttle thumb extraction
class ThumbQueue {
  private q: string[] = [];
  private inFlight = 0;
  private max = 3;
  private totalEnqueued = 0;
  private totalDone = 0;
  private run: (id: string) => Promise<void>;
  private onProgress: (done: number, total: number, active: boolean) => void;
  constructor(
    run: (id: string) => Promise<void>,
    onProgress: (done: number, total: number, active: boolean) => void
  ) {
    this.run = run;
    this.onProgress = onProgress;
  }
  push(ids: string[]) {
    let added = 0;
    for (const id of ids) {
      if (!this.q.includes(id)) {
        this.q.push(id);
        added++;
      }
    }
    if (added > 0) {
      this.totalEnqueued += added;
      this.notifyProgress();
    }
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
          this.totalDone++;
          if (this.inFlight === 0 && this.q.length === 0) {
            // Batch complete — reset counters so the next batch starts fresh.
            this.totalDone = 0;
            this.totalEnqueued = 0;
          }
          this.notifyProgress();
          this.kick();
        });
    }
  }
  private notifyProgress() {
    const active = this.totalEnqueued > 0;
    this.onProgress(this.totalDone, this.totalEnqueued, active);
  }
}

export const useStore = create<StoreState>((set, get) => {
  const thumbQueue = new ThumbQueue(
    async (id) => {
      await get().ensureThumb(id);
    },
    (done, total, active) => {
      set({ extraction: { active, done, total } });
    }
  );

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
    lastSnapshotAt: 0,
    scan: { active: false, count: 0 },
    extraction: { active: false, done: 0, total: 0 },
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

      // One-time migration to the Events model: wipe any existing board content
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

      // Migration v2: turn the existing linear `order` chain into a DAG by
      // populating each event's `nextIds` with the next event in order. Runs once
      // per project. New installs are no-ops.
      const GRAPH_MIGRATION_KEY = "storytime.beatsGraph.v1";
      try {
        if (localStorage.getItem(GRAPH_MIGRATION_KEY) !== "done") {
          const groupEvents = Object.values(boardNodeMap)
            .filter((n): n is BoardEventNode => n.kind === "event")
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          for (let i = 0; i < groupEvents.length; i++) {
            const event = groupEvents[i];
            if (event.nextIds !== undefined) continue; // already migrated this event
            const next = i < groupEvents.length - 1 ? [groupEvents[i + 1].id] : [];
            const updated: BoardEventNode = { ...event, nextIds: next };
            boardNodeMap[event.id] = updated;
            await db.putOne("boardNodes", updated);
          }
          localStorage.setItem(GRAPH_MIGRATION_KEY, "done");
        }
      } catch {}

      // Migration v4: switch events from auto-DAG layout (recomputed every
      // render) to manual positions stored on each event. Persist whatever
      // the auto-DAG produced for the current data so nothing visually moves.
      const MANUAL_LAYOUT_KEY = "storytime.beatsManualLayout.v1";
      try {
        if (localStorage.getItem(MANUAL_LAYOUT_KEY) !== "done") {
          const groupEvents = Object.values(boardNodeMap).filter(
            (n): n is BoardEventNode => n.kind === "event"
          );
          if (groupEvents.length > 0) {
            const positions = computeAutoLayout(
              groupEvents,
              levelMap,
              valueMap,
              clipMap
            );
            for (const p of positions) {
              const event = boardNodeMap[p.event.id] as BoardEventNode;
              const updated: BoardEventNode = {
                ...event,
                x: p.x,
                y: p.y,
              };
              boardNodeMap[event.id] = updated;
              await db.putOne("boardNodes", updated);
            }
          }
          localStorage.setItem(MANUAL_LAYOUT_KEY, "done");
        }
      } catch {}

      // Migration v3: event tags shifted from `Record<lid, vid>` to
      // `Record<lid, vid[]>` to support multi-select filters. Wrap any legacy
      // string values in single-item arrays.
      const MULTITAG_MIGRATION_KEY = "storytime.beatsMultiTag.v1";
      try {
        if (localStorage.getItem(MULTITAG_MIGRATION_KEY) !== "done") {
          for (const n of Object.values(boardNodeMap)) {
            if (n.kind !== "event") continue;
            if (!n.tags) continue;
            let dirty = false;
            const newTags: Record<string, string[]> = {};
            for (const [lid, val] of Object.entries(n.tags)) {
              if (Array.isArray(val)) {
                newTags[lid] = val;
              } else if (typeof val === "string" && val) {
                newTags[lid] = [val];
                dirty = true;
              }
            }
            if (dirty) {
              const updated: BoardEventNode = { ...n, tags: newTags };
              boardNodeMap[n.id] = updated;
              await db.putOne("boardNodes", updated);
            }
          }
          localStorage.setItem(MULTITAG_MIGRATION_KEY, "done");
        }
      } catch {}

      // Migration v5: rename event-node discriminator from "group" → "event"
      // alongside the user-facing rename of Beats → Events. Old saved nodes
      // have kind: "group"; rewrite to kind: "event" so the new code can find
      // them. Other kinds ("annotation", "arrow", etc.) are untouched.
      const EVENT_KIND_MIGRATION_KEY = "storytime.eventKindRename.v1";
      try {
        if (localStorage.getItem(EVENT_KIND_MIGRATION_KEY) !== "done") {
          for (const n of Object.values(boardNodeMap)) {
            if ((n as { kind?: string }).kind === "group") {
              const updated = { ...n, kind: "event" } as BoardEventNode;
              boardNodeMap[n.id] = updated;
              await db.putOne("boardNodes", updated);
            }
          }
          localStorage.setItem(EVENT_KIND_MIGRATION_KEY, "done");
        }
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

        // Enqueue any clip that's missing thumb or fps for background
        // extraction. ensureThumb handles both in a single pass.
        const needsExtraction = Object.values(next)
          .filter((c) => !c.thumbFailed && (!c.thumb || c.fps === undefined || c.hasAudio === undefined))
          .map((c) => c.id);
        if (needsExtraction.length > 0) thumbQueue.push(needsExtraction);
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

      // Enqueue extraction for any clip that's missing thumb OR fps. The
      // ensureThumb action handles both cases (re-extracts thumb if needed
      // and measures fps in the same pass).
      const needsExtraction = Object.values(next)
        .filter((c) => !c.thumbFailed && (!c.thumb || c.fps === undefined || c.hasAudio === undefined))
        .map((c) => c.id);
      thumbQueue.push(needsExtraction);
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
      // Skip when fully complete OR when extraction has already failed.
      // Clips with a thumb but missing fps or hasAudio fall through so we
      // backfill those fields for pre-existing installs (FCPXML export needs
      // them — wrong defaults make FCP refuse to relink).
      if (!c || c.thumbFailed) return;
      if (c.thumb && c.fps !== undefined && c.hasAudio !== undefined) return;
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
        ...(r.fps !== undefined ? { fps: r.fps } : {}),
        hasAudio: r.hasAudio,
      };
      set({ clips: { ...get().clips, [clipId]: updated } });
      await db.putOne("clips", { ...updated, thumb: undefined });
      await db.putThumb(clipId, r.dataUrl);
    },

    enqueueThumbs(ids) {
      thumbQueue.push(ids);
    },

    async setClipFps(clipId, fps) {
      const c = get().clips[clipId];
      if (!c) return;
      if (c.fps !== undefined && Math.abs(c.fps - fps) < 0.01) return;
      const updated: Clip = { ...c, fps };
      set({ clips: { ...get().clips, [clipId]: updated } });
      await db.putOne("clips", { ...updated, thumb: undefined });
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
        case "filter": {
          const entries = Object.entries(selection.tags);
          if (entries.length === 0) break;
          out = arr.filter((c) => {
            if (!c.tags) return false;
            for (const [lid, vid] of entries) {
              if (c.tags[lid] !== vid) return false;
            }
            return true;
          });
          break;
        }
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
      if (s.kind === "untagged" && s.levelId === id) {
        set({ selection: { kind: "all" } });
      } else if (s.kind === "filter" && s.tags[id]) {
        const { [id]: _, ...rest } = s.tags;
        if (Object.keys(rest).length === 0) set({ selection: { kind: "all" } });
        else set({ selection: { kind: "filter", tags: rest } });
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
      if (s.kind === "filter") {
        const dirty = Object.entries(s.tags).some(([, vid]) => vid === id);
        if (dirty) {
          const nextTags: Record<string, string> = {};
          for (const [lid, vid] of Object.entries(s.tags))
            if (vid !== id) nextTags[lid] = vid;
          if (Object.keys(nextTags).length === 0)
            set({ selection: { kind: "all" } });
          else set({ selection: { kind: "filter", tags: nextTags } });
        }
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
      // Defer DB write so a continuous pan/zoom drag doesn't hammer IndexedDB.
      viewportPersistPending = u;
      if (viewportPersistTimer !== null) clearTimeout(viewportPersistTimer);
      viewportPersistTimer = window.setTimeout(() => {
        if (viewportPersistPending) {
          db.putOne("boards", viewportPersistPending);
          viewportPersistPending = null;
        }
        viewportPersistTimer = null;
      }, 250);
    },

    createGroupNode(boardId, x, y, w, h) {
      get().pushBoardHistory();
      const peers = Object.values(get().boardNodes).filter((n) => n.boardId === boardId);
      const z = peers.length;
      const n: BoardEventNode = {
        id: uid(),
        boardId,
        parentId: null,
        kind: "event",
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
    createEvent(boardId, params) {
      get().pushBoardHistory();
      const peers = Object.values(get().boardNodes).filter(
        (n): n is BoardEventNode => n.boardId === boardId && n.kind === "event"
      );
      const maxOrder = peers.reduce(
        (m, n) => Math.max(m, n.order ?? 0),
        -1
      );
      const n: BoardEventNode = {
        id: uid(),
        boardId,
        parentId: null,
        kind: "event",
        x: params.x ?? 0,
        y: params.y ?? 0,
        w: 260,
        h: 200,
        z: peers.length,
        label: params.label,
        tags: params.tags,
        excludedClipIds: params.excludedClipIds,
        order: maxOrder + 1,
        nextIds: [],
      };
      set({ boardNodes: { ...get().boardNodes, [n.id]: n } });
      db.putOne("boardNodes", n);
      return n;
    },
    cloneEvent(id, opts) {
      const source = get().boardNodes[id];
      if (!source || source.kind !== "event") return null;
      get().pushBoardHistory();
      const peers = Object.values(get().boardNodes).filter(
        (n) => n.boardId === source.boardId
      );
      const maxOrder = peers.reduce(
        (m, n) => Math.max(m, (n as BoardEventNode).order ?? 0),
        0
      );

      // Direction inheritance: place the clone in the same relative direction
      // from `source` that `source` sits from its first parent.
      let dx: number;
      let dy: number;
      let parent: BoardEventNode | null = null;
      for (const n of Object.values(get().boardNodes)) {
        if (n.kind === "event" && (n.nextIds ?? []).includes(source.id)) {
          parent = n;
          break;
        }
      }
      if (parent) {
        dx = source.x - parent.x;
        dy = source.y - parent.y;
      } else {
        // No parent — default to "place to the right" using source's own width
        // (best estimate available without canvas math here).
        dx = (opts?.defaultDx ?? (source.w || 280) + 80);
        dy = 0;
      }
      // Snap to grid so manual drags and clone offsets stay tidy.
      const SNAP = 12;
      const snap = (v: number) => Math.round(v / SNAP) * SNAP;
      const newX = snap(source.x + dx);
      const newY = snap(source.y + dy);

      const cloned: BoardEventNode = {
        ...source,
        id: uid(),
        label: `${source.label ?? "Untitled event"} COPY`,
        order: maxOrder + 1,
        z: peers.length,
        x: newX,
        y: newY,
        excludedClipIds: source.excludedClipIds
          ? [...source.excludedClipIds]
          : undefined,
        tags: source.tags ? { ...source.tags } : undefined,
        nextIds: [],
      };
      const updatedSource: BoardEventNode = {
        ...source,
        nextIds: [...(source.nextIds ?? []), cloned.id],
      };
      const nextMap = {
        ...get().boardNodes,
        [source.id]: updatedSource,
        [cloned.id]: cloned,
      };
      set({ boardNodes: nextMap });
      db.putOne("boardNodes", updatedSource);
      db.putOne("boardNodes", cloned);
      return cloned;
    },
    reorderEvent(id, direction) {
      const node = get().boardNodes[id];
      if (!node || node.kind !== "event") return;
      const boardId = node.boardId;
      const events = Object.values(get().boardNodes)
        .filter(
          (n): n is BoardEventNode => n.boardId === boardId && n.kind === "event"
        )
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const idx = events.findIndex((b) => b.id === id);
      if (idx < 0) return;
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= events.length) return;
      get().pushBoardHistory();
      const a = events[idx];
      const b = events[swapIdx];
      const ao = a.order ?? idx;
      const bo = b.order ?? swapIdx;
      const ua: BoardEventNode = { ...a, order: bo };
      const ub: BoardEventNode = { ...b, order: ao };
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
    createAnnotation(boardId, x, y, w, h, label) {
      get().pushBoardHistory();
      const peers = Object.values(get().boardNodes).filter(
        (n) => n.boardId === boardId
      );
      const n: BoardAnnotationNode = {
        id: uid(),
        boardId,
        parentId: null,
        kind: "annotation",
        x,
        y,
        w,
        h,
        // Lowest z so annotations sit BEHIND events and arrows visually.
        z: -1,
        label: label ?? "Section",
      };
      set({
        boardNodes: { ...get().boardNodes, [n.id]: n },
        boardSelectedIds: new Set([n.id]),
      });
      // Compensate the rest's z so the new annotation sorts to the back.
      // (We just rely on render order: annotations render before events.)
      void peers;
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
      const idSet = new Set(ids);
      // Clean up nextIds references to deleted events.
      for (const n of Object.values(next)) {
        if (n.kind !== "event") continue;
        const nexts = n.nextIds;
        if (!nexts || !nexts.some((nid) => idSet.has(nid))) continue;
        const updated: BoardEventNode = {
          ...n,
          nextIds: nexts.filter((nid) => !idSet.has(nid)),
        };
        next[n.id] = updated;
        db.putOne("boardNodes", updated);
      }
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

    connectEvents(fromId, toId) {
      if (fromId === toId) return false;
      const all = get().boardNodes;
      const from = all[fromId];
      const to = all[toId];
      if (!from || !to || from.kind !== "event" || to.kind !== "event")
        return false;
      const currentNexts = from.nextIds ?? [];
      if (currentNexts.includes(toId)) return false;
      // Cycle check: walk forward from `toId`; if we reach `fromId`, abort.
      const visited = new Set<string>();
      const stack = [toId];
      while (stack.length) {
        const id = stack.pop()!;
        if (id === fromId) return false;
        if (visited.has(id)) continue;
        visited.add(id);
        const n = all[id];
        if (n && n.kind === "event" && n.nextIds) stack.push(...n.nextIds);
      }
      get().pushBoardHistory();
      const updated: BoardEventNode = {
        ...from,
        nextIds: [...currentNexts, toId],
      };
      set({ boardNodes: { ...get().boardNodes, [fromId]: updated } });
      db.putOne("boardNodes", updated);
      return true;
    },
    disconnectEvents(fromId, toId) {
      const from = get().boardNodes[fromId];
      if (!from || from.kind !== "event") return;
      const nexts = from.nextIds ?? [];
      if (!nexts.includes(toId)) return;
      get().pushBoardHistory();
      const updated: BoardEventNode = {
        ...from,
        nextIds: nexts.filter((id) => id !== toId),
      };
      set({ boardNodes: { ...get().boardNodes, [fromId]: updated } });
      db.putOne("boardNodes", updated);
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
        } else if (old.kind === "event") {
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

    async takeSnapshot() {
      const payload = get().exportBackup();
      const snapshot: db.SnapshotRecord = {
        id: uid(),
        timestamp: Date.now(),
        payload,
      };
      await db.putSnapshot(snapshot);
      // Prune to the most recent 20
      const all = await db.getAllSnapshots();
      if (all.length > 20) {
        all.sort((a, b) => b.timestamp - a.timestamp);
        for (const s of all.slice(20)) {
          await db.deleteSnapshot(s.id);
        }
      }
      set({ lastSnapshotAt: snapshot.timestamp });
    },
    async restoreSnapshot(snapshot) {
      await get().importBackup(snapshot.payload as BackupPayload, {
        mode: "replace",
      });
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
      for (const rawN of payload.boardNodes ?? []) {
        // Backups exported before the Beats → Events rename have kind: "group".
        // Translate on import so the rest of the app finds them as events.
        const n =
          (rawN as { kind?: string }).kind === "group"
            ? ({ ...rawN, kind: "event" } as BoardNode)
            : rawN;
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

import { openDB, type IDBPDatabase } from "idb";
import type {
  Board,
  BoardNode,
  Bucket,
  Clip,
  Level,
  LevelValue,
  PlannedShot,
  ProjectMeta,
} from "../types";

const DB_NAME = "storytime";
const DB_VERSION = 4;

export interface SnapshotRecord {
  id: string;
  timestamp: number;
  // Stored as a plain object — a BackupPayload, but kept as `any` here to avoid
  // circular imports from the store.
  payload: any;
}

interface Schema {
  meta: { key: string; value: ProjectMeta };
  clips: { key: string; value: Clip };
  buckets: { key: string; value: Bucket };
  planned: { key: string; value: PlannedShot };
  thumbs: { key: string; value: { id: string; dataUrl: string } };
  levels: { key: string; value: Level };
  levelValues: { key: string; value: LevelValue };
  boards: { key: string; value: Board };
  boardNodes: { key: string; value: BoardNode };
  snapshots: { key: string; value: SnapshotRecord };
}

let dbp: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
        if (!db.objectStoreNames.contains("clips")) db.createObjectStore("clips", { keyPath: "id" });
        if (!db.objectStoreNames.contains("buckets")) db.createObjectStore("buckets", { keyPath: "id" });
        if (!db.objectStoreNames.contains("planned")) db.createObjectStore("planned", { keyPath: "id" });
        if (!db.objectStoreNames.contains("thumbs")) db.createObjectStore("thumbs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("levels")) db.createObjectStore("levels", { keyPath: "id" });
        if (!db.objectStoreNames.contains("levelValues")) db.createObjectStore("levelValues", { keyPath: "id" });
        if (!db.objectStoreNames.contains("boards")) db.createObjectStore("boards", { keyPath: "id" });
        if (!db.objectStoreNames.contains("boardNodes")) db.createObjectStore("boardNodes", { keyPath: "id" });
        if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "id" });
      },
    });
  }
  return dbp;
}

export async function saveMeta(meta: ProjectMeta) {
  const db = await getDB();
  await db.put("meta", meta);
}
export async function loadMeta(): Promise<ProjectMeta | undefined> {
  const db = await getDB();
  const all = await db.getAll("meta");
  return all[0];
}

export async function putAll<T extends { id: string }>(
  store: keyof Schema,
  items: T[]
) {
  if (!items.length) return;
  const db = await getDB();
  const tx = db.transaction(store, "readwrite");
  await Promise.all(items.map((it) => tx.store.put(it)));
  await tx.done;
}

export async function getAll<T>(store: keyof Schema): Promise<T[]> {
  const db = await getDB();
  return (await db.getAll(store)) as T[];
}

export async function putOne(store: keyof Schema, item: any) {
  const db = await getDB();
  await db.put(store, item);
}
export async function deleteOne(store: keyof Schema, id: string) {
  const db = await getDB();
  await db.delete(store, id);
}

export async function putThumb(id: string, dataUrl: string) {
  const db = await getDB();
  await db.put("thumbs", { id, dataUrl });
}
export async function getThumb(id: string): Promise<string | undefined> {
  const db = await getDB();
  const v = await db.get("thumbs", id);
  return (v as any)?.dataUrl;
}

export async function putSnapshot(s: SnapshotRecord) {
  const db = await getDB();
  await db.put("snapshots", s);
}
export async function getAllSnapshots(): Promise<SnapshotRecord[]> {
  const db = await getDB();
  return (await db.getAll("snapshots")) as SnapshotRecord[];
}
export async function deleteSnapshot(id: string) {
  const db = await getDB();
  await db.delete("snapshots", id);
}

export type ClipId = string;
export type BucketId = string;
export type PlannedId = string;
export type SourceKey = string;
export type LevelId = string;
export type LevelValueId = string;
export type BoardId = string;
export type BoardNodeId = string;

export interface Board {
  id: BoardId;
  name: string;
  panX: number;
  panY: number;
  zoom: number;
  createdAt: number;
}

export interface BoardNodeBase {
  id: BoardNodeId;
  boardId: BoardId;
  parentId: BoardNodeId | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  label?: string;
  color?: string;
}

export type BoardGroupSort = "name-asc" | "name-desc" | "date-desc" | "date-asc";

export interface BoardGroupNode extends BoardNodeBase {
  kind: "group";
  // Beats are saved filters: a clip is "in" the beat if it matches all
  // (levelId -> valueId) pairs in `tags`. Empty/absent tags = matches every clip.
  tags?: Record<LevelId, LevelValueId>;
  sort?: BoardGroupSort;
  // Position in the beat sequence. Lower comes first.
  order?: number;
  // Clip ids explicitly excluded from this beat even if they match the filter.
  excludedClipIds?: ClipId[];
}

export interface BoardRectNode extends BoardNodeBase {
  kind: "rect";
}

export interface BoardTextNode extends BoardNodeBase {
  kind: "text";
  text: string;
  fontSize?: number;
}

// Arrows use endpoints instead of box. We keep x/y/w/h from BoardNodeBase as a
// derived bounding box for consistency with the others (computed on write).
export interface BoardArrowNode extends BoardNodeBase {
  kind: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fromNodeId?: BoardNodeId;
  toNodeId?: BoardNodeId;
}

export type BoardNode =
  | BoardGroupNode
  | BoardRectNode
  | BoardTextNode
  | BoardArrowNode;

export interface Level {
  id: LevelId;
  name: string;
  order: number;
}

export interface LevelValue {
  id: LevelValueId;
  levelId: LevelId;
  name: string;
  color: string;
  order: number;
}

export interface Clip {
  id: ClipId;
  // Path segments from the project root, last one is filename.
  path: string[];
  name: string;
  size: number;
  lastModified: number;
  day: string;      // first-level dir name
  event: string;    // second-level dir name (or "_")
  source: string;   // third-level dir name (or "_")
  durationMs?: number;
  width?: number;
  height?: number;
  thumb?: string;   // data URL
  thumbFailed?: boolean;
  // user-state
  notes?: string;
  bucketIds: BucketId[];
  // Map of configured level id -> chosen value id. Single-value per level.
  tags?: Record<LevelId, LevelValueId>;
  // Linked planned shot id, if user marked it as fulfilling a plan.
  fulfillsPlannedId?: PlannedId;
  // True if discovered on a later scan than initial.
  isNew?: boolean;
  // Stable id derived from path+size+mtime — used to reconcile across scans.
  fingerprint: string;
}

export interface PlannedShot {
  id: PlannedId;
  title: string;
  notes?: string;
  // optional location in the hierarchy
  day?: string;
  event?: string;
  source?: string;
  bucketIds: BucketId[];
  // done without linking, or linked via Clip.fulfillsPlannedId
  done: boolean;
  createdAt: number;
}

export interface Bucket {
  id: BucketId;
  name: string;
  color: string; // hex / css color
  collapsed: boolean;
  order: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  // root directory handle (Chromium IDB-serializable)
  rootHandle?: FileSystemDirectoryHandle;
  lastScanAt: number;
  createdAt: number;
}

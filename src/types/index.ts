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

export type BoardEventSort = "name-asc" | "name-desc" | "date-desc" | "date-asc";

export interface BoardEventNode extends BoardNodeBase {
  kind: "event";
  // Events are saved filters. For each level present in `tags`, the clip's
  // value at that level must be in the listed values (OR within level). The
  // event matches a clip only if every level present here passes (AND across
  // levels). Empty/absent `tags` = no filter at all = every clip matches.
  tags?: Record<LevelId, LevelValueId[]>;
  sort?: BoardEventSort;
  // Sequence-within-rank tiebreaker. Higher = appears later in its column.
  order?: number;
  // Clip ids explicitly excluded from this event even if they match the filter.
  excludedClipIds?: ClipId[];
  // Outgoing edges in the event graph. A event with multiple ids fans out
  // (branches); multiple events can point at the same target (merge).
  nextIds?: BoardNodeId[];
}

export interface BoardRectNode extends BoardNodeBase {
  kind: "rect";
}

export interface BoardTextNode extends BoardNodeBase {
  kind: "text";
  text: string;
  fontSize?: number;
}

// Unreal Engine "comment" / annotation: bordered region with a header label.
// Used to visually group events and label a section of the story.
export interface BoardAnnotationNode extends BoardNodeBase {
  kind: "annotation";
  label: string;
  color?: string;
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
  | BoardEventNode
  | BoardRectNode
  | BoardTextNode
  | BoardArrowNode
  | BoardAnnotationNode;

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
  // Detected frame rate (e.g. 29.97, 30, 59.94, 60). Used by FCPXML export to
  // emit per-fps <format> entries so relink doesn't reject mixed-fps shoots.
  fps?: number;
  // Exact rational form of the per-frame duration: sampleDelta / timescale
  // seconds, read from the file's `mdhd`/`stts` atoms. FCP checks bit-exact
  // equality on relink, so for non-standard rates (e.g. 30.04 fps) we need
  // the raw integers, not a snapped approximation.
  fpsSampleDelta?: number;
  fpsTimescale?: number;
  // True for variable-frame-rate clips (Snapchat, screen recordings). FCPXML
  // assets are CFR-only; we skip these from the FCPXML and surface them in
  // the export warning so the user knows to transcode before importing.
  isVariableFps?: boolean;
  // True/false from audio-byte-count probe during scan. Used by FCPXML export
  // so audio-less footage (drones, screen recordings) doesn't get hasAudio=1
  // and fail relink.
  hasAudio?: boolean;
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

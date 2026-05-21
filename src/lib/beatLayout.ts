import type {
  BoardGroupNode,
  Clip,
  Level,
  LevelValue,
} from "../types";
import { clipsMatchingGroup } from "./beatFilter";

export const BEAT_MIN_WIDTH = 280;
export const BEAT_MAX_WIDTH = 540;
export const BEAT_HEIGHT = 220;
export const GAP_X = 80;
export const GAP_Y = 56;
export const PADDING = 60;
export const COLS = 5;

// Snap step for drag-to-move and direction-inherit clone placement.
export const SNAP_PX = 12;

const HEADER_CHROME_WIDTH = 20 + 3 * 24 + 4 * 6 + 24; // number + 3 buttons + gaps + px
const LABEL_PADDING = 18;
const LABEL_FONT =
  '500 14px -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, ui-sans-serif, sans-serif';

let measureCtx: CanvasRenderingContext2D | null = null;
const labelWidthCache = new Map<string, number>();

export function measureLabelWidth(label: string): number {
  if (!label) return 0;
  const cached = labelWidthCache.get(label);
  if (cached !== undefined) return cached;
  if (!measureCtx) {
    if (typeof document === "undefined") return label.length * 8;
    const canvas = document.createElement("canvas");
    measureCtx = canvas.getContext("2d");
    if (measureCtx) measureCtx.font = LABEL_FONT;
  }
  const w = measureCtx ? measureCtx.measureText(label).width : label.length * 8;
  labelWidthCache.set(label, w);
  return w;
}

function chipWidth(name: string): number {
  const textW = measureLabelWidth(name) * (10 / 14);
  return Math.ceil(12 + textW);
}

function countAreaWidth(includedCount: number, excludedCount: number): number {
  const text =
    String(includedCount) +
    (excludedCount > 0 ? ` (−${excludedCount})` : "");
  return Math.ceil(text.length * 6 + 16);
}

function chipsRowWidth(
  beat: BoardGroupNode,
  levels: Record<string, Level>,
  levelValues: Record<string, LevelValue>,
  countArea: number
): number {
  if (!beat.tags) return 0;
  const names: string[] = [];
  for (const [lid, vids] of Object.entries(beat.tags)) {
    if (!levels[lid]) continue;
    for (const vid of vids) {
      const v = levelValues[vid];
      if (v) names.push(v.name);
    }
  }
  if (names.length === 0) return 0;
  const chipsTotal = names.reduce((a, n) => a + chipWidth(n), 0);
  const gaps = (names.length - 1) * 4;
  const containerPadding = 24;
  return chipsTotal + gaps + containerPadding + countArea;
}

export function beatWidthFor(
  beat: BoardGroupNode,
  levels: Record<string, Level>,
  levelValues: Record<string, LevelValue>,
  includedCount: number,
  excludedCount: number
): number {
  const labelWidth = measureLabelWidth(beat.label ?? "");
  const labelBasedWidth = HEADER_CHROME_WIDTH + labelWidth + LABEL_PADDING;
  const countArea = countAreaWidth(includedCount, excludedCount);
  const chipBased = chipsRowWidth(beat, levels, levelValues, countArea);
  const desired = Math.max(labelBasedWidth, chipBased);
  return Math.min(
    BEAT_MAX_WIDTH,
    Math.max(BEAT_MIN_WIDTH, Math.ceil(desired))
  );
}

export interface BeatPosition {
  beat: BoardGroupNode;
  x: number;
  y: number;
  width: number;
}

// One-shot auto-DAG layout used for the manual-positions migration. After
// migration runs, each beat's stored (x, y) drives rendering directly.
export function computeAutoLayout(
  beats: BoardGroupNode[],
  levels: Record<string, Level>,
  levelValues: Record<string, LevelValue>,
  clips: Record<string, Clip>
): BeatPosition[] {
  if (beats.length === 0) return [];
  const parents = new Map<string, string[]>();
  for (const b of beats) parents.set(b.id, []);
  for (const b of beats) {
    for (const nid of b.nextIds ?? []) {
      if (parents.has(nid)) parents.get(nid)!.push(b.id);
    }
  }

  const ranks = new Map<string, number>();
  for (const b of beats) ranks.set(b.id, 0);
  let changed = true;
  let iterations = 0;
  const maxIter = beats.length + 2;
  while (changed && iterations < maxIter) {
    changed = false;
    iterations++;
    for (const b of beats) {
      const ps = parents.get(b.id) ?? [];
      const newRank =
        ps.length === 0
          ? 0
          : Math.max(...ps.map((p) => ranks.get(p) ?? 0)) + 1;
      if (newRank !== ranks.get(b.id)) {
        ranks.set(b.id, newRank);
        changed = true;
      }
    }
  }

  const byRank = new Map<number, BoardGroupNode[]>();
  for (const b of beats) {
    const r = ranks.get(b.id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(b);
  }
  for (const arr of byRank.values()) {
    arr.sort((a, b) => {
      const ao = a.order ?? 0;
      const bo = b.order ?? 0;
      if (ao !== bo) return ao - bo;
      return (a.label ?? "").localeCompare(b.label ?? "");
    });
  }

  const widthByBeatId = new Map<string, number>();
  function widthOf(b: BoardGroupNode): number {
    const cached = widthByBeatId.get(b.id);
    if (cached !== undefined) return cached;
    const matching = clipsMatchingGroup(clips, b.tags);
    const excludedSet = new Set(b.excludedClipIds ?? []);
    const included = matching.filter((c) => !excludedSet.has(c.id));
    const w = beatWidthFor(
      b,
      levels,
      levelValues,
      included.length,
      excludedSet.size
    );
    widthByBeatId.set(b.id, w);
    return w;
  }

  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);
  const colWidthByRank = new Map<number, number>();
  for (const r of sortedRanks) {
    const w = Math.max(...byRank.get(r)!.map(widthOf));
    colWidthByRank.set(r, w);
  }
  const colXByRank = new Map<number, number>();
  let x = PADDING;
  for (const r of sortedRanks) {
    colXByRank.set(r, x);
    x += colWidthByRank.get(r)! + GAP_X;
  }

  const out: BeatPosition[] = [];
  for (const r of sortedRanks) {
    const arr = byRank.get(r)!;
    const cx = colXByRank.get(r)!;
    arr.forEach((b, i) => {
      out.push({
        beat: b,
        x: cx,
        y: PADDING + i * (BEAT_HEIGHT + GAP_Y),
        width: widthOf(b),
      });
    });
  }
  return out;
}

export function snapToGrid(v: number): number {
  return Math.round(v / SNAP_PX) * SNAP_PX;
}

import type { BoardGroupNode, Clip } from "../types";
import { clipsMatchingGroup } from "./beatFilter";

export interface FcpxmlExportSummary {
  beats: number;
  uniqueClips: number;
  totalRefs: number;
  emptyBeats: number;
}

export interface FcpxmlExportResult {
  xml: string;
  summary: FcpxmlExportSummary;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// FCPXML uses rational time. 30fps timebase ⇒ each frame is 100/3000s. We
// snap clip durations to the nearest frame so FCP doesn't reject the file.
function fcpDuration(ms: number | undefined): string {
  const totalMs = Math.max(33, Math.round(ms ?? 60_000));
  const frames = Math.max(1, Math.round((totalMs * 30) / 1000));
  return `${frames * 100}/3000s`;
}

// Stable 32-char uppercase hex hash of the clip name, used as the asset UID
// and media-rep signature. Stable = re-exports produce the same UIDs so FCP
// recognises previously imported assets across runs.
function fcpUid(name: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < name.length; i++) {
    const ch = name.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  const hex =
    h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  return (hex + "0000000000000000").toUpperCase();
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * Generates an FCPXML file that, when imported into Final Cut Pro, creates
 * one Event per beat. The same clip can sit in multiple events naturally
 * (no duplicate-reference hack needed — unlike Resolve).
 *
 * Media is referenced by filename only (no absolute path). FCP marks clips
 * as Missing on import; user runs File → Relink Files… once and points at
 * the project folder. FCP matches by filename + UID and brings everything
 * online.
 */
export function generateFcpxmlExport(opts: {
  beats: BoardGroupNode[];
  clips: Record<string, Clip>;
  projectName: string;
}): FcpxmlExportResult {
  const { beats, clips } = opts;

  const sortedBeats = [...beats].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  const beatBuckets = sortedBeats.map((b) => {
    const matching = clipsMatchingGroup(clips, b.tags);
    const excluded = new Set(b.excludedClipIds ?? []);
    return { beat: b, clips: matching.filter((c) => !excluded.has(c.id)) };
  });

  // Unique clips become <asset> resources, each referenced by potentially
  // many beat <event>s.
  const clipIdToAssetId = new Map<string, string>();
  const assets: Clip[] = [];
  let nextId = 2; // r1 is reserved for the <format>

  let totalRefs = 0;
  let emptyBeats = 0;
  for (const { clips: bClips } of beatBuckets) {
    if (bClips.length === 0) {
      emptyBeats++;
      continue;
    }
    for (const c of bClips) {
      totalRefs++;
      if (!clipIdToAssetId.has(c.id)) {
        clipIdToAssetId.set(c.id, `r${nextId++}`);
        assets.push(c);
      }
    }
  }

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<!DOCTYPE fcpxml>`);
  lines.push(`<fcpxml version="1.10">`);
  lines.push(`    <resources>`);
  lines.push(
    `        <format id="r1" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>`
  );

  for (const c of assets) {
    const assetId = clipIdToAssetId.get(c.id)!;
    const name = stripExt(c.name);
    const uid = fcpUid(c.name);
    const duration = fcpDuration(c.durationMs);
    const src = `file:///${escapeXml(c.name)}`;
    lines.push(
      `        <asset id="${assetId}" name="${escapeXml(
        name
      )}" uid="${uid}" start="0s" duration="${duration}" hasVideo="1" hasAudio="1" format="r1" videoSources="1" audioSources="1" audioChannels="2" audioRate="48000">`
    );
    lines.push(
      `            <media-rep kind="original-media" sig="${uid}" src="${src}"/>`
    );
    lines.push(`        </asset>`);
  }
  lines.push(`    </resources>`);

  lines.push(`    <library>`);
  for (const { beat, clips: bClips } of beatBuckets) {
    const eventName = (beat.label ?? "Untitled beat").trim() || "Untitled beat";
    lines.push(`        <event name="${escapeXml(eventName)}">`);
    for (const c of bClips) {
      const assetId = clipIdToAssetId.get(c.id)!;
      const name = stripExt(c.name);
      const duration = fcpDuration(c.durationMs);
      lines.push(
        `            <asset-clip ref="${assetId}" name="${escapeXml(
          name
        )}" offset="0s" start="0s" duration="${duration}" tcFormat="NDF"/>`
      );
    }
    lines.push(`        </event>`);
  }
  lines.push(`    </library>`);
  lines.push(`</fcpxml>`);

  return {
    xml: lines.join("\n"),
    summary: {
      beats: sortedBeats.length,
      uniqueClips: assets.length,
      totalRefs,
      emptyBeats,
    },
  };
}

export function downloadFcpxml(xml: string, projectName: string): string {
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const proj = (projectName || "storytime").replace(/[^a-z0-9-_]+/gi, "-");
  const filename = `${proj}-beats-${stamp}.fcpxml`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}

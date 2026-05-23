import type { BoardEventNode, Clip } from "../types";
import { clipsMatchingEvent } from "./eventFilter";

export interface FcpxmlExportSummary {
  events: number;
  uniqueClips: number;
  totalRefs: number;
  emptyEvents: number;
  // Clips without detected fps (defaulted to 30 in the FCPXML). Re-link will
  // reject them if the real file's fps differs.
  missingFpsCount: number;
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

// Snap the detected fps to the nearest "standard" video frame rate. We
// recognise NTSC fractional rates (23.976, 29.97, 59.94, 119.88) separately
// from their integer cousins (24, 30, 60, 120) because FCP's relink dialog
// checks fps strictly — a 29.97 clip declared as 30 fails to relink.
const FPS_PROFILES = [
  { fps: 23.976, num: 1001, den: 24000, name: "FFVideoFormat1080p2398" },
  { fps: 24, num: 100, den: 2400, name: "FFVideoFormat1080p24" },
  { fps: 25, num: 100, den: 2500, name: "FFVideoFormat1080p25" },
  { fps: 29.97, num: 1001, den: 30000, name: "FFVideoFormat1080p2997" },
  { fps: 30, num: 100, den: 3000, name: "FFVideoFormat1080p30" },
  { fps: 50, num: 100, den: 5000, name: "FFVideoFormat1080p50" },
  { fps: 59.94, num: 1001, den: 60000, name: "FFVideoFormat1080p5994" },
  { fps: 60, num: 100, den: 6000, name: "FFVideoFormat1080p60" },
  { fps: 119.88, num: 1001, den: 120000, name: "FFVideoFormat1080p11988" },
  { fps: 120, num: 100, den: 12000, name: "FFVideoFormat1080p120" },
  { fps: 240, num: 100, den: 24000, name: "FFVideoFormat1080p240" },
] as const;
type FpsProfile = (typeof FPS_PROFILES)[number];

function snapFps(fps: number | undefined): FpsProfile {
  if (!fps || !isFinite(fps)) return FPS_PROFILES[4]; // default 30
  let best: FpsProfile = FPS_PROFILES[0];
  let bestDiff = Math.abs(best.fps - fps);
  for (const p of FPS_PROFILES) {
    const d = Math.abs(p.fps - fps);
    if (d < bestDiff) {
      best = p;
      bestDiff = d;
    }
  }
  return best;
}

// FCPXML uses rational time. The duration must be a multiple of the
// frame-duration tick so FCP doesn't reject the asset.
function fcpDuration(ms: number | undefined, profile: FpsProfile): string {
  const totalMs = Math.max(33, Math.round(ms ?? 60_000));
  const frames = Math.max(1, Math.round((totalMs * profile.fps) / 1000));
  return `${frames * profile.num}/${profile.den}s`;
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
 * one Event per event. The same clip can sit in multiple events naturally
 * (no duplicate-reference hack needed — unlike Resolve).
 *
 * Media is referenced by filename only (no absolute path). FCP marks clips
 * as Missing on import; user runs File → Relink Files… once and points at
 * the project folder. FCP matches by filename + UID and brings everything
 * online.
 */
export function generateFcpxmlExport(opts: {
  events: BoardEventNode[];
  clips: Record<string, Clip>;
  projectName: string;
}): FcpxmlExportResult {
  const { events, clips } = opts;

  const sortedEvents = [...events].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  const eventBuckets = sortedEvents.map((b) => {
    const matching = clipsMatchingEvent(clips, b.tags);
    const excluded = new Set(b.excludedClipIds ?? []);
    return { event: b, clips: matching.filter((c) => !excluded.has(c.id)) };
  });

  // Unique clips become <asset> resources, each referenced by potentially
  // many event <event>s.
  const clipIdToAssetId = new Map<string, string>();
  const clipIdToProfile = new Map<string, FpsProfile>();
  const assets: Clip[] = [];
  let nextId = 1;

  let totalRefs = 0;
  let emptyEvents = 0;
  for (const { clips: eClips } of eventBuckets) {
    if (eClips.length === 0) {
      emptyEvents++;
      continue;
    }
    for (const c of eClips) {
      totalRefs++;
      if (!clipIdToAssetId.has(c.id)) {
        clipIdToAssetId.set(c.id, `r${nextId++}`);
        clipIdToProfile.set(c.id, snapFps(c.fps));
        assets.push(c);
      }
    }
  }

  // Collect the distinct fps profiles in use and assign each a <format> id.
  const profileToFormatId = new Map<FpsProfile, string>();
  const formatDefs: { id: string; profile: FpsProfile }[] = [];
  for (const c of assets) {
    const p = clipIdToProfile.get(c.id)!;
    if (!profileToFormatId.has(p)) {
      const id = `f${nextId++}`;
      profileToFormatId.set(p, id);
      formatDefs.push({ id, profile: p });
    }
  }
  // Guarantee at least one format exists even if there are zero clips.
  if (formatDefs.length === 0) {
    const def = snapFps(30);
    const id = `f${nextId++}`;
    profileToFormatId.set(def, id);
    formatDefs.push({ id, profile: def });
  }

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<!DOCTYPE fcpxml>`);
  lines.push(`<fcpxml version="1.10">`);
  lines.push(`    <resources>`);
  for (const f of formatDefs) {
    lines.push(
      `        <format id="${f.id}" name="${f.profile.name}" frameDuration="${f.profile.num}/${f.profile.den}s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>`
    );
  }

  for (const c of assets) {
    const assetId = clipIdToAssetId.get(c.id)!;
    const profile = clipIdToProfile.get(c.id)!;
    const formatId = profileToFormatId.get(profile)!;
    const name = stripExt(c.name);
    const uid = fcpUid(c.name);
    const duration = fcpDuration(c.durationMs, profile);
    const src = `file:///${escapeXml(c.name)}`;
    lines.push(
      `        <asset id="${assetId}" name="${escapeXml(
        name
      )}" uid="${uid}" start="0s" duration="${duration}" hasVideo="1" hasAudio="1" format="${formatId}" videoSources="1" audioSources="1" audioChannels="2" audioRate="48000">`
    );
    lines.push(
      `            <media-rep kind="original-media" sig="${uid}" src="${src}"/>`
    );
    lines.push(`        </asset>`);
  }
  lines.push(`    </resources>`);

  lines.push(`    <library>`);
  for (const { event, clips: eClips } of eventBuckets) {
    const eventName = (event.label ?? "Untitled event").trim() || "Untitled event";
    lines.push(`        <event name="${escapeXml(eventName)}">`);
    for (const c of eClips) {
      const assetId = clipIdToAssetId.get(c.id)!;
      const profile = clipIdToProfile.get(c.id)!;
      const name = stripExt(c.name);
      const duration = fcpDuration(c.durationMs, profile);
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

  const missingFpsCount = assets.reduce(
    (n, c) => n + (c.fps === undefined ? 1 : 0),
    0
  );

  return {
    xml: lines.join("\n"),
    summary: {
      events: sortedEvents.length,
      uniqueClips: assets.length,
      totalRefs,
      emptyEvents,
      missingFpsCount,
    },
  };
}

export function downloadFcpxml(xml: string, projectName: string): string {
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const proj = (projectName || "storytime").replace(/[^a-z0-9-_]+/gi, "-");
  const filename = `${proj}-events-${stamp}.fcpxml`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}

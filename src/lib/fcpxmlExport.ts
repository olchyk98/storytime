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
  // Clips whose audio presence hasn't been detected. Defaulted to hasAudio=1.
  // If the real file is silent (drone footage, screen recordings) FCP rejects
  // the relink.
  missingAudioCount: number;
  // Variable-frame-rate clips we emitted with a <conform-rate> hint. FCPXML
  // can't strictly declare a VFR asset; we declare the modal rate and tell
  // FCP to conform. If FCP still rejects relink, the user needs to transcode
  // these to CFR (ffmpeg / Handbrake) before importing.
  vfrCount: number;
  vfrFilenames: string[];
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

// Per-clip frame-duration profile. When the container parser succeeded we
// have the file's exact rational form (sampleDelta/timescale) — use that
// verbatim so FCP's bit-exact relink check passes. Otherwise we snap the
// detected fps to a standard broadcast rate.
interface FrameProfile {
  fps: number;
  num: number;
  den: number;
  name: string;
}

const STANDARD_PROFILES: FrameProfile[] = [
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
];

function profileFor(clip: Clip): FrameProfile {
  if (clip.fpsSampleDelta && clip.fpsTimescale) {
    const fps = clip.fpsTimescale / clip.fpsSampleDelta;
    return {
      fps,
      num: clip.fpsSampleDelta,
      den: clip.fpsTimescale,
      name: `FFVideoFormatFrame${clip.fpsSampleDelta}_${clip.fpsTimescale}`,
    };
  }
  // No container info — snap detected fps to a standard rate. Used only for
  // legacy/non-MP4 clips where the parser couldn't extract the rational form.
  const fps = clip.fps;
  if (!fps || !isFinite(fps)) return STANDARD_PROFILES[4]; // default 30
  let best = STANDARD_PROFILES[0];
  let bestDiff = Math.abs(best.fps - fps);
  for (const p of STANDARD_PROFILES) {
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
//
// We round DOWN (floor) when converting ms → frames so the declared duration
// never overshoots the real file. NTSC rates (29.97, 59.94) round to a frame
// count that, multiplied back by the rational tick, lands fractionally
// LONGER than the source ms. FCP then rejects relink with "no shared media
// range" because the asset claims more time than the file contains.
function fcpDuration(ms: number | undefined, profile: FrameProfile): string {
  const totalMs = Math.max(33, Math.round(ms ?? 60_000));
  const frames = Math.max(1, Math.floor((totalMs * profile.fps) / 1000));
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
  // Optional absolute filesystem path to the project root. When provided, each
  // clip's media-rep src becomes a full file:// URL FCP can resolve directly,
  // letting FCP import via its native AVFoundation pipeline (which handles
  // VFR correctly) instead of going through the strict relink check.
  absoluteProjectRoot?: string;
}): FcpxmlExportResult {
  const { events, clips, absoluteProjectRoot } = opts;

  const sortedEvents = [...events].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  const eventBuckets = sortedEvents.map((b) => {
    const matching = clipsMatchingEvent(clips, b.tags);
    const excluded = new Set(b.excludedClipIds ?? []);
    return { event: b, clips: matching.filter((c) => !excluded.has(c.id)) };
  });

  // Unique clips become <asset> resources, each referenced by potentially
  // many event <event>s. VFR clips ARE emitted; we add a <conform-rate> hint
  // inside their <asset-clip> elements so FCP knows to interpret them at the
  // declared CFR rate. (Not guaranteed to satisfy FCP's relink check — VFR is
  // fundamentally a CFR-only-model edge case — but worth trying before
  // resorting to transcoding.)
  const clipIdToAssetId = new Map<string, string>();
  const clipIdToProfile = new Map<string, FrameProfile>();
  const assets: Clip[] = [];
  const vfrClips: Clip[] = [];
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
        clipIdToProfile.set(c.id, profileFor(c));
        assets.push(c);
        if (c.isVariableFps) vfrClips.push(c);
      }
    }
  }

  // Collect the distinct fps profiles in use and assign each a <format> id.
  // Profiles with the same (num, den) collapse to a single <format> entry.
  const profileToFormatId = new Map<string, string>();
  const formatDefs: { id: string; profile: FrameProfile }[] = [];
  const profileKey = (p: FrameProfile) => `${p.num}/${p.den}`;
  for (const c of assets) {
    const p = clipIdToProfile.get(c.id)!;
    const key = profileKey(p);
    if (!profileToFormatId.has(key)) {
      const id = `f${nextId++}`;
      profileToFormatId.set(key, id);
      formatDefs.push({ id, profile: p });
    }
  }
  // Guarantee at least one format exists even if there are zero clips.
  if (formatDefs.length === 0) {
    const def = STANDARD_PROFILES[4]; // 30fps fallback
    const id = `f${nextId++}`;
    profileToFormatId.set(profileKey(def), id);
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

  // Trim trailing slashes from the root path so we can append `/segment` cleanly.
  const rootPath = absoluteProjectRoot?.replace(/\/+$/, "");
  for (const c of assets) {
    const assetId = clipIdToAssetId.get(c.id)!;
    const profile = clipIdToProfile.get(c.id)!;
    const formatId = profileToFormatId.get(profileKey(profile))!;
    const name = stripExt(c.name);
    const uid = fcpUid(c.name);
    const duration = fcpDuration(c.durationMs, profile);
    // Build the media-rep src URL. When an absolute project root is provided,
    // emit a full file:// URL (encoded per path segment) so FCP loads via its
    // native AVFoundation importer — bypassing the strict relink check.
    // Without it, fall back to the legacy filename-only form (forces relink).
    const src = rootPath
      ? `file://${encodeURI(rootPath)}/${c.path.map((s) => encodeURIComponent(s)).join("/")}`
      : `file:///${escapeXml(c.name)}`;
    // Default to hasAudio=1 only when unknown. Detected silent clips (drones,
    // screen recordings) must declare hasAudio=0 so FCP doesn't reject relink.
    const audioAttrs =
      c.hasAudio === false
        ? `hasAudio="0"`
        : `hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"`;
    lines.push(
      `        <asset id="${assetId}" name="${escapeXml(
        name
      )}" uid="${uid}" start="0s" duration="${duration}" hasVideo="1" ${audioAttrs} format="${formatId}" videoSources="1">`
    );
    lines.push(
      `            <media-rep kind="original-media" sig="${uid}" src="${src}"/>`
    );
    lines.push(`        </asset>`);
  }
  lines.push(`    </resources>`);

  lines.push(`    <library>`);
  // Zero-pad the index width to the event count so FCP's alphabetical sort
  // in the library sidebar lines up with storytime's authored order.
  const prefixWidth = String(eventBuckets.length).length;
  let eventIdx = 0;
  for (const { event, clips: eClips } of eventBuckets) {
    eventIdx++;
    const raw = (event.label ?? "Untitled event").trim() || "Untitled event";
    const prefix = String(eventIdx).padStart(prefixWidth, "0");
    const eventName = `${prefix} — ${raw}`;
    lines.push(`        <event name="${escapeXml(eventName)}">`);
    for (const c of eClips) {
      const assetId = clipIdToAssetId.get(c.id)!;
      const profile = clipIdToProfile.get(c.id)!;
      const name = stripExt(c.name);
      const duration = fcpDuration(c.durationMs, profile);
      // We don't emit <conform-rate srcFrameRate="..."> for VFR clips —
      // srcFrameRate is enumerated by FCP (23.98/24/25/29.97/30/…) and our
      // avg-fps values fail DTD validation. The asset's <format> already
      // declares the avg rational; FCP's relink check is on the format, not
      // on conform-rate.
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
  const missingAudioCount = assets.reduce(
    (n, c) => n + (c.hasAudio === undefined ? 1 : 0),
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
      missingAudioCount,
      vfrCount: vfrClips.length,
      vfrFilenames: vfrClips.map((c) => c.name),
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

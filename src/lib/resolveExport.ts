import type { BoardGroupNode, Clip } from "../types";
import { clipsMatchingGroup } from "./beatFilter";

export interface ResolveExportSummary {
  beats: number;
  uniqueClips: number;
  totalRefs: number;
  emptyBeats: number;
}

export interface ResolveExportResult {
  script: string;
  summary: ResolveExportSummary;
}

function pyString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/**
 * Generates a Python script for DaVinci Resolve's Console (Workspace → Console
 * → Py3 tab). The script walks the current project's Media Pool, creates a
 * sub-folder per beat, and moves clips into bins by matching filenames.
 *
 * We use the Python API because Resolve's xmeml/FCPXML importers don't
 * actually create bins — they only import sequences. Scripting is the only
 * reliable path for "drop your beats into Resolve and have bins appear."
 */
export function generateResolveScript(opts: {
  beats: BoardGroupNode[];
  clips: Record<string, Clip>;
  projectName: string;
}): ResolveExportResult {
  const { beats, clips, projectName } = opts;

  const sortedBeats = [...beats].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  const beatBuckets = sortedBeats.map((b) => {
    const matching = clipsMatchingGroup(clips, b.tags);
    const excluded = new Set(b.excludedClipIds ?? []);
    return { beat: b, clips: matching.filter((c) => !excluded.has(c.id)) };
  });

  const usedClipIds = new Set<string>();
  let uniqueClips = 0;
  let totalRefs = 0;
  let emptyBeats = 0;

  const beatLiterals: string[] = [];
  for (const { beat, clips: bClips } of beatBuckets) {
    if (bClips.length === 0) {
      emptyBeats++;
      // Still emit empty beats so the user sees an empty bin (placeholder).
      beatLiterals.push(
        `    {"name": ${pyString(beat.label ?? "Untitled beat")}, "clips": []},`
      );
      continue;
    }
    const clipNames: string[] = [];
    for (const c of bClips) {
      totalRefs++;
      if (!usedClipIds.has(c.id)) {
        usedClipIds.add(c.id);
        uniqueClips++;
      }
      clipNames.push(pyString(c.name));
    }
    beatLiterals.push(
      `    {"name": ${pyString(beat.label ?? "Untitled beat")}, "clips": [${clipNames.join(", ")}]},`
    );
  }

  const beatsData = beatLiterals.join("\n");
  const safeProjectName = pyString(projectName || "storytime");
  const exportedAt = new Date().toISOString();

  const script = `# Storytime → DaVinci Resolve bin organizer
# Project: ${projectName}
# Exported: ${exportedAt}
#
# WHAT IT DOES
#   1. Pops up a folder picker — point at your project folder on disk.
#   2. For each beat: creates a bin and imports that beat's clips directly
#      into it. A clip used by N beats becomes N MediaPoolItems (one per bin),
#      all pointing at the same disk file. This is the only way to have a
#      clip "live in" multiple bins simultaneously in Resolve.
#   3. Re-runs are idempotent: clips already in a beat's bin are skipped.
#
# TWO WAYS TO RUN
#   A. PASTE IN CONSOLE  (Studio AND free)
#      Workspace → Console → Py3 tab → paste → Enter.
#   B. ONE-CLICK FROM SCRIPTS MENU  (Studio only)
#      Save this file to:
#        macOS:  ~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Edit/
#        Win:    %APPDATA%\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Scripts\\Edit\\
#        Linux:  ~/.local/share/DaVinciResolve/Fusion/Scripts/Edit/
#      Then Workspace → Scripts → Edit → (this script's name).
#
# Safe to re-run — existing bins are reused, already-imported clips are skipped.

import sys
import os

# Resolve injects 'resolve' when running inside the Console or via Workspace
# > Scripts. When run from an external terminal we need to import the module.
_resolve = None
try:
    _resolve = resolve  # type: ignore[name-defined]  # noqa: F821
except NameError:
    try:
        import DaVinciResolveScript as _bmd  # type: ignore
        _resolve = _bmd.scriptapp("Resolve")
    except Exception:
        _resolve = None

if _resolve is None:
    print("ERROR: Could not connect to DaVinci Resolve.")
    print("Run from Workspace → Console (Py3) or place under Workspace → Scripts.")
    sys.exit(1)

_project = _resolve.GetProjectManager().GetCurrentProject()
if not _project:
    print("ERROR: No project is open in Resolve.")
    sys.exit(1)

_mp = _project.GetMediaPool()
_root = _mp.GetRootFolder()

PROJECT_NAME = ${safeProjectName}
BEATS = [
${beatsData}
]

# === Step 1: pick the project folder and import any new files ===
# Cancel the dialog to skip — the script will then only organize clips that
# are already in the Media Pool. Set this to a path string to bypass the picker.
FOLDER_OVERRIDE = ""

_VIDEO_EXTS = {
    ".mov", ".mp4", ".m4v", ".mxf", ".avi", ".mkv", ".webm",
    ".mts", ".m2ts", ".r3d", ".braw", ".dng",
}

def _pick_folder():
    """Show a native folder picker. Returns the path or None on cancel."""
    try:
        import tkinter as _tk
        from tkinter import filedialog as _fd
        _tkroot = _tk.Tk()
        _tkroot.withdraw()
        try:
            _tkroot.attributes("-topmost", True)
        except Exception:
            pass
        _p = _fd.askdirectory(
            title="Storytime → pick your project folder (Cancel to skip import)",
        )
        try:
            _tkroot.destroy()
        except Exception:
            pass
        return _p or None
    except Exception as _e:
        print(f"  ! Could not open folder picker: {_e}")
        print("    Set FOLDER_OVERRIDE near the top of this script and re-run.")
        return None

def _walk_disk(folder):
    out = []
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for f in filenames:
            if f.startswith("."):
                continue
            ext = os.path.splitext(f)[1].lower()
            if ext in _VIDEO_EXTS:
                out.append(os.path.join(dirpath, f))
    return out

def _bin_contents(b):
    """Names (and stems, lowercased) already inside a bin — for re-run dedup."""
    out = set()
    for _c in b.GetClipList():
        try:
            _n = _c.GetName()
            if _n:
                out.add(_n)
                out.add(_n.lower())
                if "." in _n:
                    _s = _n.rsplit(".", 1)[0]
                    out.add(_s)
                    out.add(_s.lower())
        except Exception:
            pass
    return out

print(f"Storytime → {PROJECT_NAME}")
print("Pick your project folder on disk. Each beat will import its own copy")
print("of any shared clips, so a clip used in N beats appears in N bins.")

_folder = FOLDER_OVERRIDE or _pick_folder()
if not _folder or not os.path.isdir(_folder):
    if FOLDER_OVERRIDE and not os.path.isdir(FOLDER_OVERRIDE):
        print(f"  ! FOLDER_OVERRIDE path doesn't exist: {FOLDER_OVERRIDE!r}")
    print("No folder selected — aborting. (This script needs disk access to copy")
    print("clips into per-beat bins.)")
    sys.exit(0)

print(f"  Folder: {_folder}")
_disk = _walk_disk(_folder)
print(f"  Media files on disk: {len(_disk)}")

# filename → first disk path that matches it. We index full name, stem, and
# lowercase variants so case mismatches (e.g. .MOV vs .mov) don't bite.
_disk_index = {}
for _p in _disk:
    _bn = os.path.basename(_p)
    _disk_index.setdefault(_bn, _p)
    _disk_index.setdefault(_bn.lower(), _p)
    if "." in _bn:
        _stem = _bn.rsplit(".", 1)[0]
        _disk_index.setdefault(_stem, _p)
        _disk_index.setdefault(_stem.lower(), _p)

print(f"Creating {len(BEATS)} beat bins (duplicate references across beats)...")
print()

_existing_bins = {f.GetName(): f for f in _root.GetSubFolderList()}
_total_imported = 0
_total_already = 0
_total_missing = 0

for _beat in BEATS:
    _name = _beat["name"]
    _files = _beat["clips"]
    _bin = _existing_bins.get(_name) or _mp.AddSubFolder(_root, _name)
    if not _bin:
        print(f"  ! Could not create bin: {_name}")
        continue
    _existing_bins[_name] = _bin  # cache so two beats with the same label share a bin

    _have = _bin_contents(_bin)
    _to_import = []
    _missing = []
    _already = 0
    _seen_path = set()  # don't import the same disk file twice into one bin
    for _fname in _files:
        _stem = _fname.rsplit(".", 1)[0] if "." in _fname else _fname
        if (_fname in _have or _stem in _have
                or _fname.lower() in _have or _stem.lower() in _have):
            _already += 1
            continue
        _path = (_disk_index.get(_fname) or _disk_index.get(_stem)
                 or _disk_index.get(_fname.lower())
                 or _disk_index.get(_stem.lower()))
        if not _path:
            _missing.append(_fname)
            continue
        if _path in _seen_path:
            continue
        _seen_path.add(_path)
        _to_import.append(_path)

    _imported = 0
    if _to_import:
        try:
            _mp.SetCurrentFolder(_bin)
        except Exception:
            pass
        _BATCH = 50
        for _i in range(0, len(_to_import), _BATCH):
            _batch = _to_import[_i:_i + _BATCH]
            try:
                _result = _mp.ImportMedia(_batch)
                if isinstance(_result, list):
                    _imported += len(_result)
                elif _result:
                    _imported += len(_batch)
            except Exception as _e:
                print(f"  ! Import failed for {_name}: {_e}")

    _total_imported += _imported
    _total_already += _already
    _total_missing += len(_missing)
    _have_count = _imported + _already
    _status = "✓" if not _missing else "△"
    _detail = f"{_have_count}/{len(_files)} clips"
    if _already and _imported:
        _detail += f"  (imported {_imported}, already in bin {_already})"
    elif _already and not _imported:
        _detail += "  (all already in bin)"
    print(f"  {_status} {_name}: {_detail}")
    for _m in _missing[:3]:
        print(f"      · missing on disk: {_m}")
    if len(_missing) > 3:
        print(f"      · ... and {len(_missing) - 3} more")

print()
print(f"Done. {_total_imported} clips imported across {len(BEATS)} bins.")
if _total_already:
    print(f"{_total_already} clips were already in their bins (skipped).")
if _total_missing:
    print(f"{_total_missing} filenames could not be found on disk under {_folder!r}.")
`;

  return {
    script,
    summary: {
      beats: sortedBeats.length,
      uniqueClips,
      totalRefs,
      emptyBeats,
    },
  };
}

export function downloadResolveScript(
  script: string,
  projectName: string
): string {
  const blob = new Blob([script], { type: "text/x-python" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const proj = (projectName || "storytime").replace(/[^a-z0-9-_]+/gi, "-");
  const filename = `${proj}-beats-${stamp}.py`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}

import type { Clip } from "../types";

const VIDEO_EXT = new Set([
  "mp4", "mov", "m4v", "mkv", "avi", "webm", "mxf", "wmv", "mts", "m2ts", "braw", "r3d",
]);

export function isVideoFile(name: string) {
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return VIDEO_EXT.has(name.slice(i + 1).toLowerCase());
}

export function fingerprintOf(parts: string[], size: number, mtime: number) {
  return `${parts.join("/")}|${size}|${mtime}`;
}

export interface ScanProgress {
  count: number;
  current?: string;
}

// Walk the directory tree; collect video files with up to 3 levels of folders.
// Convention: <day>/<event>/<source>/<file>. Missing levels fill with "_".
export async function scanDirectory(
  root: FileSystemDirectoryHandle,
  onProgress?: (p: ScanProgress) => void
): Promise<Omit<Clip, "bucketIds" | "isNew">[]> {
  const out: Omit<Clip, "bucketIds" | "isNew">[] = [];
  let count = 0;

  async function walk(handle: FileSystemDirectoryHandle, parts: string[]) {
    for await (const [name, entry] of (handle as any).entries() as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      if (name.startsWith(".")) continue;
      if (entry.kind === "directory") {
        await walk(entry as FileSystemDirectoryHandle, [...parts, name]);
      } else if (entry.kind === "file" && isVideoFile(name)) {
        const file = await (entry as FileSystemFileHandle).getFile();
        const fullParts = [...parts, name];
        // hierarchy: day = parts[0], event = parts[1], source = parts[2]
        const day = parts[0] ?? "_";
        const event = parts[1] ?? "_";
        const source = parts[2] ?? "_";
        const fp = fingerprintOf(fullParts, file.size, file.lastModified);
        out.push({
          id: fp,
          fingerprint: fp,
          path: fullParts,
          name,
          size: file.size,
          lastModified: file.lastModified,
          day,
          event,
          source,
        });
        count++;
        if (count % 4 === 0) onProgress?.({ count, current: name });
      }
    }
  }

  await walk(root, []);
  onProgress?.({ count });
  return out;
}

// Re-resolve a file from the root handle using a path.
export async function getFileByPath(
  root: FileSystemDirectoryHandle,
  parts: string[]
): Promise<File | null> {
  try {
    let h: FileSystemDirectoryHandle = root;
    for (let i = 0; i < parts.length - 1; i++) {
      h = await h.getDirectoryHandle(parts[i]);
    }
    const fh = await h.getFileHandle(parts[parts.length - 1]);
    return await fh.getFile();
  } catch {
    return null;
  }
}

export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  mode: "read" | "readwrite" = "read"
): Promise<boolean> {
  const h = handle as any;
  const opts = { mode };
  if ((await h.queryPermission(opts)) === "granted") return true;
  return (await h.requestPermission(opts)) === "granted";
}

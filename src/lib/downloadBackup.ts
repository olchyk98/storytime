import type { BackupPayload } from "../state/store";

export interface DownloadResult {
  filename: string;
  bytes: number;
}

export function downloadBackup(
  payload: BackupPayload,
  projectName?: string
): DownloadResult {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const proj = (projectName ?? "storytime").replace(/[^a-z0-9-_]+/gi, "-");
  const filename = `${proj}-backup-${stamp}.json`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { filename, bytes: blob.size };
}

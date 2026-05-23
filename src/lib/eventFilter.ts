import type { BoardEventSort, Clip } from "../types";

export function clipsMatchingEvent(
  allClips: Record<string, Clip>,
  tags: Record<string, string[]> | undefined
) {
  const arr = Object.values(allClips);
  if (!tags || Object.keys(tags).length === 0) return arr;
  // Each level entry is an OR-set; a clip must satisfy every level (AND across levels).
  const entries = Object.entries(tags).filter(([, vs]) => vs && vs.length > 0);
  if (entries.length === 0) return arr;
  return arr.filter((c) => {
    if (!c.tags) return false;
    for (const [lid, allowed] of entries) {
      const clipVal = c.tags[lid];
      if (!clipVal) return false;
      if (!allowed.includes(clipVal)) return false;
    }
    return true;
  });
}

export function sortClips(clips: Clip[], sort: BoardEventSort | undefined) {
  const arr = [...clips];
  switch (sort ?? "name-asc") {
    case "name-asc":
      arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      break;
    case "name-desc":
      arr.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
      break;
    case "date-desc":
      arr.sort((a, b) => b.lastModified - a.lastModified);
      break;
    case "date-asc":
      arr.sort((a, b) => a.lastModified - b.lastModified);
      break;
  }
  return arr;
}

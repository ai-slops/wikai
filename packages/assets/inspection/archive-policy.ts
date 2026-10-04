import { posix } from "node:path";
import { type ArchiveEntry, INSPECTION_LIMITS, InspectionError } from "./schema.ts";

export function checkArchiveEntry(entry: ArchiveEntry, seen: Set<string>, total: number): number {
  if (
    entry.name.length === 0 ||
    entry.name.startsWith("/") ||
    /[\\:]/u.test(entry.name) ||
    entry.name.split("/").includes("..") ||
    [...entry.name].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new InspectionError("ASSET_ARCHIVE_UNSAFE");
  }
  const canonical = posix.normalize(entry.name).normalize("NFC").replace(/\/$/u, "").toLowerCase();
  if (seen.has(canonical)) throw new InspectionError("ASSET_ARCHIVE_UNSAFE");
  seen.add(canonical);
  if (
    seen.size > INSPECTION_LIMITS.entries ||
    total + entry.bytes > INSPECTION_LIMITS.declaredBytes
  ) {
    throw new InspectionError("ASSET_INSPECTION_LIMIT");
  }
  return total + entry.bytes;
}

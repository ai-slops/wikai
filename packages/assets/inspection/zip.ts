import { fromBufferPromise } from "yauzl";
import { checkArchiveEntry } from "./archive-policy.ts";
import {
  type ArchiveEntry,
  ArchiveEntrySchema,
  INSPECTION_LIMITS,
  InspectionError,
  type InspectionMetadata,
} from "./schema.ts";

export async function inspectZip(input: Buffer): Promise<InspectionMetadata> {
  const zip = await fromBufferPromise(input, {
    lazyEntries: true,
    strictFileNames: true,
    decodeStrings: true,
    validateEntrySizes: true,
  });
  const entries: ArchiveEntry[] = [];
  const seen = new Set<string>();
  let declaredBytes = 0;
  try {
    if (zip.entryCount > INSPECTION_LIMITS.entries)
      throw new InspectionError("ASSET_INSPECTION_LIMIT");
    for await (const entry of zip.eachEntry()) {
      const unix = entry.versionMadeBy >>> 8 === 3;
      const mode = unix ? entry.externalFileAttributes >>> 16 : undefined;
      const type = mode === undefined ? 0 : mode & 0o170000;
      if (unix && type !== 0 && type !== 0o100000 && type !== 0o040000) {
        throw new InspectionError("ASSET_ARCHIVE_UNSAFE");
      }
      const item = ArchiveEntrySchema.parse({
        name: entry.fileName,
        type: entry.fileName.endsWith("/")
          ? "directory"
          : unix && type === 0o100000
            ? "file"
            : "unknown",
        bytes: entry.uncompressedSize,
        compressedBytes: entry.compressedSize,
        encrypted: entry.isEncrypted(),
        comment: entry.fileComment,
        modifiedAt: entry.getLastModDate({ timezone: "UTC" }).toISOString(),
        ...(mode === undefined ? {} : { mode }),
      });
      declaredBytes = checkArchiveEntry(item, seen, declaredBytes);
      entries.push(item);
    }
    return { kind: "zip", comment: zip.comment, entries, declaredBytes };
  } finally {
    zip.close();
  }
}

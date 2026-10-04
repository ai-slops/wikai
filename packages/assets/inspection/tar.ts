import { extract } from "tar-stream";
import { checkArchiveEntry } from "./archive-policy.ts";
import {
  type ArchiveEntry,
  ArchiveEntrySchema,
  InspectionError,
  type TarMetadata,
} from "./schema.ts";

export function inspectTar(input: Buffer): Promise<TarMetadata> {
  if (input.length < 1024 || input.length % 512 !== 0) {
    return Promise.reject(new InspectionError("ASSET_INSPECTION_FAILED"));
  }
  return new Promise((resolve, reject) => {
    const archive = extract();
    const entries: ArchiveEntry[] = [];
    const seen = new Set<string>();
    let declaredBytes = 0;
    archive.on("error", reject);
    archive.on("entry", (header, stream, next) => {
      try {
        if (header.type !== "file" && header.type !== "directory") {
          throw new InspectionError("ASSET_ARCHIVE_UNSAFE");
        }
        const entry = ArchiveEntrySchema.parse({
          name: header.name,
          type: header.type,
          bytes: header.size,
          owner: header.uname,
          group: header.gname,
          mode: header.mode,
          modifiedAt: header.mtime?.toISOString(),
        });
        declaredBytes = checkArchiveEntry(entry, seen, declaredBytes);
        entries.push(entry);
        stream.once("end", next);
        stream.resume();
      } catch (error) {
        archive.destroy(
          error instanceof Error ? error : new InspectionError("ASSET_INSPECTION_FAILED"),
        );
      }
    });
    archive.on("finish", () => resolve({ kind: "tar", entries, declaredBytes }));
    archive.end(input);
  });
}

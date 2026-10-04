import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { hash, isFsError, readOptionalBytes } from "../fs/index.ts";
import { type Diagnostic, PublisherError } from "../model/index.ts";
import { statePath } from "./document.ts";
import { stateProblem } from "./maintenance-input.ts";
import { decodeRevision } from "./revision.ts";
import { StateHashSchema, StatePublicIdSchema, type StoredRevision } from "./schema.ts";

export async function revisionInventory(stateDir: string) {
  const revisions: StoredRevision[] = [];
  const diagnostics: Diagnostic[] = [];
  const fingerprint: { path: string; kind: string; digest: string | null }[] = [];
  let entries: Dirent[];
  try {
    await statePath(stateDir, ".");
    const root = await lstat(join(stateDir, "revisions"));
    if (!root.isDirectory()) {
      fingerprint.push({ path: "revisions", kind: "invalid", digest: null });
      diagnostics.push(
        stateProblem("STATE_REVISION_ENTRY_INVALID", "Revision storage must be a real directory"),
      );
      return { revisions, diagnostics, fingerprint };
    }
    entries = await readdir(await statePath(stateDir, "revisions"), { withFileTypes: true });
  } catch (error) {
    if (isFsError(error, "ENOENT")) return { revisions, diagnostics, fingerprint };
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = join("revisions", entry.name);
    const validId = StatePublicIdSchema.safeParse(entry.name);
    fingerprint.push({
      path: directory,
      kind: entry.isDirectory() ? "directory" : "invalid",
      digest: null,
    });
    if (!entry.isDirectory() || !validId.success) {
      diagnostics.push(
        stateProblem(
          "STATE_REVISION_ENTRY_INVALID",
          "Revision storage contains an unexpected or symlinked entry",
        ),
      );
      continue;
    }
    const files = await readdir(await statePath(stateDir, directory), { withFileTypes: true });
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = join(directory, file.name);
      if (!file.isFile()) {
        fingerprint.push({ path: relativePath, kind: "invalid", digest: null });
        diagnostics.push(
          stateProblem(
            "STATE_REVISION_ENTRY_INVALID",
            "Revision files must be regular files",
            entry.name,
          ),
        );
        continue;
      }
      const raw = await readOptionalBytes(await statePath(stateDir, relativePath));
      fingerprint.push({
        path: relativePath,
        kind: "file",
        digest: raw === undefined ? null : hash(raw),
      });
      const revisionHash = file.name.endsWith(".json") ? file.name.slice(0, -5) : "";
      if (raw === undefined || !StateHashSchema.safeParse(revisionHash).success) {
        diagnostics.push(
          stateProblem(
            "STATE_REVISION_ENTRY_INVALID",
            "Revision file name is invalid or the file changed",
            entry.name,
          ),
        );
        continue;
      }
      try {
        revisions.push(decodeRevision(raw.toString("utf8"), entry.name, revisionHash));
      } catch (error) {
        if (!(error instanceof PublisherError)) throw error;
        diagnostics.push(
          stateProblem(error.code, "A revision failed its integrity check", entry.name),
        );
      }
    }
  }
  revisions.sort(
    (a, b) =>
      a.approvedAt.localeCompare(b.approvedAt) || a.revisionHash.localeCompare(b.revisionHash),
  );
  return { revisions, diagnostics, fingerprint };
}

import { readdir } from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import { atomicWrite, hash, isFsError, readOptionalBytes, safePath } from "../fs/index.ts";
import { PublisherError } from "../model/index.ts";
import { decodeState } from "./migrations.ts";
import { type StateDocument, StateDocumentSchema } from "./schema.ts";

const EMPTY_STATE: StateDocument = { schemaVersion: 2, publications: {} };

export async function statePath(stateDir: string, name: string): Promise<string> {
  const path = resolve(stateDir, name);
  return safePath(parse(path).root, path);
}

export async function markInitialized(stateDir: string): Promise<void> {
  const path = await statePath(stateDir, "initialized");
  if ((await readOptionalBytes(path)) === undefined) {
    await atomicWrite(path, "wikai-state\n", null);
  }
}

export async function readStateSnapshot(stateDir: string): Promise<{
  readonly document: StateDocument;
  readonly expectedHash: string | null;
}> {
  const raw = await readOptionalBytes(await statePath(stateDir, "state.json"));
  if (raw === undefined) {
    const marker = await readOptionalBytes(await statePath(stateDir, "initialized"));
    let hasRevisions = false;
    try {
      hasRevisions = (await readdir(await statePath(stateDir, "revisions"))).length > 0;
    } catch (error) {
      if (
        isFsError(error, "ENOTDIR") ||
        (error instanceof PublisherError && error.code === "ASSET_SYMLINK")
      ) {
        hasRevisions = true;
      } else if (!isFsError(error, "ENOENT")) throw error;
    }
    if (marker !== undefined || hasRevisions) {
      throw new PublisherError(
        "STATE_RECOVERY_REQUIRED",
        "Publisher state is missing from an initialized store; inspect state recovery.",
      );
    }
    return { document: structuredClone(EMPTY_STATE), expectedHash: null };
  }
  return { document: decodeState(raw).document, expectedHash: hash(raw) };
}

export async function readStateDocument(stateDir: string): Promise<StateDocument> {
  return (await readStateSnapshot(stateDir)).document;
}

export async function writeStateDocument(
  stateDir: string,
  document: StateDocument,
  expectedHash: string | null,
): Promise<void> {
  const path = join(stateDir, "state.json");
  const content = `${JSON.stringify(StateDocumentSchema.parse(document), null, 2)}\n`;
  await markInitialized(stateDir);
  await atomicWrite(path, content, expectedHash);
}

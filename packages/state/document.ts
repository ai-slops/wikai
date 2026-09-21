import { join } from "node:path";
import { atomicWrite, hash, readOptional } from "../fs/index.ts";
import { PublisherError } from "../model/index.ts";
import { type StateDocument, StateDocumentSchema } from "./schema.ts";

const EMPTY_STATE: StateDocument = { schemaVersion: 1, publications: {} };

export async function readStateDocument(stateDir: string): Promise<StateDocument> {
  const raw = await readOptional(join(stateDir, "state.json"));
  if (raw === undefined) return structuredClone(EMPTY_STATE);
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new PublisherError("STATE_INTEGRITY_FAILURE", "Publisher state is invalid");
    }
    throw error;
  }
  const parsed = StateDocumentSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new PublisherError("STATE_INTEGRITY_FAILURE", "Publisher state is invalid");
  }
  return parsed.data;
}

export async function writeStateDocument(stateDir: string, document: StateDocument): Promise<void> {
  const path = join(stateDir, "state.json");
  const current = await readOptional(path);
  await atomicWrite(path, `${JSON.stringify(document, null, 2)}\n`, current && hash(current));
}

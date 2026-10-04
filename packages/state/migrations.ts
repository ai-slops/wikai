import { z } from "zod";
import { PublisherError } from "../model/index.ts";
import { LegacyStateDocumentSchema, type StateDocument, StateDocumentSchema } from "./schema.ts";

export function decodeState(raw: Buffer): {
  readonly sourceVersion: 1 | 2;
  readonly document: StateDocument;
} {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new PublisherError("STATE_INTEGRITY_FAILURE", "Publisher state is invalid");
    }
    throw error;
  }
  if (
    typeof decoded === "object" &&
    decoded !== null &&
    "schemaVersion" in decoded &&
    decoded.schemaVersion !== 1 &&
    decoded.schemaVersion !== 2
  ) {
    throw new PublisherError("STATE_SCHEMA_MISMATCH", "Publisher state version is unsupported");
  }
  const parsed = z.union([LegacyStateDocumentSchema, StateDocumentSchema]).safeParse(decoded);
  if (!parsed.success) {
    throw new PublisherError("STATE_INTEGRITY_FAILURE", "Publisher state is invalid");
  }
  return {
    sourceVersion: parsed.data.schemaVersion,
    document: { ...parsed.data, schemaVersion: 2 },
  };
}

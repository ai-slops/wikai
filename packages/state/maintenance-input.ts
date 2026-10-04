import { isAbsolute, parse, resolve } from "node:path";
import { z } from "zod";
import { hash, readOptionalBytes, safePath } from "../fs/index.ts";
import type { Diagnostic } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import { decodeState } from "./migrations.ts";
import { StatePublicIdSchema } from "./schema.ts";

export type StateMaintenanceInput = {
  readonly mode: "recover" | "migrate";
  readonly stateDir: string;
  readonly backupPath?: string;
  readonly bindingsPath?: string;
};

export const BindingSchema = z.strictObject({
  sourceId: z.string().regex(/^prv_[A-Za-z0-9_-]+$/u),
  sourcePath: z
    .string()
    .min(1)
    .refine(
      (path) =>
        !isAbsolute(path) &&
        !/[\\:]/u.test(path) &&
        ![...path].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) &&
        !path.split("/").some((part) => part === ".." || part === "." || part === ""),
    ),
  sourceMode: z.enum(["mirror", "projection"]),
});
export const BindingsSchema = z.record(StatePublicIdSchema, BindingSchema);
export type SourceBindings = z.infer<typeof BindingsSchema>;

export function stateProblem(code: string, message: string, publicId?: string): Diagnostic {
  return { code, severity: "error", message, ...(publicId === undefined ? {} : { publicId }) };
}

export async function readMaintenanceFile(input: string) {
  const path = resolve(input);
  await safePath(parse(path).root, path);
  const raw = await readOptionalBytes(path);
  return { path, raw, digest: raw === undefined ? null : hash(raw) };
}

export function inspectState(raw: Buffer | undefined) {
  if (raw === undefined) return { status: "missing", document: null, sourceVersion: null } as const;
  try {
    return { status: "valid", ...decodeState(raw) } as const;
  } catch (error) {
    if (error instanceof PublisherError && error.code === "STATE_INTEGRITY_FAILURE") {
      return { status: "corrupt", document: null, sourceVersion: null } as const;
    }
    if (error instanceof PublisherError && error.code === "STATE_SCHEMA_MISMATCH") {
      return { status: "unsupported", document: null, sourceVersion: null } as const;
    }
    throw error;
  }
}

export function parseBindings(raw: Buffer): SourceBindings {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new PublisherError("STATE_BINDINGS_INVALID", "Source bindings must be valid JSON");
    }
    throw error;
  }
  const result = BindingsSchema.safeParse(value);
  if (!result.success) {
    throw new PublisherError(
      "STATE_BINDINGS_INVALID",
      "Source bindings contain invalid identifiers or paths",
    );
  }
  return result.data;
}

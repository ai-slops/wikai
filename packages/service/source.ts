import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { atomicWrite, hash, safePath } from "../fs/index.ts";
import type { PublicKind, PublisherConfig } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import type { CandidateInput, MetadataPatch } from "./schema.ts";

export type SourceParts = { readonly frontmatter: string; readonly body: string };

export function splitSource(raw: string): SourceParts {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(raw);
  if (match === null) return { frontmatter: "", body: raw };
  return { frontmatter: match[1] ?? "", body: raw.slice(match[0].length) };
}

export function newPublicId(): string {
  return `pub_${randomUUID().replaceAll("-", "")}`;
}

export function newPrivateId(): string {
  return `prv_${randomUUID().replaceAll("-", "")}`;
}

function kindDefaults(kind: PublicKind): {
  readonly path: readonly string[];
  readonly value: string;
} {
  switch (kind) {
    case "work":
      return { path: ["work", "projectStatus"], value: "active" };
    case "knowledge":
      return { path: ["knowledge", "documentType"], value: "topic" };
    case "log":
      return { path: ["log", "occurredAt"], value: new Date().toISOString() };
    case "page":
      return { path: ["page", "layout"], value: "generic" };
  }
}

export function kindMetadata(kind: PublicKind): string {
  const defaults = kindDefaults(kind);
  return `  ${defaults.path[0]}:\n    ${defaults.path[1]}: ${JSON.stringify(defaults.value)}\n`;
}

export function temporarySlug(kind: PublicKind, value: string): string {
  const segment =
    value
      .normalize("NFC")
      .toLocaleLowerCase("en-US")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/gu, "") || "untitled";
  return kind === "page" ? `/${segment}` : `/${kind}/${segment}`;
}

export function parsedFrontmatter(parts: SourceParts) {
  const document = parseDocument(parts.frontmatter || "{}");
  if (document.errors.length > 0) {
    throw new PublisherError("FRONTMATTER_INVALID", "Markdown frontmatter is invalid");
  }
  return document;
}

export function assertExpected(raw: string, expectedHash: string | undefined): void {
  if (expectedHash !== undefined && hash(raw) !== expectedHash) {
    throw new PublisherError(
      "CONCURRENT_SOURCE_MODIFICATION",
      "The source changed; review it again before saving",
    );
  }
}

function candidateContent(
  parts: SourceParts,
  input: CandidateInput,
): { readonly text: string; readonly id: string } {
  const document = parsedFrontmatter(parts);
  const existing = document.getIn(["public", "id"]);
  const id = typeof existing === "string" ? existing : newPublicId();
  if (typeof document.get("id") !== "string") document.set("id", newPrivateId());
  document.setIn(["public", "id"], id);
  document.setIn(["public", "status"], "candidate");
  document.setIn(["public", "mode"], input.mode);
  document.setIn(["public", "kind"], input.kind);
  const defaults = kindDefaults(input.kind);
  if (document.getIn(["public", ...defaults.path]) === undefined) {
    document.setIn(["public", ...defaults.path], defaults.value);
  }
  if (document.getIn(["public", "slug"]) === undefined) {
    const title = document.get("title");
    const fallback =
      typeof title === "string" ? title : (input.path.split("/").at(-1) ?? "untitled");
    document.setIn(["public", "slug"], temporarySlug(input.kind, fallback.replace(/\.md$/iu, "")));
  }
  return { text: `---\n${document.toString()}---\n${parts.body}`, id };
}

export async function markCandidate(config: PublisherConfig, input: CandidateInput) {
  const path = await safePath(config.vault.root, input.path);
  const raw = await readFile(path, "utf8");
  assertExpected(raw, input.expectedHash);
  const changed = candidateContent(splitSource(raw), input);
  await atomicWrite(path, changed.text, input.expectedHash ?? hash(raw));
  return { publicId: changed.id, path: input.path, sourceHash: hash(changed.text) };
}

export async function markPublished(
  config: PublisherConfig,
  pathInput: string,
  expectedHash: string,
): Promise<string> {
  const path = await safePath(config.vault.root, pathInput);
  const raw = await readFile(path, "utf8");
  assertExpected(raw, expectedHash);
  const parts = splitSource(raw);
  const document = parsedFrontmatter(parts);
  document.setIn(["public", "status"], "published");
  const content = `---\n${document.toString()}---\n${parts.body}`;
  await atomicWrite(path, content, expectedHash);
  return hash(content);
}

export async function patchMetadata(
  config: PublisherConfig,
  pathInput: string,
  publicId: string,
  patch: MetadataPatch,
  expectedHash: string,
) {
  const path = await safePath(config.vault.root, pathInput);
  const raw = await readFile(path, "utf8");
  assertExpected(raw, expectedHash);
  const parts = splitSource(raw);
  const document = parsedFrontmatter(parts);
  if (document.getIn(["public", "id"]) !== publicId) {
    throw new PublisherError("PUBLICATION_NOT_FOUND", "The publication was not found");
  }
  for (const [key, value] of Object.entries(patch)) document.setIn(["public", key], value);
  const content = `---\n${document.toString()}---\n${parts.body}`;
  await atomicWrite(path, content, expectedHash);
  return { publicId, path: pathInput, previousHash: expectedHash, sourceHash: hash(content) };
}

import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { atomicWrite, hash, readOptional, safePath } from "../fs/index.ts";
import type { PublisherConfig } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import type { ExtractInput, ProjectInput } from "./schema.ts";
import {
  assertExpected,
  kindMetadata,
  newPrivateId,
  newPublicId,
  parsedFrontmatter,
  type SourceParts,
  splitSource,
  temporarySlug,
} from "./source.ts";

type SourceIdentityInput = {
  readonly path: string;
  readonly raw: string;
  readonly parts: SourceParts;
  readonly expectedHash?: string;
};

type LoadedSource = {
  readonly parts: SourceParts;
  readonly source: { readonly id: string; readonly capturedHash: string };
};

type ProjectionDraft = {
  readonly input: ProjectInput;
  readonly source: LoadedSource["source"];
  readonly body: string;
  readonly anchor?: string;
};

async function destination(config: PublisherConfig, input: string): Promise<string> {
  const path = await safePath(config.vault.root, input);
  const allowed = config.publicViews.roots.some((root) => {
    const delta = relative(resolve(config.vault.root, root), path);
    return delta === "" || (delta !== ".." && !delta.startsWith(`..${sep}`));
  });
  if (!allowed)
    throw new PublisherError(
      "PROJECTION_PATH_FORBIDDEN",
      "Projection must be inside a public view root",
    );
  return path;
}

function selectHeading(body: string, heading: string): string {
  const lines = body.split("\n");
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matcher = new RegExp(`^(#{1,6})\\s+${escaped}\\s*#*\\s*$`, "iu");
  const start = lines.findIndex((line) => matcher.test(line));
  if (start < 0) throw new PublisherError("EXTRACT_HEADING_NOT_FOUND", "Heading was not found");
  const level = matcher.exec(lines[start] ?? "")?.[1]?.length ?? 6;
  const end = lines.findIndex(
    (line, index) => index > start && new RegExp(`^#{1,${level}}\\s`, "u").test(line),
  );
  return lines
    .slice(start, end < 0 ? undefined : end)
    .join("\n")
    .trimEnd();
}

function selectBlock(body: string, block: string): string {
  const marker = `^${block.replace(/^\^/u, "")}`;
  const lines = body.split("\n");
  const index = lines.findIndex((line) => line.trimEnd().endsWith(marker));
  if (index < 0) throw new PublisherError("EXTRACT_BLOCK_NOT_FOUND", "Block was not found");
  let start = index;
  while (start > 0 && lines[start - 1]?.trim() !== "") start -= 1;
  return lines
    .slice(start, index + 1)
    .join("\n")
    .replace(marker, "")
    .trimEnd();
}

function selectLines(body: string, lines: ExtractInput["lines"]): string {
  if (lines === undefined)
    throw new PublisherError("EXTRACT_LINES_INVALID", "Line range is missing");
  const [start, end] =
    typeof lines === "string" ? lines.split(":").map(Number) : [lines.start, lines.end];
  if (start === undefined || end === undefined || start < 1 || end < start)
    throw new PublisherError("EXTRACT_LINES_INVALID", "Line range is invalid");
  return body
    .split("\n")
    .slice(start - 1, end)
    .join("\n");
}

function selectedBody(parts: SourceParts, input: ExtractInput): string {
  if (input.heading !== undefined) return selectHeading(parts.body, input.heading);
  if (input.block !== undefined) return selectBlock(parts.body, input.block);
  return selectLines(parts.body, input.lines);
}

async function sourceIdentity(input: SourceIdentityInput) {
  const document = parsedFrontmatter(input.parts);
  const existing = document.get("id");
  if (typeof existing === "string") return { id: existing, capturedHash: hash(input.raw) };
  const id = newPrivateId();
  document.set("id", id);
  const content = `---\n${document.toString()}---\n${input.parts.body}`;
  await atomicWrite(input.path, content, input.expectedHash ?? hash(input.raw));
  return { id, capturedHash: hash(content) };
}

async function loadSource(config: PublisherConfig, input: ProjectInput): Promise<LoadedSource> {
  const sourcePath = await safePath(config.vault.root, input.path);
  const raw = await readFile(sourcePath, "utf8");
  assertExpected(raw, input.expectedHash);
  const parts = splitSource(raw);
  const source = await sourceIdentity({
    path: sourcePath,
    raw,
    parts,
    ...(input.expectedHash === undefined ? {} : { expectedHash: input.expectedHash }),
  });
  return { parts, source };
}

async function writeProjection(config: PublisherConfig, draft: ProjectionDraft) {
  const title = draft.input.path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? "Projection";
  const id = newPublicId();
  const sourceEntry = `    - id: ${JSON.stringify(draft.source.id)}\n${draft.anchor === undefined ? "" : `      anchor: ${JSON.stringify(draft.anchor)}\n`}      capturedHash: ${JSON.stringify(draft.source.capturedHash)}\n`;
  const content = `---\nid: ${newPrivateId()}\ntitle: ${JSON.stringify(title)}\npublic:\n  id: ${id}\n  status: candidate\n  mode: projection\n  kind: ${draft.input.kind}\n  slug: ${temporarySlug(draft.input.kind, title)}\n${kindMetadata(draft.input.kind)}  sources:\n${sourceEntry}---\n${draft.body.trim()}\n`;
  const outputPath = await destination(config, draft.input.to);
  if ((await readOptional(outputPath)) !== undefined)
    throw new PublisherError("PROJECTION_EXISTS", "Projection destination already exists");
  await atomicWrite(outputPath, content);
  return { publicId: id, path: draft.input.to, sourceHash: hash(content) };
}

export async function createProject(config: PublisherConfig, input: ProjectInput) {
  const loaded = await loadSource(config, input);
  return writeProjection(config, { input, source: loaded.source, body: "" });
}

export async function createExtraction(config: PublisherConfig, input: ExtractInput) {
  const loaded = await loadSource(config, input);
  const body = selectedBody(loaded.parts, input);
  const anchor =
    input.heading !== undefined
      ? `heading:${input.heading}`
      : input.block !== undefined
        ? `block:${input.block}`
        : `lines:${typeof input.lines === "string" ? input.lines : `${input.lines?.start}:${input.lines?.end}`}`;
  return writeProjection(config, { input, source: loaded.source, body, anchor });
}

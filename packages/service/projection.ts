import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { atomicWrite, hash, readOptional, safePath } from "../fs/index.ts";
import type { PublisherConfig, SourceReference } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import type { ExtractInput, ProjectInput } from "./schema.ts";
import { extractSelection } from "./selection.ts";
import {
  assertExpected,
  kindMetadata,
  newPrivateId,
  newPublicId,
  parsedFrontmatter,
  type SourceParts,
  serializeSource,
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
  readonly source: SourceReference;
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

async function sourceIdentity(input: SourceIdentityInput) {
  const document = parsedFrontmatter(input.parts);
  const existing = document.get("id");
  if (typeof existing === "string") return { id: existing, capturedHash: hash(input.raw) };
  const id = newPrivateId();
  document.set("id", id);
  const content = serializeSource(input.parts, document);
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
  const selectionEntry =
    draft.source.selection === undefined
      ? ""
      : `      selection: ${JSON.stringify(draft.source.selection)}\n`;
  const content = `---\nid: ${newPrivateId()}\ntitle: ${JSON.stringify(title)}\npublic:\n  id: ${id}\n  status: candidate\n  mode: projection\n  kind: ${draft.input.kind}\n  slug: ${temporarySlug(draft.input.kind, title)}\n${kindMetadata(draft.input.kind)}  sources:\n${sourceEntry}${selectionEntry}---\n${draft.body.trimEnd()}\n`;
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
  const selected = extractSelection(loaded.parts.body, input);
  return writeProjection(config, {
    input,
    source: {
      ...loaded.source,
      capturedHash: selected.capturedHash,
      selection: selected.selection,
    },
    body: selected.body,
    anchor: selected.anchor,
  });
}

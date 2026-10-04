import { readFile } from "node:fs/promises";
import { diffLines } from "diff";
import { atomicWrite, hash, safePath, withLock } from "../fs/index.ts";
import { type Diagnostic, type PublisherConfig, PublisherError } from "../model/index.ts";
import { loadVault } from "../vault/index.ts";
import { parsedFrontmatter, serializeSource, splitSource } from "./source.ts";
import {
  type SourceUpdateApply,
  SourceUpdateApplySchema,
  type SourceUpdateInput,
  SourceUpdateInputSchema,
} from "./source-update-schema.ts";
import { sourceUpdateSelection } from "./source-update-selection.ts";

async function prepare(config: PublisherConfig, publicId: string, input: SourceUpdateInput) {
  const vault = await loadVault(config);
  const projections = vault.documents.filter(
    (document) => document.frontmatter.public?.id === publicId,
  );
  const projection = projections[0];
  if (projections.length !== 1 || projection?.frontmatter.public === undefined) {
    throw new PublisherError("PUBLICATION_NOT_FOUND", "A unique source publication was not found");
  }
  const spec = projection.frontmatter.public;
  if (spec.mode !== "projection") {
    throw new PublisherError(
      "SOURCE_UPDATE_PROJECTION_REQUIRED",
      "Source merging is available only for projections",
    );
  }
  const indexes = spec.sources.flatMap((reference, index) =>
    reference.id === input.sourceId ? [index] : [],
  );
  if (input.referenceIndex === undefined && indexes.length > 1) {
    throw new PublisherError(
      "SOURCE_REFERENCE_AMBIGUOUS",
      "Select a reference index for this source",
    );
  }
  const referenceIndex = input.referenceIndex ?? indexes[0];
  const reference = referenceIndex === undefined ? undefined : spec.sources[referenceIndex];
  if (referenceIndex === undefined || reference?.id !== input.sourceId) {
    throw new PublisherError(
      "SOURCE_REFERENCE_NOT_FOUND",
      "The selected source is not a tracked reference",
    );
  }
  const sources = vault.documents.filter((document) => document.frontmatter.id === input.sourceId);
  const source = sources[0];
  if (sources.length !== 1 || source === undefined) {
    throw new PublisherError("SOURCE_NOT_FOUND", "A unique source dependency was not found");
  }
  if (source.sourcePath === projection.sourcePath) {
    throw new PublisherError(
      "SOURCE_UPDATE_SELF_REFERENCE",
      "A projection cannot merge from itself",
    );
  }
  const diagnostics: Diagnostic[] = [];
  let selected: ReturnType<typeof sourceUpdateSelection> | null = null;
  try {
    selected = sourceUpdateSelection({
      source,
      reference,
      input,
      kind: spec.kind,
      projectionPath: projection.sourcePath,
    });
  } catch (error) {
    if (!(error instanceof PublisherError)) throw error;
    diagnostics.push({
      code: error.code,
      severity: "error",
      message: error.message,
      publicId,
      sourcePath: source.sourcePath,
    });
  }
  const plan = {
    publicId,
    sourceId: input.sourceId,
    referenceIndex,
    sourcePath: source.sourcePath,
    projectionPath: projection.sourcePath,
    projectionHash: projection.sourceHash,
    sourceHash: source.sourceHash,
    projectionBody: projection.body,
    sourceBody: selected?.body ?? null,
    changes:
      selected === null
        ? []
        : diffLines(
            projection.body.replaceAll("\r\n", "\n"),
            selected.body.replaceAll("\r\n", "\n"),
          ),
    canApply: selected !== null,
    diagnostics,
  };
  const expectedHash = hash(
    JSON.stringify({ plan, reference, proposedReference: selected?.reference ?? null }),
  );
  return { plan: { ...plan, expectedHash }, projection, selected };
}

export async function planSourceUpdate(
  config: PublisherConfig,
  publicId: string,
  input: SourceUpdateInput,
) {
  return (await prepare(config, publicId, SourceUpdateInputSchema.parse(input))).plan;
}

export async function applySourceUpdate(
  config: PublisherConfig,
  publicId: string,
  input: SourceUpdateApply,
) {
  const { expectedHash, body, ...selection } = SourceUpdateApplySchema.parse(input);
  return withLock(config.publisher.stateDir, async () => {
    const { plan, projection, selected } = await prepare(config, publicId, selection);
    if (plan.expectedHash !== expectedHash) {
      throw new PublisherError(
        "STALE_SOURCE_UPDATE",
        "Source or projection changed; inspect a new merge plan",
      );
    }
    if (selected === null)
      throw new PublisherError(
        "SOURCE_UPDATE_BLOCKED",
        "Resolve the selected source before merging",
      );
    const parts = splitSource(projection.raw);
    const frontmatter = parsedFrontmatter(parts);
    const key = ["public", "sources", plan.referenceIndex];
    frontmatter.setIn([...key, "capturedHash"], selected.reference.capturedHash);
    if (selected.reference.anchor !== undefined)
      frontmatter.setIn([...key, "anchor"], selected.reference.anchor);
    if (selected.reference.selection !== undefined)
      frontmatter.setIn([...key, "selection"], selected.reference.selection);
    const newline = parts.newline;
    const merged = body.replace(/\r\n?/gu, "\n").replaceAll("\n", newline);
    const ending = projection.raw.endsWith("\n") && !merged.endsWith("\n") ? newline : "";
    const content = serializeSource({ ...parts, body: `${merged}${ending}` }, frontmatter);
    const source = await safePath(config.vault.root, plan.sourcePath);
    if (hash(await readFile(source)) !== plan.sourceHash) {
      throw new PublisherError(
        "STALE_SOURCE_UPDATE",
        "The source changed before the merge was saved",
      );
    }
    await atomicWrite(
      await safePath(config.vault.root, plan.projectionPath),
      content,
      plan.projectionHash,
    );
    return { publicId, path: plan.projectionPath, sourceHash: hash(content) };
  });
}

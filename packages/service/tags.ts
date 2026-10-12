import { readFile } from "node:fs/promises";
import { hash, safePath, withLock } from "../fs/index.ts";
import {
  buildTagTree,
  matchesTagQueries,
  type PublisherConfig,
  PublisherError,
  type TagTreeNode,
  tagMatches,
} from "../model/index.ts";
import { loadVault } from "../vault/index.ts";
import { MetadataPatchSchema } from "./schema.ts";
import { patchMetadata } from "./source.ts";
import {
  type TagFilterInput,
  TagFilterInputSchema,
  type TaggedDocument,
  type TagRenameApply,
  TagRenameApplySchema,
  type TagRenameInput,
  TagRenameInputSchema,
} from "./tag-schema.ts";

async function taggedDocuments(config: PublisherConfig): Promise<readonly TaggedDocument[]> {
  const vault = await loadVault(config);
  return vault.documents
    .flatMap((document): readonly TaggedDocument[] => {
      const spec = document.frontmatter.public;
      if (spec === undefined) return [];
      return [
        {
          publicId: spec.id,
          title: spec.title ?? document.frontmatter.title ?? spec.id,
          sourcePath: document.sourcePath,
          sourceHash: document.sourceHash,
          tags: spec.tags,
        },
      ];
    })
    .sort((left, right) => left.publicId.localeCompare(right.publicId));
}

export async function tagTree(config: PublisherConfig): Promise<readonly TagTreeNode[]> {
  return buildTagTree((await taggedDocuments(config)).map((document) => document.tags));
}

export async function tagList(config: PublisherConfig) {
  const flatten = (nodes: readonly TagTreeNode[]): readonly Omit<TagTreeNode, "children">[] =>
    nodes.flatMap(({ children, ...node }) => [node, ...flatten(children)]);
  return flatten(await tagTree(config));
}

export async function filterByTags(
  config: PublisherConfig,
  input: TagFilterInput,
): Promise<readonly TaggedDocument[]> {
  const parsed = TagFilterInputSchema.parse(input);
  return (await taggedDocuments(config)).filter((document) =>
    matchesTagQueries(document.tags, parsed.tags, parsed.mode),
  );
}

function renamedTags(
  tags: readonly string[],
  input: ReturnType<typeof TagRenameInputSchema.parse>,
): readonly string[] {
  const renamed = tags.map((tag) => {
    if (!tagMatches(tag, input.from, input.mode)) return tag;
    return tag === input.from ? input.to : `${input.to}${tag.slice(input.from.length)}`;
  });
  return [...new Set(renamed)];
}

async function prepareTagRename(config: PublisherConfig, input: TagRenameInput) {
  const parsed = TagRenameInputSchema.parse(input);
  const documents = await taggedDocuments(config);
  const changes = documents.flatMap((document) => {
    const tags = renamedTags(document.tags, parsed);
    if (
      tags.length === document.tags.length &&
      tags.every((tag, index) => tag === document.tags[index])
    )
      return [];
    const patch = MetadataPatchSchema.parse({ tags });
    return [{ ...document, tagsBefore: document.tags, tagsAfter: patch.tags ?? [], patch }];
  });
  const report = {
    operation: "tag-rename" as const,
    ...parsed,
    changes,
    canApply: changes.length > 0,
  };
  return { ...report, expectedHash: hash(JSON.stringify(report)) };
}

export async function planTagRename(config: PublisherConfig, input: TagRenameInput) {
  return prepareTagRename(config, input);
}

export async function applyTagRename(config: PublisherConfig, input: TagRenameApply) {
  const { expectedHash, ...rename } = TagRenameApplySchema.parse(input);
  return withLock(config.publisher.stateDir, async () => {
    const plan = await prepareTagRename(config, rename);
    if (plan.expectedHash !== expectedHash) {
      throw new PublisherError(
        "STALE_TAG_RENAME",
        "Tag sources changed; inspect a new rename plan",
      );
    }
    if (!plan.canApply) {
      throw new PublisherError("TAG_RENAME_EMPTY", "No current public tags match the rename");
    }
    for (const change of plan.changes) {
      const path = await safePath(config.vault.root, change.sourcePath);
      if (hash(await readFile(path)) !== change.sourceHash) {
        throw new PublisherError("STALE_TAG_RENAME", "Tag sources changed before rename apply");
      }
    }
    for (const change of plan.changes) {
      await patchMetadata(
        config,
        change.sourcePath,
        change.publicId,
        change.patch,
        change.sourceHash,
      );
    }
    return { applied: true as const, expectedHash, updated: plan.changes.length };
  });
}

import type { Heading, Root } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { LinkTarget, VaultLinkTarget } from "../markdown/index.ts";
import type { ApprovedRevision, PrivateDocument, PublicMetadata } from "../model/index.ts";
import { validatePublicPath } from "./metadata.ts";

const headingTitles = (markdown: string): readonly string[] => {
  const tree: Root = unified().use(remarkParse).parse(markdown);
  const headings: string[] = [];
  visit(tree, "heading", (node: Heading) => {
    headings.push(mdastToString(node));
  });
  return headings;
};

export const approvedTarget = (revision: ApprovedRevision): LinkTarget => ({
  publicId: revision.publicId,
  slug: validatePublicPath(revision.metadata.slug),
  title: revision.metadata.title,
  kind: revision.metadata.kind,
  keys: [
    revision.publicId,
    revision.metadata.slug,
    revision.metadata.title,
    ...revision.metadata.aliases,
  ],
  headings: headingTitles(revision.markdown),
});

export const selfTarget = (document: PrivateDocument, metadata: PublicMetadata): LinkTarget => ({
  publicId: metadata.id,
  slug: metadata.slug,
  title: metadata.title,
  kind: metadata.kind,
  keys: [
    metadata.id,
    metadata.slug,
    metadata.title,
    document.sourcePath,
    document.sourcePath.replace(/\.md$/iu, ""),
    ...metadata.aliases,
  ],
  headings: document.headings.map(({ title }) => title),
});

export const buildVaultTargets = (
  documents: readonly PrivateDocument[],
  approved: readonly LinkTarget[],
): readonly VaultLinkTarget[] => {
  const approvedById = new Map(approved.map((target) => [target.publicId, target]));
  return documents.map((document) => {
    const approvedRevision = document.frontmatter.public
      ? approvedById.get(document.frontmatter.public.id)
      : undefined;
    return {
      sourcePath: document.sourcePath,
      aliases: document.frontmatter.aliases,
      ...(document.frontmatter.id ? { privateId: document.frontmatter.id } : {}),
      ...(document.frontmatter.title ? { title: document.frontmatter.title } : {}),
      ...(document.frontmatter.public ? { publicId: document.frontmatter.public.id } : {}),
      ...(approvedRevision ? { approved: approvedRevision } : {}),
    };
  });
};

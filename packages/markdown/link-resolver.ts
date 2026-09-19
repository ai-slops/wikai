import { extname, posix } from "node:path";
import GithubSlugger from "github-slugger";
import type { Parent, Root, RootContent, Text } from "mdast";
import { visit } from "unist-util-visit";
import type { PublicKind, PublicLink } from "../model/index.ts";

export type LinkTarget = {
  readonly publicId: string;
  readonly slug: string;
  readonly title: string;
  readonly kind: PublicKind;
  readonly keys: readonly string[];
  readonly headings: readonly string[];
};

export type VaultLinkTarget = {
  readonly sourcePath: string;
  readonly privateId?: string;
  readonly title?: string;
  readonly aliases: readonly string[];
  readonly publicId?: string;
  readonly approved?: LinkTarget;
};

export type LinkContext = {
  readonly targets: readonly LinkTarget[];
  readonly vaultTargets: readonly VaultLinkTarget[];
  readonly sourcePath: string;
  readonly self: LinkTarget;
};

export class MarkdownError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MarkdownError";
    this.code = code;
  }
}

const normalize = (value: string): string =>
  decodeURIComponent(value)
    .normalize("NFC")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\.md$/iu, "")
    .toLocaleLowerCase("en-US");

const uniqueVaultMatch = (matches: readonly VaultLinkTarget[]): VaultLinkTarget | undefined => {
  if (matches.length > 1)
    throw new MarkdownError("AMBIGUOUS_INTERNAL_LINK", "Internal link target is ambiguous");
  return matches[0];
};

const resolveVaultTarget = (
  reference: string,
  context: LinkContext,
): VaultLinkTarget | undefined => {
  const key = normalize(reference);
  const byId = uniqueVaultMatch(
    context.vaultTargets.filter(
      (target) => target.privateId && normalize(target.privateId) === key,
    ),
  );
  if (byId) return byId;
  if (!reference.startsWith("/")) {
    const relativeKey = normalize(posix.join(posix.dirname(context.sourcePath), reference));
    const byRelativePath = uniqueVaultMatch(
      context.vaultTargets.filter((target) => normalize(target.sourcePath) === relativeKey),
    );
    if (byRelativePath) return byRelativePath;
  }
  const byVaultPath = uniqueVaultMatch(
    context.vaultTargets.filter((target) => normalize(target.sourcePath) === key),
  );
  if (byVaultPath) return byVaultPath;
  const byAlias = uniqueVaultMatch(
    context.vaultTargets.filter((target) =>
      target.aliases.some((alias) => normalize(alias) === key),
    ),
  );
  if (byAlias) return byAlias;
  return uniqueVaultMatch(
    context.vaultTargets.filter((target) => target.title && normalize(target.title) === key),
  );
};

export const resolveTarget = (reference: string, context: LinkContext): LinkTarget => {
  const vaultTarget = resolveVaultTarget(reference, context);
  if (vaultTarget) {
    if (vaultTarget.sourcePath === context.sourcePath) return context.self;
    if (vaultTarget.approved) return vaultTarget.approved;
    if (vaultTarget.publicId)
      throw new MarkdownError(
        "UNAPPROVED_REVISION",
        "Internal link target has no approved revision",
      );
    throw new MarkdownError("PRIVATE_TARGET_LINK", "Internal link target is private");
  }
  const key = normalize(reference);
  const matches = context.targets.filter((target) =>
    target.keys.some((candidate) => normalize(candidate) === key),
  );
  if (matches.length === 0)
    throw new MarkdownError("UNRESOLVED_INTERNAL_LINK", "Internal link target cannot be resolved");
  if (matches.length > 1)
    throw new MarkdownError("AMBIGUOUS_INTERNAL_LINK", "Internal link target is ambiguous");
  const target = matches[0];
  if (!target)
    throw new MarkdownError("UNRESOLVED_INTERNAL_LINK", "Internal link target cannot be resolved");
  return target;
};

export const publicLink = (
  reference: string,
  anchor: string | undefined,
  context: LinkContext,
): PublicLink => {
  const target = resolveTarget(reference, context);
  if (!anchor) return { publicId: target.publicId, slug: target.slug, title: target.title };
  const slugger = new GithubSlugger();
  const approvedAnchors = target.headings.map((heading) => slugger.slug(heading));
  let anchorText: string;
  try {
    anchorText = decodeURIComponent(anchor).normalize("NFC");
  } catch (error) {
    if (error instanceof URIError)
      throw new MarkdownError("LINK_ANCHOR_INVALID", "Internal link heading is invalid");
    throw error;
  }
  const candidate = new GithubSlugger().slug(anchorText);
  if (!approvedAnchors.includes(candidate))
    throw new MarkdownError("LINK_ANCHOR_NOT_APPROVED", "Internal link heading is not approved");
  return { publicId: target.publicId, slug: target.slug, title: target.title, anchor: candidate };
};

export const linkUrl = (link: PublicLink): string =>
  `${link.slug}${link.anchor ? `#${link.anchor}` : ""}`;

export const splitReference = (
  url: string,
): { readonly reference: string; readonly anchor?: string } => {
  const marker = url.indexOf("#");
  return marker < 0
    ? { reference: url }
    : { reference: url.slice(0, marker), anchor: url.slice(marker + 1) };
};

const parseWikiText = (
  node: Text,
  context: LinkContext,
  outgoing: PublicLink[],
): RootContent[] | undefined => {
  const parts: RootContent[] = [];
  let cursor = 0;
  while (cursor < node.value.length) {
    const opening = node.value.indexOf("[[", cursor);
    if (opening < 0) break;
    const embedded = opening > 0 && node.value[opening - 1] === "!";
    const closing = node.value.indexOf("]]", opening + 2);
    if (closing < 0) throw new MarkdownError("LINK_INVALID", "Wiki link is not closed");
    const textEnd = embedded ? opening - 1 : opening;
    if (textEnd > cursor) parts.push({ type: "text", value: node.value.slice(cursor, textEnd) });
    const inner = node.value.slice(opening + 2, closing);
    const [destination = "", label] = inner.split("|", 2);
    const { reference, anchor } = splitReference(destination);
    if (embedded) {
      const extension = extname(reference).toLowerCase();
      if (anchor || extension === "" || extension === ".md")
        throw new MarkdownError(
          "MARKDOWN_TRANSCLUSION_FORBIDDEN",
          "Note transclusion is forbidden",
        );
      parts.push({ type: "image", url: reference, alt: label ?? "" });
      cursor = closing + 2;
      continue;
    }
    const target = resolveTarget(reference, context);
    const resolved = publicLink(reference, anchor, context);
    outgoing.push(resolved);
    parts.push({
      type: "link",
      url: linkUrl(resolved),
      children: [{ type: "text", value: label ?? target.title }],
    });
    cursor = closing + 2;
  }
  if (parts.length === 0) return undefined;
  if (cursor < node.value.length) parts.push({ type: "text", value: node.value.slice(cursor) });
  return parts;
};

export const transformWikiLinks = (
  tree: Root,
  context: LinkContext,
  outgoing: PublicLink[],
): void => {
  visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
    if (index === undefined || !parent) return;
    const replacement = parseWikiText(node, context, outgoing);
    if (replacement) parent.children.splice(index, 1, ...replacement);
  });
};

import { extname, posix } from "node:path";
import GithubSlugger from "github-slugger";
import type {
  Definition,
  Heading,
  Image,
  ImageReference,
  Link,
  LinkReference,
  Parent,
  Root,
  Text,
} from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { AssetError, materializeAsset } from "../assets/index.ts";
import type { MaterializedAsset, PublicLink, PublisherConfig } from "../model/index.ts";
import {
  type LinkContext,
  type LinkTarget,
  linkUrl,
  MarkdownError,
  publicLink,
  splitReference,
  transformWikiLinks,
  type VaultLinkTarget,
} from "./link-resolver.ts";

export type { LinkTarget, VaultLinkTarget } from "./link-resolver.ts";
export { MarkdownError } from "./link-resolver.ts";

export type MarkdownResult = {
  readonly markdown: string;
  readonly html: string;
  readonly outgoingLinks: readonly PublicLink[];
  readonly assets: readonly MaterializedAsset[];
};

export type MarkdownInput = {
  readonly body: string;
  readonly sourcePath: string;
  readonly config: PublisherConfig;
  readonly targets: readonly LinkTarget[];
  readonly vaultTargets: readonly VaultLinkTarget[];
  readonly self: LinkTarget;
};

const isExternal = (url: string): boolean => /^(?:https?:|mailto:)/iu.test(url);

const isPotentialAsset = (
  reference: string,
  sourcePath: string,
  roots: readonly string[],
): boolean => {
  const candidate = posix.normalize(posix.join(posix.dirname(sourcePath), reference));
  return roots.some((root) => {
    const normalized = root.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    return candidate === normalized || candidate.startsWith(`${normalized}/`);
  });
};

const materialize = async (
  url: string,
  sourcePath: string,
  config: PublisherConfig,
): Promise<MaterializedAsset> => {
  try {
    return await materializeAsset(url, sourcePath, config);
  } catch (error) {
    if (error instanceof AssetError) throw new MarkdownError(error.code, error.message);
    throw error;
  }
};

const removePositions = (positions: ReadonlyMap<Parent, readonly number[]>): void => {
  for (const [parent, indexes] of positions) {
    for (const index of [...indexes].sort((left, right) => right - left)) {
      parent.children.splice(index, 1);
    }
  }
};

type TransformState = {
  readonly context: LinkContext;
  readonly config: PublisherConfig;
  readonly outgoing: PublicLink[];
  readonly assets: MaterializedAsset[];
};

const validateStructure = (tree: Root): void => {
  const comments = new Map<Parent, number[]>();
  visit(tree, "html", (node, index, parent: Parent | undefined) => {
    if (/^<!--[\s\S]*-->$/u.test(node.value.trim())) {
      if (index !== undefined && parent) {
        const indexes = comments.get(parent) ?? [];
        indexes.push(index);
        comments.set(parent, indexes);
      }
      return;
    }
    throw new MarkdownError("MARKDOWN_HTML_FORBIDDEN", "Raw HTML and MDX are forbidden");
  });
  removePositions(comments);
  visit(tree, "text", (node: Text) => {
    if (/\{[^{}\n]+\}/u.test(node.value))
      throw new MarkdownError("MARKDOWN_MDX_FORBIDDEN", "MDX expressions are forbidden");
  });
  const slugger = new GithubSlugger();
  visit(tree, "heading", (node: Heading) => {
    node.data = { hProperties: { id: slugger.slug(mdastToString(node)) } };
  });
};

const expandReferences = (tree: Root): void => {
  const definitions = new Map<string, Definition>();
  visit(tree, "definition", (node: Definition) => {
    const key = node.identifier.toLocaleLowerCase("en-US");
    if (definitions.has(key))
      throw new MarkdownError(
        "AMBIGUOUS_MARKDOWN_REFERENCE",
        "Markdown reference identifier is ambiguous",
      );
    definitions.set(key, node);
  });
  visit(tree, "linkReference", (node: LinkReference, index, parent: Parent | undefined) => {
    if (index === undefined || !parent) return;
    const definition = definitions.get(node.identifier.toLocaleLowerCase("en-US"));
    if (!definition)
      throw new MarkdownError(
        "UNRESOLVED_MARKDOWN_REFERENCE",
        "Markdown link reference is unresolved",
      );
    parent.children.splice(index, 1, {
      type: "link",
      url: definition.url,
      ...(definition.title ? { title: definition.title } : {}),
      children: node.children,
    });
  });
  visit(tree, "imageReference", (node: ImageReference, index, parent: Parent | undefined) => {
    if (index === undefined || !parent) return;
    const definition = definitions.get(node.identifier.toLocaleLowerCase("en-US"));
    if (!definition)
      throw new MarkdownError(
        "UNRESOLVED_MARKDOWN_REFERENCE",
        "Markdown image reference is unresolved",
      );
    parent.children.splice(index, 1, {
      type: "image",
      url: definition.url,
      alt: node.alt,
      ...(definition.title ? { title: definition.title } : {}),
    });
  });
  const positions = new Map<Parent, number[]>();
  visit(tree, "definition", (_node, index, parent: Parent | undefined) => {
    if (index === undefined || !parent) return;
    const indexes = positions.get(parent) ?? [];
    indexes.push(index);
    positions.set(parent, indexes);
  });
  removePositions(positions);
};

const transformImages = async (tree: Root, state: TransformState): Promise<void> => {
  const images: Image[] = [];
  visit(tree, "image", (node: Image) => {
    images.push(node);
  });
  for (const image of images) {
    const asset = await materialize(image.url, state.context.sourcePath, state.config);
    state.assets.push(asset);
    image.url = asset.publicPath;
  }
};

const transformLinks = async (tree: Root, state: TransformState): Promise<void> => {
  const links: Link[] = [];
  visit(tree, "link", (node: Link) => {
    links.push(node);
  });
  for (const link of links) {
    if (isExternal(link.url)) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(link.url))
      throw new MarkdownError("MARKDOWN_LINK_SCHEME_FORBIDDEN", "Link protocol is forbidden");
    if (link.url.startsWith("#")) {
      const selfContext = {
        ...state.context,
        targets: [state.context.self],
        vaultTargets: [],
      };
      const resolved = publicLink(state.context.self.slug, link.url.slice(1), selfContext);
      state.outgoing.push(resolved);
      link.url = linkUrl(resolved);
      continue;
    }
    const { reference, anchor } = splitReference(link.url);
    const extension = extname(reference).toLowerCase();
    if (
      !reference.startsWith("/") &&
      ((extension && extension !== ".md") ||
        (!extension &&
          isPotentialAsset(reference, state.context.sourcePath, state.config.assets.roots)))
    ) {
      const asset = await materialize(reference, state.context.sourcePath, state.config);
      state.assets.push(asset);
      link.url = asset.publicPath;
      continue;
    }
    const resolved = publicLink(reference, anchor, state.context);
    state.outgoing.push(resolved);
    link.url = linkUrl(resolved);
  }
};

export const compileMarkdown = async (input: MarkdownInput): Promise<MarkdownResult> => {
  const tree: Root = unified().use(remarkParse).use(remarkGfm).parse(input.body);
  const context = {
    targets: input.targets,
    vaultTargets: input.vaultTargets,
    sourcePath: input.sourcePath,
    self: input.self,
  };
  const outgoing: PublicLink[] = [];
  const assets: MaterializedAsset[] = [];
  const state = { context, config: input.config, outgoing, assets };
  expandReferences(tree);
  validateStructure(tree);
  transformWikiLinks(tree, context, outgoing);
  await transformImages(tree, state);
  await transformLinks(tree, state);
  const markdown = unified().use(remarkGfm).use(remarkStringify).stringify(tree);
  const renderer = unified()
    .use(remarkRehype)
    .use(rehypeSanitize, { ...defaultSchema, clobberPrefix: "" })
    .use(rehypeStringify);
  const html = renderer.stringify(await renderer.run(tree));
  return {
    markdown,
    html,
    outgoingLinks: outgoing.filter(
      (link, index, all) =>
        all.findIndex(
          (candidate) => candidate.publicId === link.publicId && candidate.anchor === link.anchor,
        ) === index,
    ),
    assets: assets.filter(
      (asset, index, all) =>
        all.findIndex((candidate) => candidate.publicPath === asset.publicPath) === index,
    ),
  };
};

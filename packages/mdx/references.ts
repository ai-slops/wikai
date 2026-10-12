import type { Image, Link, Root } from "mdast";
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx-jsx";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { AssetError, materializeAsset } from "../assets/index.ts";
import { isAssetReference } from "../markdown/asset-references.ts";
import {
  type LinkTarget,
  MarkdownError,
  publicLink,
  splitReference,
  type VaultLinkTarget,
} from "../markdown/link-resolver.ts";
import { sourceRange } from "../markdown/source-range.ts";
import type { MaterializedAsset, PublicLink, PublisherConfig } from "../model/index.ts";

export type MdxReferenceInput = {
  readonly body: string;
  readonly sourcePath: string;
  readonly config: PublisherConfig;
  readonly targets: readonly LinkTarget[];
  readonly vaultTargets: readonly VaultLinkTarget[];
  readonly self: LinkTarget;
};

export type MdxReferenceResult = {
  readonly body: string;
  readonly outgoingLinks: readonly PublicLink[];
  readonly assets: readonly MaterializedAsset[];
};

const external = (url: string): boolean => /^(?:https?:|mailto:)/iu.test(url);

export async function compileMdxReferences(input: MdxReferenceInput): Promise<MdxReferenceResult> {
  const processor = unified().use(remarkParse).use(remarkMdx).use(remarkStringify);
  const tree: Root = processor.parse(input.body);
  const links: Link[] = [];
  const images: Image[] = [];
  const elements: Array<MdxJsxFlowElement | MdxJsxTextElement> = [];
  visit(tree, "link", (node: Link) => links.push(node));
  visit(tree, "image", (node: Image) => images.push(node));
  visit(tree, "mdxJsxFlowElement", (node: MdxJsxFlowElement) => elements.push(node));
  visit(tree, "mdxJsxTextElement", (node: MdxJsxTextElement) => elements.push(node));
  const outgoingLinks: PublicLink[] = [];
  const assets: MaterializedAsset[] = [];
  const context = {
    targets: input.targets,
    vaultTargets: input.vaultTargets,
    sourcePath: input.sourcePath,
    self: input.self,
  };
  for (const image of images) {
    try {
      const asset = await materializeAsset(image.url, input.sourcePath, input.config);
      assets.push(asset);
      image.url = asset.publicPath;
    } catch (error) {
      if (error instanceof AssetError)
        throw new MarkdownError(error.code, error.message, sourceRange(image));
      throw error;
    }
  }
  for (const element of elements) {
    if (element.name !== "img") continue;
    const source = element.attributes.find(
      (attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === "src",
    );
    if (source?.type !== "mdxJsxAttribute" || typeof source.value !== "string") continue;
    try {
      const asset = await materializeAsset(source.value, input.sourcePath, input.config);
      assets.push(asset);
      source.value = asset.publicPath;
    } catch (error) {
      if (error instanceof AssetError)
        throw new MarkdownError(error.code, error.message, sourceRange(element));
      throw error;
    }
  }
  for (const link of links) {
    if (external(link.url)) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(link.url)) {
      throw new MarkdownError(
        "MARKDOWN_LINK_SCHEME_FORBIDDEN",
        "Link protocol is forbidden",
        sourceRange(link),
      );
    }
    if (isAssetReference(link.url, input.sourcePath, input.config.assets.roots)) {
      try {
        const asset = await materializeAsset(link.url, input.sourcePath, input.config);
        assets.push(asset);
        link.url = asset.publicPath;
      } catch (error) {
        if (error instanceof AssetError)
          throw new MarkdownError(error.code, error.message, sourceRange(link));
        throw error;
      }
      continue;
    }
    const { reference, anchor } = splitReference(link.url);
    const resolved = link.url.startsWith("#")
      ? publicLink(input.self.slug, link.url.slice(1), {
          ...context,
          targets: [input.self],
          vaultTargets: [],
        })
      : publicLink(reference, anchor, context);
    outgoingLinks.push(resolved);
    link.url = `${resolved.slug}${resolved.anchor === undefined ? "" : `#${resolved.anchor}`}`;
  }
  for (const element of elements) {
    if (element.name !== "a") continue;
    const href = element.attributes.find(
      (attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === "href",
    );
    if (href?.type !== "mdxJsxAttribute" || typeof href.value !== "string" || external(href.value))
      continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(href.value)) {
      throw new MarkdownError(
        "MARKDOWN_LINK_SCHEME_FORBIDDEN",
        "Link protocol is forbidden",
        sourceRange(element),
      );
    }
    const { reference, anchor } = splitReference(href.value);
    try {
      const resolved = href.value.startsWith("#")
        ? publicLink(input.self.slug, href.value.slice(1), {
            ...context,
            targets: [input.self],
            vaultTargets: [],
          })
        : publicLink(reference, anchor, context);
      outgoingLinks.push(resolved);
      href.value = `${resolved.slug}${resolved.anchor === undefined ? "" : `#${resolved.anchor}`}`;
    } catch (error) {
      if (error instanceof MarkdownError) throw error.at(sourceRange(element));
      throw error;
    }
  }
  return {
    body: processor.stringify(tree),
    outgoingLinks: outgoingLinks.filter(
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
}

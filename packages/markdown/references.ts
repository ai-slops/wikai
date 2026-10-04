import type { Definition, ImageReference, LinkReference, Parent, Root } from "mdast";
import { visit } from "unist-util-visit";
import { MarkdownError } from "./link-resolver.ts";

export const removePositions = (positions: ReadonlyMap<Parent, readonly number[]>): void => {
  for (const [parent, indexes] of positions) {
    for (const index of [...indexes].sort((left, right) => right - left)) {
      parent.children.splice(index, 1);
    }
  }
};

export const expandReferences = (tree: Root): void => {
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

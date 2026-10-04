import type { Nodes, Text } from "mdast";
import { toString as nodeText } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { PublisherError, type SourceSelection } from "../model/index.ts";

const parser = unified().use(remarkParse).use(remarkGfm);

function offset(node: Nodes, edge: "start" | "end"): number {
  const value = node.position?.[edge].offset;
  if (value === undefined) {
    throw new PublisherError("EXTRACT_POSITION_MISSING", "Selection source position is missing");
  }
  return value;
}

function terminalText(node: Nodes): Text | undefined {
  if (node.type === "text") return node;
  if ("children" in node) {
    const child = node.children.at(-1);
    if (child !== undefined) return terminalText(child);
  }
  return undefined;
}

export function anchoredFragments(
  body: string,
  selection: Exclude<SourceSelection, { readonly kind: "lines" }>,
): readonly string[] {
  const children = parser.parse(body).children;
  switch (selection.kind) {
    case "heading": {
      const headings = children.filter((node) => node.type === "heading");
      return headings.flatMap((node, index) => {
        if (nodeText(node).toLowerCase() !== selection.value.toLowerCase()) return [];
        const next = headings.slice(index + 1).find((heading) => heading.depth <= node.depth);
        return [
          body.slice(
            offset(node, "start"),
            next === undefined ? body.length : offset(next, "start"),
          ),
        ];
      });
    }
    case "block": {
      const marker = `^${selection.value}`;
      return children.flatMap((node, index) => {
        const text = terminalText(node)?.value.trimEnd();
        if (text === undefined || !text.endsWith(marker)) return [];
        const raw = body.slice(offset(node, "start"), offset(node, "end")).trimEnd();
        if (!raw.endsWith(marker)) return [];
        const prefix = raw.slice(0, -marker.length);
        if (prefix !== "" && !/\s$/u.test(prefix)) return [];
        if (node.type === "paragraph" && raw === marker) {
          const previous = children[index - 1];
          if (previous === undefined || previous.type === "code" || previous.type === "html")
            return [];
          return [body.slice(offset(previous, "start"), offset(previous, "end"))];
        }
        return [prefix];
      });
    }
    default: {
      const exhaustive: never = selection;
      return exhaustive;
    }
  }
}

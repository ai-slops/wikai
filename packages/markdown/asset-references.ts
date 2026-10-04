import { extname, posix } from "node:path";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { MarkdownError, splitReference } from "./link-resolver.ts";
import { expandReferences } from "./references.ts";

export function isAssetReference(
  reference: string,
  sourcePath: string,
  roots: readonly string[],
): boolean {
  if (reference.startsWith("/")) return false;
  const extension = extname(reference).toLowerCase();
  if (extension !== "") return extension !== ".md";
  const candidate = posix.normalize(posix.join(posix.dirname(sourcePath), reference));
  return roots.some((root) => {
    const normalized = root.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
    return candidate === normalized || candidate.startsWith(`${normalized}/`);
  });
}

export function collectAssetReferences(
  body: string,
  sourcePath: string,
  roots: readonly string[],
): readonly string[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body);
  expandReferences(tree);
  const urls: string[] = [];
  visit(tree, "image", (node) => {
    urls.push(node.url);
  });
  visit(tree, "link", (node) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu.test(node.url)) return;
    const { reference } = splitReference(node.url);
    if (isAssetReference(reference, sourcePath, roots)) urls.push(reference);
  });
  visit(tree, "text", (node) => {
    let cursor = 0;
    while (cursor < node.value.length) {
      const opening = node.value.indexOf("[[", cursor);
      if (opening < 0) break;
      const closing = node.value.indexOf("]]", opening + 2);
      if (closing < 0) throw new MarkdownError("LINK_INVALID", "Wiki link is not closed");
      if (opening > 0 && node.value[opening - 1] === "!") {
        const destination = node.value.slice(opening + 2, closing).split("|", 1)[0] ?? "";
        const { reference, anchor } = splitReference(destination);
        const extension = extname(reference).toLowerCase();
        if (!anchor && extension !== "" && extension !== ".md") urls.push(reference);
      }
      cursor = closing + 2;
    }
  });
  return [...new Set(urls)];
}

import { z } from "zod";

export const TagPathSchema = z
  .string()
  .transform((value) => value.normalize("NFC"))
  .superRefine((value, context) => {
    const segments = value.split("/");
    if (
      segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
      value.includes("\\") ||
      /\p{Cc}/u.test(value)
    ) {
      context.addIssue({ code: "custom", message: "Invalid tag path" });
    }
  });
export type TagPath = z.infer<typeof TagPathSchema>;

export const TagListSchema = z.array(TagPathSchema);
export const TagMatchModeSchema = z.enum(["exact", "subtree"]);
export type TagMatchMode = z.infer<typeof TagMatchModeSchema>;

export type TagTreeNode = {
  readonly path: TagPath;
  readonly segment: string;
  readonly directCount: number;
  readonly descendantCount: number;
  readonly children: readonly TagTreeNode[];
};

export function tagMatches(tag: TagPath, query: TagPath, mode: TagMatchMode): boolean {
  return tag === query || (mode === "subtree" && tag.startsWith(`${query}/`));
}

export function matchesTagQueries(
  tags: readonly TagPath[],
  queries: readonly TagPath[],
  mode: TagMatchMode,
): boolean {
  return queries.every((query) => tags.some((tag) => tagMatches(tag, query, mode)));
}

export function buildTagTree(documents: readonly (readonly TagPath[])[]): readonly TagTreeNode[] {
  const direct = new Map<TagPath, Set<number>>();
  const descendants = new Map<TagPath, Set<number>>();
  for (const [documentIndex, tags] of documents.entries()) {
    for (const tag of new Set(tags)) {
      const directDocuments = direct.get(tag) ?? new Set<number>();
      directDocuments.add(documentIndex);
      direct.set(tag, directDocuments);
      const segments = tag.split("/");
      for (let index = 1; index <= segments.length; index += 1) {
        const path = segments.slice(0, index).join("/");
        const descendantDocuments = descendants.get(path) ?? new Set<number>();
        descendantDocuments.add(documentIndex);
        descendants.set(path, descendantDocuments);
      }
    }
  }
  const paths = [...descendants.keys()].sort((left, right) => left.localeCompare(right));
  const nodes = (parent: TagPath | null): readonly TagTreeNode[] =>
    paths
      .filter((path) => {
        const separator = path.lastIndexOf("/");
        return parent === null ? separator === -1 : path.slice(0, separator) === parent;
      })
      .map((path) => ({
        path,
        segment: path.slice(path.lastIndexOf("/") + 1),
        directCount: direct.get(path)?.size ?? 0,
        descendantCount: descendants.get(path)?.size ?? 0,
        children: nodes(path),
      }));
  return nodes(null);
}

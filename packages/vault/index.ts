import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import GithubSlugger from "github-slugger";
import type { Heading, Root } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import { minimatch } from "minimatch";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { isMap, isNode, isScalar, parseDocument } from "yaml";
import { hash } from "../fs/index.ts";
import { splitMarkdownSource } from "../markdown/frontmatter.ts";
import { offsetSourceRange } from "../markdown/source-range.ts";
import {
  type Diagnostic,
  FrontmatterSchema,
  type PrivateDocument,
  type PublisherConfig,
  PublisherError,
  type SourceRange,
  type VaultSnapshot,
} from "../model/index.ts";

const PUBLIC_KEY_VARIANTS = new Set([
  "publish",
  "published",
  "publication",
  "ispublic",
  "is-public",
]);

class VaultError extends Error {
  readonly code: string;
  readonly sourceRange: SourceRange | undefined;
  constructor(code: string, message: string, sourceRange?: SourceRange) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    this.sourceRange = sourceRange;
  }
}

const diagnostic = (
  code: string,
  message: string,
  sourcePath: string,
  sourceRange?: SourceRange,
): Diagnostic => ({
  code,
  severity: "error",
  message,
  sourcePath,
  ...(sourceRange === undefined ? {} : { sourceRange }),
});

const yamlSourceRange = (
  raw: string,
  frontmatterOffset: number,
  value: unknown,
): SourceRange | undefined => {
  if (!isNode(value)) return undefined;
  const range = value.range;
  if (range === undefined || range === null) return undefined;
  const [start, end] = range;
  return offsetSourceRange(raw, frontmatterOffset + start, frontmatterOffset + end);
};

const discover = async (
  root: string,
  include: readonly string[],
  exclude: readonly string[],
): Promise<{ paths: string[]; diagnostics: Diagnostic[] }> => {
  const paths: string[] = [];
  const diagnostics: Diagnostic[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      const sourcePath = relative(root, absolute).split(sep).join("/");
      if (exclude.some((pattern) => minimatch(sourcePath, pattern, { dot: true }))) continue;
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        diagnostics.push(diagnostic("VAULT_SYMLINK", "Vault symlinks are forbidden", sourcePath));
        continue;
      }
      if (stat.isDirectory()) await walk(absolute);
      else if (
        stat.isFile() &&
        include.some((pattern) => minimatch(sourcePath, pattern, { dot: true }))
      )
        paths.push(sourcePath);
    }
  };
  await walk(root);
  return { paths: paths.sort((left, right) => left.localeCompare(right)), diagnostics };
};

const parseSource = (raw: string, sourcePath: string): PrivateDocument => {
  const { frontmatter, body } = splitMarkdownSource(raw);
  const frontmatterOffset = raw.indexOf("\n") + 1;
  const yaml = parseDocument(frontmatter || "{}", { uniqueKeys: true });
  const yamlError = yaml.errors[0];
  if (yamlError !== undefined) {
    const [start, end] = yamlError.pos;
    throw new VaultError(
      "FRONTMATTER_INVALID",
      "Markdown frontmatter is invalid",
      offsetSourceRange(raw, frontmatterOffset + start, frontmatterOffset + end),
    );
  }
  const parsed = FrontmatterSchema.safeParse(yaml.toJS({ maxAliasCount: 20 }));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const node = issue === undefined ? undefined : yaml.getIn(issue.path, true);
    throw new VaultError(
      "FRONTMATTER_INVALID",
      "Markdown frontmatter is invalid",
      yamlSourceRange(raw, frontmatterOffset, node),
    );
  }
  const invalidPublicKey = Object.keys(parsed.data).find((key) =>
    PUBLIC_KEY_VARIANTS.has(key.toLocaleLowerCase("en-US")),
  );
  if (invalidPublicKey !== undefined) {
    const pair = isMap(yaml.contents)
      ? yaml.contents.items.find(
          (item) => isScalar(item.key) && item.key.value === invalidPublicKey,
        )
      : undefined;
    throw new VaultError(
      "FRONTMATTER_PUBLIC_KEY_INVALID",
      "Use the exact public frontmatter key for publication settings",
      yamlSourceRange(raw, frontmatterOffset, pair?.key),
    );
  }
  const tree: Root = unified().use(remarkParse).parse(body);
  const slugger = new GithubSlugger();
  const headings: { title: string; id: string }[] = [];
  visit(tree, "heading", (node: Heading) => {
    const title = mdastToString(node);
    headings.push({ title, id: slugger.slug(title) });
  });
  return {
    sourcePath,
    sourceHash: hash(raw),
    raw,
    body,
    frontmatter: parsed.data,
    headings,
    format: extname(sourcePath).toLowerCase() === ".mdx" ? "mdx" : "markdown",
  };
};

export const loadVault = async (config: PublisherConfig): Promise<VaultSnapshot> => {
  const root = resolve(config.vault.root);
  if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
    return {
      documents: [],
      diagnostics: [diagnostic("VAULT_SYMLINK", "Vault root symlinks are forbidden", ".")],
    };
  const discovered = await discover(root, config.vault.include, config.vault.exclude);
  const documents: PrivateDocument[] = [];
  const diagnostics = [...discovered.diagnostics];
  for (const sourcePath of discovered.paths) {
    if (sourcePath.toLowerCase().endsWith(".mdx") && !config.mdx?.enabled) continue;
    const raw = await readFile(resolve(root, sourcePath), "utf8");
    try {
      documents.push(parseSource(raw, sourcePath));
    } catch (error) {
      if (error instanceof VaultError || error instanceof PublisherError)
        diagnostics.push(
          diagnostic(
            error.code,
            error.message,
            sourcePath,
            error instanceof VaultError ? error.sourceRange : undefined,
          ),
        );
      else if (error instanceof Error)
        diagnostics.push(
          diagnostic("VAULT_READ_FAILED", "Markdown could not be parsed safely", sourcePath),
        );
      else throw error;
    }
  }
  const idOwners = new Map<string, PrivateDocument[]>();
  for (const document of documents) {
    const privateId = document.frontmatter.id;
    if (!privateId) continue;
    const owners = idOwners.get(privateId) ?? [];
    owners.push(document);
    idOwners.set(privateId, owners);
  }
  for (const owners of idOwners.values()) {
    if (owners.length < 2) continue;
    for (const owner of owners) {
      diagnostics.push(
        diagnostic("PRIVATE_ID_COLLISION", "Private source ID is duplicated", owner.sourcePath),
      );
    }
  }
  return { documents, diagnostics };
};

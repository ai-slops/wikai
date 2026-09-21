import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import GithubSlugger from "github-slugger";
import type { Heading, Root } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import { minimatch } from "minimatch";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { parseDocument } from "yaml";
import { hash } from "../fs/index.ts";
import {
  type Diagnostic,
  FrontmatterSchema,
  type PrivateDocument,
  type PublisherConfig,
  type VaultSnapshot,
} from "../model/index.ts";

type ParsedSource = { readonly frontmatterText: string; readonly body: string };
const PUBLIC_KEY_VARIANTS = new Set([
  "publish",
  "published",
  "publication",
  "ispublic",
  "is-public",
]);

class VaultError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

const diagnostic = (code: string, message: string, sourcePath: string): Diagnostic => ({
  code,
  severity: "error",
  message,
  sourcePath,
});

const splitFrontmatter = (raw: string): ParsedSource => {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return { frontmatterText: "{}", body: raw };
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing < 0)
    throw new VaultError("FRONTMATTER_UNTERMINATED", "Markdown frontmatter is not closed");
  return {
    frontmatterText: lines.slice(1, closing).join("\n"),
    body: lines.slice(closing + 1).join("\n"),
  };
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
  const { frontmatterText, body } = splitFrontmatter(raw);
  const yaml = parseDocument(frontmatterText, { uniqueKeys: true });
  if (yaml.errors.length > 0)
    throw new VaultError("FRONTMATTER_INVALID", "Markdown frontmatter is invalid");
  const parsed = FrontmatterSchema.safeParse(yaml.toJS());
  if (!parsed.success)
    throw new VaultError("FRONTMATTER_INVALID", "Markdown frontmatter is invalid");
  if (
    Object.keys(parsed.data).some((key) => PUBLIC_KEY_VARIANTS.has(key.toLocaleLowerCase("en-US")))
  )
    throw new VaultError(
      "FRONTMATTER_PUBLIC_KEY_INVALID",
      "Use the exact public frontmatter key for publication settings",
    );
  const tree: Root = unified().use(remarkParse).parse(body);
  const slugger = new GithubSlugger();
  const headings: { title: string; id: string }[] = [];
  visit(tree, "heading", (node: Heading) => {
    const title = mdastToString(node);
    headings.push({ title, id: slugger.slug(title) });
  });
  return { sourcePath, sourceHash: hash(raw), raw, body, frontmatter: parsed.data, headings };
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
    const raw = await readFile(resolve(root, sourcePath), "utf8");
    try {
      documents.push(parseSource(raw, sourcePath));
    } catch (error) {
      if (error instanceof VaultError)
        diagnostics.push(diagnostic(error.code, error.message, sourcePath));
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

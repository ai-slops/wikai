import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ConfigSchema, type PublisherConfig } from "../model/index.ts";
import { compile, loadVault } from "./index.ts";

let root: string;
let config: PublisherConfig;

const fields: readonly string[] = [
  "id: prv_source",
  "public:",
  "  id: pub_source",
  "  status: review",
  "  mode: mirror",
  "  kind: knowledge",
  "  slug: /knowledge/source",
  "  title: Source",
  "  summary: Source page",
  "  contentState: stable",
  "  knowledge:",
  "    documentType: topic",
];

const source = (body: string): string => `\ufeff---\r\n${fields.join("\r\n")}\r\n---\r\n${body}`;
const bodyLine = fields.length + 3;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-diagnostic-ranges-"));
  await mkdir(join(root, "assets"));
  config = ConfigSchema.parse({
    vault: { root },
    publisher: {
      stateDir: join(root, ".state"),
      previewStagingDir: join(root, ".preview"),
      releaseStagingDir: join(root, ".release"),
      cleanBuild: true,
    },
    site: { sourceDir: join(root, "site"), distDir: join(root, "dist") },
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("reports YAML schema positions in the original BOM and CRLF source", async () => {
  const invalid = [...fields];
  invalid[3] = "  status: wrong";
  await writeFile(join(root, "source.md"), `\ufeff---\r\n${invalid.join("\r\n")}\r\n---\r\nbody`);

  const vault = await loadVault(config);

  expect(vault.diagnostics).toEqual([
    {
      code: "FRONTMATTER_INVALID",
      severity: "error",
      message: "Markdown frontmatter is invalid",
      sourcePath: "source.md",
      sourceRange: { startLine: 5, startColumn: 11, endLine: 5, endColumn: 16 },
    },
  ]);
});

it("reports YAML parser positions in the original source", async () => {
  await writeFile(join(root, "source.md"), "\ufeff---\r\nid: [\r\n---\r\nbody");

  const vault = await loadVault(config);

  expect(vault.diagnostics).toEqual([
    {
      code: "FRONTMATTER_INVALID",
      severity: "error",
      message: "Markdown frontmatter is invalid",
      sourcePath: "source.md",
      sourceRange: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 2 },
    },
  ]);
});

it.each([
  [
    "wiki link substring",
    "prefix [[Missing]] suffix",
    "UNRESOLVED_INTERNAL_LINK",
    { startLine: bodyLine, startColumn: 8, endLine: bodyLine, endColumn: 19 },
  ],
  [
    "Markdown link node",
    "See [target](Missing.md).",
    "UNRESOLVED_INTERNAL_LINK",
    { startLine: bodyLine, startColumn: 5, endLine: bodyLine, endColumn: 25 },
  ],
  [
    "multiline HTML node",
    "<section>\r\nprivate\r\n</section>",
    "MARKDOWN_HTML_FORBIDDEN",
    { startLine: bodyLine, startColumn: 1, endLine: bodyLine + 2, endColumn: 11 },
  ],
  [
    "missing asset syntax",
    "![alt](assets/missing.png)",
    "ASSET_NOT_FOUND",
    { startLine: bodyLine, startColumn: 1, endLine: bodyLine, endColumn: 27 },
  ],
  [
    "embedded wiki asset substring",
    "prefix ![[assets/missing.png|alt]] suffix",
    "ASSET_NOT_FOUND",
    { startLine: bodyLine, startColumn: 8, endLine: bodyLine, endColumn: 35 },
  ],
])("reports the exact original range for a %s", async (_case, body, code, sourceRange) => {
  await writeFile(join(root, "source.md"), source(body));

  const plan = await compile(await loadVault(config), config);

  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({ code, sourcePath: "source.md", publicId: "pub_source", sourceRange }),
  );
});

it("does not invent a range for a missing metadata field", async () => {
  await writeFile(
    join(root, "source.md"),
    source("body").replace("  slug: /knowledge/source\r\n", ""),
  );

  const plan = await compile(await loadVault(config), config);
  const diagnostic = plan.diagnostics.find(({ code }) => code === "PUBLIC_SLUG_REQUIRED");

  expect(diagnostic).toBeDefined();
  expect(diagnostic).not.toHaveProperty("sourceRange");
});

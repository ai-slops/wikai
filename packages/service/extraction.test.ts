import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { hash } from "../fs/index.ts";
import { FrontmatterSchema } from "../model/index.ts";
import { Publisher } from "./index.ts";
import type { ExtractInput } from "./schema.ts";
import { splitSource } from "./source.ts";
import { createServiceFixture } from "./test-fixture.ts";

let root: string;
let vault: string;
let publisher: Publisher;

beforeEach(async () => {
  const fixture = await createServiceFixture();
  ({ root, vault } = fixture);
  publisher = await Publisher.open(fixture.configPath);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function extract(body: string, selector: Pick<ExtractInput, "heading" | "block" | "lines">) {
  await writeFile(join(vault, "source.md"), `---\nid: prv_source\n---\n${body}`);
  return publisher.extract({
    path: "source.md",
    to: "public-views/excerpt.md",
    kind: "log",
    ...selector,
  });
}

describe("AST-aware extraction", () => {
  it.each([
    {
      body: "Public text. ^",
      selector: { block: "^" },
      code: "EXTRACT_BLOCK_INVALID",
    },
    {
      body: "```md\n## Share\nFake.\n```",
      selector: { heading: "Share" },
      code: "EXTRACT_HEADING_NOT_FOUND",
    },
    {
      body: "<div>\n## Share\nFake.\n</div>",
      selector: { heading: "Share" },
      code: "EXTRACT_HEADING_NOT_FOUND",
    },
    {
      body: "```md\nFake. ^share\n```",
      selector: { block: "share" },
      code: "EXTRACT_BLOCK_NOT_FOUND",
    },
    { body: "`Fake. ^share`", selector: { block: "share" }, code: "EXTRACT_BLOCK_NOT_FOUND" },
    {
      body: "<div>\nFake. ^share\n</div>",
      selector: { block: "share" },
      code: "EXTRACT_BLOCK_NOT_FOUND",
    },
    { body: "Escaped. \\^share", selector: { block: "share" }, code: "EXTRACT_BLOCK_NOT_FOUND" },
    {
      body: "## Share\nOne.\n\n## Share\nTwo.",
      selector: { heading: "Share" },
      code: "EXTRACT_HEADING_AMBIGUOUS",
    },
    {
      body: "One. ^share\n\nTwo. ^share",
      selector: { block: "share" },
      code: "EXTRACT_BLOCK_AMBIGUOUS",
    },
  ])("rejects $code for $body", async ({ body, selector, code }) => {
    // Given syntax that is absent, literal, or ambiguous rather than a unique selection.
    // When extracting it, then no projection is created.
    await expect(extract(body, selector)).rejects.toMatchObject({ code });
    await expect(readFile(join(vault, "public-views/excerpt.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("selects a setext heading including nested sections without stopping at fenced headings", async () => {
    const fragment = "Share\n-----\n\nPublic.\n\n```md\n## Fake boundary\n```\n\n### Child\nMore.";
    await extract(`PRIVATE BEFORE\n\n${fragment}\n\n## Private\nPRIVATE AFTER`, {
      heading: "Share",
    });

    const projection = splitSource(await readFile(join(vault, "public-views/excerpt.md"), "utf8"));

    expect(projection.body.trimEnd()).toBe(fragment);
    expect(FrontmatterSchema.parse(parse(projection.frontmatter)).public?.sources).toMatchObject([
      {
        anchor: "heading:Share",
        capturedHash: hash(fragment),
        selection: { version: 1, kind: "heading", value: "Share" },
      },
    ]);
  });

  it("matches formatted heading labels while retaining case-insensitive CLI selection", async () => {
    await extract("## **Share**\nPublic.\n\n## Private\nSecret.", { heading: "share" });
    const projection = splitSource(await readFile(join(vault, "public-views/excerpt.md"), "utf8"));
    expect(projection.body.trimEnd()).toBe("## **Share**\nPublic.");
  });

  it.each([
    {
      body: "PRIVATE BEFORE\n\nPublic first.\nPublic second. ^share\n\nPRIVATE AFTER",
      expected: "Public first.\nPublic second.",
    },
    {
      body: "PRIVATE BEFORE\n\n- Public one\n- Public two\n\n^share\n\nPRIVATE AFTER",
      expected: "- Public one\n- Public two",
    },
  ])(
    "selects one marked block without copying neighboring prose: $expected",
    async ({ body, expected }) => {
      await extract(body, { block: "^share" });
      const projection = splitSource(
        await readFile(join(vault, "public-views/excerpt.md"), "utf8"),
      );
      expect(projection.body.trimEnd()).toBe(expected);
      expect(FrontmatterSchema.parse(parse(projection.frontmatter)).public?.sources).toMatchObject([
        { capturedHash: hash(expected), selection: { version: 1, kind: "block", value: "share" } },
      ]);
    },
  );
});

describe("line snapshot extraction", () => {
  it.each(["0:1", "3:2", "1:99", "9007199254740993:9007199254740994"])(
    "rejects invalid or out-of-bounds range %s",
    async (lines) => {
      await expect(extract("One.\nTwo.\n", { lines })).rejects.toMatchObject({
        code: "EXTRACT_LINES_INVALID",
      });
    },
  );

  it("rejects empty selected content", async () => {
    await expect(extract("One.\n\nTwo.", { lines: "2:2" })).rejects.toMatchObject({
      code: "EXTRACT_LINES_EMPTY",
    });
  });

  it("rejects an immediately ambiguous content snapshot", async () => {
    await expect(extract("Same.\nOther.\nSame.", { lines: "1:1" })).rejects.toMatchObject({
      code: "EXTRACT_LINES_AMBIGUOUS",
    });
  });

  it("captures an inclusive body-relative CRLF range and preserves leading indentation", async () => {
    await extract("PRIVATE\r\n    code one\r\n    code two\r\nPRIVATE AFTER", {
      lines: { start: 2, end: 3 },
    });
    const projection = splitSource(await readFile(join(vault, "public-views/excerpt.md"), "utf8"));
    expect(projection.body.trimEnd()).toBe("    code one\n    code two");
    expect(FrontmatterSchema.parse(parse(projection.frontmatter)).public?.sources).toMatchObject([
      {
        anchor: "lines:2:3",
        capturedHash: hash("    code one\n    code two"),
        selection: { version: 1, kind: "lines", lineCount: 2 },
      },
    ]);
  });
});

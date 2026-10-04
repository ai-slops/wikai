import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import { loadVault } from "../vault/index.ts";
import { Publisher } from "./index.ts";
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

it("preserves BOM, CRLF, YAML comments and body bytes across candidate and approval", async () => {
  const path = join(vault, "note.md");
  const body = "# Example\r\n\r\nBody.  \r\n";
  const raw = `\ufeff---\r\n# keep comment\r\ntitle: 'Example'\r\n---\r\n${body}`;
  await writeFile(path, raw);
  const created = await publisher.candidate({
    path: "note.md",
    kind: "page",
    mode: "mirror",
    expectedHash: hash(raw),
  });
  const candidate = await readFile(path, "utf8");
  expect(candidate.startsWith("\ufeff---\r\n")).toBe(true);
  expect(candidate).toContain("# keep comment\r\ntitle: 'Example'");
  expect(candidate.endsWith(body)).toBe(true);
  const working = (await publisher.detail(created.publicId)).working;
  if (working === null) throw new TypeError("Missing working publication");
  await publisher.approve(created.publicId, working.exposureHash);
  const approved = await readFile(path, "utf8");
  expect(approved.startsWith("\ufeff---\r\n")).toBe(true);
  expect(approved.endsWith(body)).toBe(true);
  expect(approved.replaceAll("\r\n", "")).not.toContain("\n");
});

it("does not add a final newline to an existing body during metadata updates", async () => {
  const path = join(vault, "note.md");
  await writeFile(path, "# Example without final newline");
  const created = await publisher.candidate({ path: "note.md", kind: "page", mode: "mirror" });
  await publisher.updateMetadata(created.publicId, { title: "Reviewed title" }, created.sourceHash);
  expect((await readFile(path, "utf8")).endsWith("# Example without final newline")).toBe(true);
});

it.each([
  " ---\nprivateTag: hidden\n---\nBody",
  "--- \nprivateTag: hidden\n---\nBody",
  "---\nprivateTag: hidden\n--- \nBody",
])("rejects noncanonical delimiters consistently before any authoring mutation", async (raw) => {
  const path = join(vault, "note.md");
  await writeFile(path, raw);
  expect((await loadVault(publisher.config)).diagnostics).toContainEqual(
    expect.objectContaining({ code: "FRONTMATTER_DELIMITER_INVALID" }),
  );
  await expect(
    publisher.candidate({ path: "note.md", kind: "page", mode: "mirror" }),
  ).rejects.toMatchObject({ code: "FRONTMATTER_DELIMITER_INVALID" });
  expect(await readFile(path, "utf8")).toBe(raw);
});

it("keeps an indented thematic marker inside a YAML block scalar out of the Markdown body", async () => {
  await writeFile(
    join(vault, "note.md"),
    "---\ntitle: Note\nprivateNote: |\n  PRIVATE\n  ---\n  STILL PRIVATE\n---\nPublic body.",
  );
  const snapshot = await loadVault(publisher.config);
  expect(snapshot.diagnostics).toEqual([]);
  expect(snapshot.documents[0]?.body).toBe("Public body.");
});

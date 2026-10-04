import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigSchema, type PublisherConfig } from "../model/index.ts";
import { compile, loadVault } from "./index.ts";

let root: string;
let config: PublisherConfig;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-acceptance-"));
  config = ConfigSchema.parse({
    vault: { root },
    publisher: {
      stateDir: join(root, ".state"),
      previewStagingDir: join(root, ".preview"),
      releaseStagingDir: join(root, ".release"),
    },
    site: { sourceDir: join(root, "site"), distDir: join(root, "dist") },
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const note = (publicFields: string, body = "Public body."): string =>
  `---\nid: prv_validation\npublic:\n  id: pub_validation\n  status: review\n  mode: mirror\n${publicFields}\n---\n${body}\n`;

describe("mandatory authoring acceptance", () => {
  it.each([
    [
      "work summary",
      "  kind: work\n  slug: /work/example\n  title: Example\n  work:\n    role: Engineer\n    projectStatus: active",
    ],
    [
      "work role",
      "  kind: work\n  slug: /work/example\n  title: Example\n  summary: Summary\n  work:\n    projectStatus: active",
    ],
    [
      "knowledge content state",
      "  kind: knowledge\n  slug: /knowledge/example\n  title: Example\n  summary: Summary\n  knowledge:\n    documentType: topic",
    ],
  ])("blocks a publication missing required %s", async (_case, fields) => {
    // Given authored public metadata missing one field required by section 36.
    await writeFile(join(root, "note.md"), note(fields));

    // When compiled, then it remains editable but cannot become a working publication.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PUBLIC_METADATA_REQUIRED", publicId: "pub_validation" }),
    );
  });

  it("materializes a fallback route while diagnosing a missing explicit slug", async () => {
    // Given otherwise complete page metadata without its approval-required explicit slug.
    await writeFile(
      join(root, "note.md"),
      note("  kind: page\n  title: Example\n  page:\n    layout: generic"),
    );

    // When compiled, then preview remains available and the acceptance gap stays visible.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications[0]?.metadata.slug).toBe("/example");
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PUBLIC_SLUG_REQUIRED", publicId: "pub_validation" }),
    );
  });

  it.each([
    [
      "work",
      "  kind: work\n  slug: /work/example\n  title: Example\n  summary: Summary\n  work:\n    role: Engineer\n    projectStatus: active",
    ],
    ["log", "  kind: log\n  slug: /log/example\n  log:\n    occurredAt: 2026-01-01T12:00:00Z"],
  ])("blocks an empty %s body", async (_case, fields) => {
    // Given a kind whose contract requires body content.
    await writeFile(join(root, "note.md"), note(fields, "   \n"));

    // When compiled, then empty public content is blocked.
    const plan = await compile(await loadVault(config), config);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PUBLIC_BODY_REQUIRED" }),
    );
  });

  it("accepts a log without an authored title", async () => {
    // Given section-36-complete Log metadata without its optional title.
    await writeFile(
      join(root, "note.md"),
      note("  kind: log\n  slug: /log/example\n  log:\n    occurredAt: 2026-01-01T12:00:00Z"),
    );

    // When compiled, then a stable fallback title satisfies the public metadata contract.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications[0]?.metadata.title).toBe("2026-01-01T12:00:00Z");
  });
});

describe("pre-release route acceptance", () => {
  it.each([
    [
      "renderer-owned route",
      "  kind: page\n  slug: /search\n  title: Search\n  page:\n    layout: generic",
      "PUBLIC_ROUTE_RESERVED",
    ],
    [
      "wrong kind prefix",
      "  kind: knowledge\n  slug: /work/wrong\n  title: Wrong\n  summary: Summary\n  contentState: stable\n  knowledge:\n    documentType: topic",
      "PUBLIC_ROUTE_KIND_MISMATCH",
    ],
    [
      "fixed layout mismatch",
      "  kind: page\n  slug: /company\n  title: About\n  page:\n    layout: about",
      "PUBLIC_ROUTE_KIND_MISMATCH",
    ],
    [
      "reserved alias",
      "  kind: page\n  slug: /company\n  aliases: [/search]\n  title: Company\n  page:\n    layout: generic",
      "PUBLIC_ROUTE_RESERVED",
    ],
  ])("blocks a %s", async (_case, fields, code) => {
    // Given an authored route that the renderer cannot safely own.
    await writeFile(join(root, "note.md"), note(fields));

    // When compiled, then route rejection happens before approval.
    const plan = await compile(await loadVault(config), config);
    expect(plan.publications).toEqual([]);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code }));
  });
});

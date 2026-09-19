import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { Publisher } from "../packages/service/index.ts";

let root: string;
let publisher: Publisher;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-authoring-"));
  await mkdir(join(root, "vault"));
  const configPath = join(root, "config.yaml");
  await writeFile(
    configPath,
    stringify({
      vault: { root: "vault" },
      publisher: {
        stateDir: "vault/.publisher",
        previewStagingDir: "preview",
        releaseStagingDir: "release",
      },
      site: { sourceDir: "site", distDir: "dist" },
    }),
  );
  publisher = await Publisher.open(configPath);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each([
  { name: "heading", selector: { heading: "Share" } },
  { name: "block", selector: { block: "share" } },
  { name: "lines", selector: { lines: "5:5" } },
])("extracts only the selected $name from an ordinary private note", async ({ selector }) => {
  await writeFile(
    join(root, "vault", "daily.md"),
    "# Journal\nPRIVATE_SENTINEL_BEFORE\n\n## Share\nPublic paragraph ^share\n\n## Personal\nPRIVATE_SENTINEL_AFTER\n",
  );
  const result = await publisher.extract({
    path: "daily.md",
    to: "public-views/share.md",
    kind: "log",
    ...selector,
  });
  const projection = await readFile(join(root, "vault", "public-views/share.md"), "utf8");
  expect(projection).toContain("Public paragraph");
  expect(projection).not.toContain("PRIVATE_SENTINEL");
  expect(result.publicId).toMatch(/^pub_/);
  expect(await readFile(join(root, "vault", "daily.md"), "utf8")).toContain("prv_");
});

it("creates an empty projection template without copying private source prose", async () => {
  await writeFile(
    join(root, "vault", "source.md"),
    "---\nid: prv_original\n---\n# Private source\n\nPRIVATE_SENTINEL_BODY\n",
  );
  await publisher.project({ path: "source.md", to: "public-views/project.md", kind: "work" });
  const projection = await readFile(join(root, "vault", "public-views/project.md"), "utf8");
  expect(projection).not.toContain("PRIVATE_SENTINEL");
  expect(projection).not.toContain("# Private source");
  expect(projection).toContain("prv_original");
});

it("keeps a blocked candidate visible in the review queue", async () => {
  await writeFile(join(root, "vault", "secret.md"), "---\nid: prv_secret\n---\nPrivate\n");
  await writeFile(
    join(root, "vault", "candidate.md"),
    "---\nid: prv_candidate\ntitle: Blocked\npublic:\n  id: pub_candidate\n  status: review\n  mode: mirror\n  kind: page\n  slug: /blocked\n  page:\n    layout: generic\n---\n[[prv_secret]]\n",
  );
  expect((await publisher.status()).publications).toContainEqual(
    expect.objectContaining({ publicId: "pub_candidate", status: "blocked" }),
  );
  expect((await publisher.detail("pub_candidate")).diagnostics).toContainEqual(
    expect.objectContaining({ code: "PRIVATE_TARGET_LINK" }),
  );
});

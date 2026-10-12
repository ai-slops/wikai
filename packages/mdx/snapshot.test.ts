import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigSchema } from "../model/index.ts";
import { createMdxInput, snapshotPublicDependencies } from "./snapshot.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wikai-mdx-snapshot-"));
  roots.push(root);
  await mkdir(join(root, "public-components"));
  await mkdir(join(root, "public-data"));
  await writeFile(join(root, "public-components", "Counter.tsx"), "export const value = 1;\n");
  await writeFile(join(root, "public-data", "label.json"), '{"label":"Count"}\n');
  const config = ConfigSchema.parse({
    vault: { root },
    publisher: {
      stateDir: join(root, ".state"),
      previewStagingDir: join(root, ".preview"),
      releaseStagingDir: join(root, ".release"),
    },
    mdx: { enabled: true },
    site: { sourceDir: join(root, "site"), distDir: join(root, "dist") },
  });
  return { root, config };
}

describe("MDX immutable inputs", () => {
  it("keeps the authored content hash independent from the shared profile", async () => {
    // Given one authored MDX body and an initial public dependency snapshot.
    const { root, config } = await fixture();
    const body = "import { Counter } from './public-components/Counter.tsx'\n\n<Counter />\n";
    const before = createMdxInput({
      body,
      sourcePath: "counter.mdx",
      snapshot: await snapshotPublicDependencies(config),
      image: "wikai-mdx:local",
      imageId: `sha256:${"1".repeat(64)}`,
      componentRoots: config.mdx?.componentRoots ?? [],
      dataRoots: config.mdx?.dataRoots ?? [],
    });

    // When a shared component changes without changing the authored document.
    await writeFile(join(root, "public-components", "Counter.tsx"), "export const value = 2;\n");
    const after = createMdxInput({
      body,
      sourcePath: "counter.mdx",
      snapshot: await snapshotPublicDependencies(config),
      image: "wikai-mdx:local",
      imageId: `sha256:${"1".repeat(64)}`,
      componentRoots: config.mdx?.componentRoots ?? [],
      dataRoots: config.mdx?.dataRoots ?? [],
    });

    // Then selective batching can distinguish content stability from profile staleness.
    expect(after.contentInputHash).toBe(before.contentInputHash);
    expect(after.profileDigest).not.toBe(before.profileDigest);
  });

  it("binds the normalized entry path to authored content identity", async () => {
    // Given identical MDX bytes compiled from two distinct entry locations.
    const { config } = await fixture();
    const snapshot = await snapshotPublicDependencies(config);
    const identity = {
      body: "import './Counter.tsx'\n",
      snapshot,
      image: "wikai-mdx:local",
      imageId: `sha256:${"2".repeat(64)}`,
      componentRoots: config.mdx?.componentRoots ?? [],
      dataRoots: config.mdx?.dataRoots ?? [],
    };

    // When canonical-equivalent and moved source paths are hashed.
    const original = createMdxInput({ ...identity, sourcePath: "notes/counter.mdx" });
    const equivalent = createMdxInput({ ...identity, sourcePath: "notes/./counter.mdx" });
    const moved = createMdxInput({ ...identity, sourcePath: "archive/counter.mdx" });

    // Then only a real move changes compile identity.
    expect(equivalent.contentInputHash).toBe(original.contentInputHash);
    expect(moved.contentInputHash).not.toBe(original.contentInputHash);
  });

  it("binds ordered public roots and the resolved image ID to the profile", async () => {
    // Given stable dependency bytes and configured image label.
    const { config } = await fixture();
    const snapshot = await snapshotPublicDependencies(config);
    const identity = {
      body: "# Counter\n",
      sourcePath: "counter.mdx",
      snapshot,
      image: "wikai-mdx:local",
      dataRoots: ["public-data"],
    };

    // When root precedence or the resolved image changes.
    const original = createMdxInput({
      ...identity,
      componentRoots: ["first", "second"],
      imageId: `sha256:${"3".repeat(64)}`,
    });
    const reordered = createMdxInput({
      ...identity,
      componentRoots: ["second", "first"],
      imageId: `sha256:${"3".repeat(64)}`,
    });
    const rebuilt = createMdxInput({
      ...identity,
      componentRoots: ["first", "second"],
      imageId: `sha256:${"4".repeat(64)}`,
    });
    const dataReordered = createMdxInput({
      ...identity,
      componentRoots: ["first", "second"],
      dataRoots: ["second-data", "first-data"],
      imageId: `sha256:${"3".repeat(64)}`,
    });

    // Then both changes invalidate the shared profile.
    expect(reordered.profileDigest).not.toBe(original.profileDigest);
    expect(rebuilt.profileDigest).not.toBe(original.profileDigest);
    expect(dataReordered.profileDigest).not.toBe(original.profileDigest);
  });

  it("captures complete dependency bytes under logical vault-relative paths", async () => {
    // Given configured public component and data roots.
    const { config } = await fixture();

    // When the shared dependency profile is captured.
    const snapshot = await snapshotPublicDependencies(config);

    // Then every dependency has immutable bytes without an absolute host path.
    expect(snapshot.files.map((file) => file.path)).toEqual([
      "public-components/Counter.tsx",
      "public-data/label.json",
    ]);
    expect(Buffer.from(snapshot.files[0]?.data ?? "", "base64").toString("utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(JSON.stringify(snapshot)).not.toContain(config.vault.root);
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ConfigSchema } from "../model/index.ts";
import { loadVault } from "./index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const source = `---
id: prv_counter
public:
  id: pub_counter
  status: review
  mode: mirror
  kind: knowledge
  slug: /knowledge/counter
  title: Counter
  summary: Interactive counter
  contentState: stable
  knowledge:
    documentType: topic
---
# Count {1 + 1}
`;

async function config(enabled: boolean) {
  const root = await mkdtemp(join(tmpdir(), "wikai-vault-mdx-"));
  roots.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "counter.mdx"), source);
  return ConfigSchema.parse({
    vault: { root },
    publisher: {
      stateDir: join(root, ".state"),
      previewStagingDir: join(root, ".preview"),
      releaseStagingDir: join(root, ".release"),
    },
    mdx: { enabled },
    site: { sourceDir: join(root, "site"), distDir: join(root, "dist") },
  });
}

it("discovers MDX only when the runtime is explicitly enabled", async () => {
  // Given identical vaults with disabled and enabled MDX configuration.
  const disabled = await config(false);
  const enabled = await config(true);

  // When both vaults are loaded.
  const [privateSnapshot, publicSnapshot] = await Promise.all([
    loadVault(disabled),
    loadVault(enabled),
  ]);

  // Then only the opted-in vault exposes an MDX document and its inferred format.
  expect(privateSnapshot.documents).toEqual([]);
  expect(publicSnapshot.documents).toHaveLength(1);
  expect(publicSnapshot.documents[0]?.format).toBe("mdx");
});

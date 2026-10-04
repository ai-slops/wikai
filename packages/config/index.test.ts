import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { loadConfig } from "./index.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-config-"));
  await mkdir(join(root, "vault"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("resolves relative paths against the configuration location", async () => {
  const path = join(root, "config.yaml");
  await writeFile(
    path,
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
  const config = await loadConfig(path);
  expect(config.vault.root).toBe(join(root, "vault"));
  expect(config.defaults.log.index).toBe(false);
});

it("resolves relative deployment roots against the configuration location", async () => {
  // Given a named deployment with a relative destination.
  const path = join(root, "config.yaml");
  await writeFile(
    path,
    stringify({
      vault: { root: "vault" },
      publisher: {
        stateDir: "vault/.publisher",
        previewStagingDir: "preview",
        releaseStagingDir: "release",
      },
      deployments: { production: { type: "directory", root: "deployed" } },
      site: { sourceDir: "site", distDir: "dist" },
    }),
  );

  // When loaded, then deployment paths use the config directory rather than process cwd.
  const config = await loadConfig(path);
  expect(Object.values(config.deployments ?? {})[0]?.root).toBe(join(root, "deployed"));
});

it("rejects a public output nested inside the vault", async () => {
  const path = join(root, "config.yaml");
  await writeFile(
    path,
    stringify({
      vault: { root: "vault" },
      publisher: {
        stateDir: "vault/.publisher",
        previewStagingDir: "preview",
        releaseStagingDir: "vault/export",
      },
      site: { sourceDir: "site", distDir: "dist" },
    }),
  );
  await expect(loadConfig(path)).rejects.toMatchObject({ code: "UNSAFE_OUTPUT_PATH" });
});

it("rejects a symlink alias of the vault used as a public output", async () => {
  await symlink(join(root, "vault"), join(root, "output"));
  const path = join(root, "config.yaml");
  await writeFile(
    path,
    stringify({
      vault: { root: "vault" },
      publisher: {
        stateDir: "vault/.publisher",
        previewStagingDir: "preview",
        releaseStagingDir: "output",
      },
      site: { sourceDir: "site", distDir: "dist" },
    }),
  );
  await expect(loadConfig(path)).rejects.toMatchObject({ code: "ASSET_SYMLINK" });
});

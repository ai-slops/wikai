import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { safePath } from "../fs/index.ts";
import { ConfigSchema, type PublisherConfig, PublisherError } from "../model/index.ts";

function overlaps(a: string, b: string): boolean {
  const inside = (parent: string, child: string) => {
    const delta = relative(parent, child);
    return delta === "" || (delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta));
  };
  return inside(a, b) || inside(b, a);
}

export async function loadConfig(
  path = process.env["WIKAI_CONFIG"] ?? ".local/publisher.config.yaml",
): Promise<PublisherConfig> {
  const fullPath = resolve(path);
  const document = parseDocument(await readFile(fullPath, "utf8"), { uniqueKeys: true });
  if (document.errors.length)
    throw new PublisherError("INVALID_CONFIG", "Configuration YAML is invalid.");
  const result = ConfigSchema.safeParse(document.toJS({ maxAliasCount: 20 }));
  if (!result.success)
    throw new PublisherError(
      "INVALID_CONFIG",
      "Configuration does not match the publisher schema.",
    );
  const base = dirname(fullPath);
  const input = result.data;
  const config: PublisherConfig = {
    ...input,
    vault: { ...input.vault, root: resolve(base, input.vault.root) },
    publisher: {
      ...input.publisher,
      stateDir: resolve(base, input.publisher.stateDir),
      previewStagingDir: resolve(base, input.publisher.previewStagingDir),
      releaseStagingDir: resolve(base, input.publisher.releaseStagingDir),
    },
    site: {
      ...input.site,
      sourceDir: resolve(base, input.site.sourceDir),
      distDir: resolve(base, input.site.distDir),
    },
  };
  await safePath(config.vault.root, ".");
  for (const path of [
    config.publisher.stateDir,
    config.publisher.previewStagingDir,
    config.publisher.releaseStagingDir,
    config.site.sourceDir,
    config.site.distDir,
  ]) {
    await safePath(parse(path).root, path);
  }
  for (const root of [...config.assets.roots, ...config.publicViews.roots]) {
    if (isAbsolute(root))
      throw new PublisherError(
        "INVALID_CONFIG",
        "Vault-relative roots must not be absolute paths.",
      );
    await safePath(config.vault.root, root);
  }
  if (
    overlaps(config.vault.root, config.site.sourceDir) ||
    overlaps(config.publisher.stateDir, config.site.sourceDir)
  ) {
    throw new PublisherError(
      "UNSAFE_SOURCE_PATH",
      "Private vault and state must be separate from the public site source.",
    );
  }
  const outputs = [
    config.publisher.previewStagingDir,
    config.publisher.releaseStagingDir,
    config.site.distDir,
  ];
  const protectedRoots = [config.vault.root, config.publisher.stateDir, config.site.sourceDir];
  for (const [index, output] of outputs.entries()) {
    if (
      protectedRoots.some((root) => overlaps(output, root)) ||
      outputs.slice(index + 1).some((root) => overlaps(output, root))
    ) {
      throw new PublisherError(
        "UNSAFE_OUTPUT_PATH",
        "Build outputs must be separate from the vault, state, site source and each other.",
      );
    }
  }
  for (const pattern of config.security.denyPatterns) {
    try {
      new RegExp(pattern, "u");
    } catch {
      throw new PublisherError(
        "INVALID_CONFIG",
        "A deny pattern is not a valid regular expression.",
      );
    }
  }
  return config;
}

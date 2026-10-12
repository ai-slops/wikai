import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "../fs/index.ts";
import type { PublisherConfig, WorkingPublication } from "../model/index.ts";
import { redirectsPolicyHash, releasePolicyHash } from "../release/receipt.ts";
import { workingPublication } from "../state/test-fixture.ts";
import { fingerprintDirectory } from "./filesystem.ts";
import type { DeploymentConfig } from "./index.ts";

const FIXED_FILES = [
  "index.html",
  "about/index.html",
  "now/index.html",
  "contact/index.html",
  "search/index.html",
  "work/index.html",
  "knowledge/index.html",
  "log/index.html",
  "feed.xml",
  "work.xml",
  "knowledge.xml",
  "log.xml",
  "feeds/all.xml",
  "feeds/work.xml",
  "feeds/knowledge.xml",
  "feeds/log.xml",
  "sitemap-0.xml",
  "sitemap-index.xml",
  "robots.txt",
] as const;

export type DeploymentFixture = {
  readonly root: string;
  readonly config: PublisherConfig;
  readonly deployments: DeploymentConfig;
  readonly destination: string;
  readonly cleanup: () => Promise<void>;
};

export function deploymentPublication(
  overrides: Partial<WorkingPublication> = {},
): WorkingPublication {
  const working = workingPublication(overrides);
  return { ...working, metadata: { ...working.metadata, aliases: [] } };
}

export async function writeAuditedDist(config: PublisherConfig, content: string): Promise<void> {
  for (const relativePath of FIXED_FILES) {
    const path = join(config.site.distDir, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
  await writeFile(
    join(config.site.distDir, "publication-manifest.json"),
    JSON.stringify({ schemaVersion: 1, pages: [] }),
  );
  await writeFile(
    join(config.site.distDir, "redirects.json"),
    JSON.stringify({ schemaVersion: 1, redirects: [] }),
  );
}

export async function writeReleaseReceipt(
  config: PublisherConfig,
  revisions: Readonly<Record<string, string>>,
): Promise<void> {
  await mkdir(config.publisher.stateDir, { recursive: true });
  await writeFile(
    join(config.publisher.stateDir, "release-receipt.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      revisions,
      redirectsHash: redirectsPolicyHash([]),
      stagingPolicyHash: await releasePolicyHash(config.publisher.releaseStagingDir),
      distFingerprintHash: hash(JSON.stringify(await fingerprintDirectory(config.site.distDir))),
    })}\n`,
  );
}

export async function createDeploymentFixture(): Promise<DeploymentFixture> {
  const root = await mkdtemp(join(tmpdir(), "wikai-deploy-"));
  const config: PublisherConfig = {
    schemaVersion: 1,
    vault: { root: join(root, "vault"), include: ["**/*.md"], exclude: [] },
    publisher: {
      stateDir: join(root, "state"),
      previewStagingDir: join(root, "preview"),
      releaseStagingDir: join(root, "staging"),
      cleanBuild: true,
    },
    publicViews: { roots: [] },
    assets: {
      roots: [],
      maxFileBytes: 1024,
      rejectSymlinks: true,
      stripImageMetadata: true,
      reviewedHashes: [],
    },
    security: {
      denyPatterns: ["PRIVATE_SENTINEL_[A-Z0-9_]+"],
      scanPrivateIdsInDist: true,
      scanPrivatePathsInDist: true,
    },
    site: {
      sourceDir: join(root, "site"),
      distDir: join(root, "dist"),
      url: "https://example.test",
      isolatedBuild: true,
      network: "disabled",
      image: "wikai-site:test",
    },
    defaults: {
      work: { listed: true, index: true, feed: true },
      knowledge: { listed: true, index: true, feed: true },
      log: { listed: true, index: false, feed: true },
      page: { listed: false, index: true, feed: false },
    },
  };
  const destination = join(root, "deployed");
  const deployments = { production: { type: "directory", root: destination } } as const;
  await mkdir(config.publisher.releaseStagingDir, { recursive: true });
  for (const [name, policy] of [
    ["publication-manifest.json", { schemaVersion: 1, pages: [] }],
    ["redirects.json", { schemaVersion: 1, redirects: [] }],
    ["content-index.json", { schemaVersion: 1, pages: [] }],
  ] as const) {
    await writeFile(join(config.publisher.releaseStagingDir, name), JSON.stringify(policy));
  }
  await mkdir(config.site.distDir, { recursive: true });
  await writeAuditedDist(config, "first");
  await writeReleaseReceipt(config, {});
  return {
    root,
    config,
    deployments,
    destination,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

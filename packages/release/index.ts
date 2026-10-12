import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWrite, hash, replaceDirectory, safePath } from "../fs/index.ts";
import type {
  ApprovedRevision,
  MaterializedAsset,
  PublicLink,
  PublisherConfig,
  ReleaseManifest,
} from "../model/index.ts";
import { resolveRendererProfile } from "../renderer/index.ts";
import { ReleaseError } from "./error.ts";
import {
  redirectsPolicyHash,
  releasePolicyHash,
  revisionsForRelease,
  writeReleaseIdentity,
} from "./receipt.ts";
import { createRendererInput } from "./renderer-input.ts";
import { validateReleaseGraph } from "./routes.ts";

export { buildSite, createExportSpec, createSandboxSpec, type SandboxSpec } from "./site-build.ts";

type StagedAsset = Readonly<
  Pick<MaterializedAsset, "publicPath" | "hash" | "mime" | "bytes" | "reviewed">
>;
type StagedPage = Readonly<{
  metadata: ApprovedRevision["metadata"];
  markdown: string;
  html: string;
  outgoingLinks: readonly PublicLink[];
  backlinks: readonly PublicLink[];
  assets: readonly StagedAsset[];
}>;
type ContentIndex = Readonly<{ schemaVersion: 1; pages: readonly StagedPage[] }>;
const publicLink = (revision: ApprovedRevision): PublicLink => ({
  publicId: revision.publicId,
  slug: revision.metadata.slug,
  title: revision.metadata.title,
});

const stagedAsset = (asset: MaterializedAsset): StagedAsset => ({
  publicPath: asset.publicPath,
  hash: asset.hash,
  mime: asset.mime,
  bytes: asset.bytes,
  reviewed: asset.reviewed,
});

const backlinksFor = (
  target: ApprovedRevision,
  approved: readonly ApprovedRevision[],
): readonly PublicLink[] =>
  approved
    .filter((candidate) =>
      candidate.outgoingLinks.some((link) => link.publicId === target.publicId),
    )
    .map(publicLink)
    .sort((left, right) => left.slug.localeCompare(right.slug));

const contentPath = (root: string, revision: ApprovedRevision): string => {
  const kindPrefix = revision.metadata.kind === "page" ? "" : `/${revision.metadata.kind}`;
  const route = revision.metadata.slug.slice(kindPrefix.length).replace(/^\//, "") || "home";
  return join(root, "content", revision.metadata.kind, `${route}.md`);
};

const materializeContent = async (
  root: string,
  approved: readonly ApprovedRevision[],
): Promise<void> => {
  for (const revision of approved) {
    const output = contentPath(root, revision);
    await mkdir(dirname(output), { recursive: true });
    await atomicWrite(output, revision.markdown);
  }
};

const auditStagingPayload = (content: ContentIndex, config: PublisherConfig): void => {
  const serialized = JSON.stringify(content);
  if (/\bprv_[A-Za-z0-9_-]+\b/u.test(serialized) || serialized.includes(config.vault.root))
    throw new ReleaseError(
      "RELEASE_STAGING_AUDIT_FAILED",
      "Release staging contains a private identifier or path",
    );
  for (const pattern of config.security.denyPatterns) {
    let denied = false;
    try {
      denied = new RegExp(pattern, "u").test(serialized);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ReleaseError(
          "RELEASE_INVALID_DENY_PATTERN",
          "A configured deny pattern is invalid",
        );
      throw error;
    }
    if (denied)
      throw new ReleaseError(
        "RELEASE_STAGING_AUDIT_FAILED",
        "Release staging matches a configured private-data pattern",
      );
  }
};

const materializeAssets = async (
  root: string,
  approved: readonly ApprovedRevision[],
): Promise<void> => {
  const seen = new Map<string, string>();
  for (const revision of approved) {
    for (const asset of revision.assets) {
      const relative = asset.publicPath.replace(/^\/+/, "");
      const existing = seen.get(relative);
      if (existing !== undefined && existing !== asset.hash)
        throw new ReleaseError("RELEASE_ASSET_COLLISION", `Conflicting public asset: ${relative}`);
      if (existing !== undefined) continue;
      const output = await safePath(root, relative);
      const data = Buffer.from(asset.data, "base64");
      if (data.byteLength !== asset.bytes || hash(data) !== asset.hash) {
        throw new ReleaseError(
          "RELEASE_ASSET_INTEGRITY",
          "Approved public asset bytes do not match their descriptor",
        );
      }
      await mkdir(dirname(output), { recursive: true });
      await atomicWrite(output, data);
      seen.set(relative, asset.hash);
    }
  }
};

export const buildReleaseStaging = async (
  approved: readonly ApprovedRevision[],
  config: PublisherConfig,
  redirects: readonly { readonly from: string; readonly to: string; readonly status: 301 }[] = [],
): Promise<ReleaseManifest> => {
  validateReleaseGraph(approved, redirects, config);
  const target = config.publisher.releaseStagingDir;
  await mkdir(dirname(target), { recursive: true });
  const temporary = await mkdtemp(join(dirname(target), ".release-staging-"));
  try {
    const ordered = [...approved].sort((left, right) =>
      left.metadata.slug.localeCompare(right.metadata.slug),
    );
    const pages: readonly StagedPage[] = ordered.map((revision) => ({
      metadata: revision.metadata,
      markdown: revision.markdown,
      html: revision.html,
      outgoingLinks: revision.outgoingLinks,
      backlinks: backlinksFor(revision, ordered),
      assets: revision.assets.map(stagedAsset),
    }));
    const content: ContentIndex = { schemaVersion: 1, pages };
    auditStagingPayload(content, config);
    const manifest: ReleaseManifest = {
      schemaVersion: 1,
      pages: ordered.map((revision) => revision.metadata),
    };
    const rendererInput = await createRendererInput({
      root: temporary,
      siteUrl: config.site.url,
      approved: ordered,
      redirects,
      profile: resolveRendererProfile(config),
      privateRoot: config.vault.root,
      denyPatterns: config.security.denyPatterns,
    });
    await Promise.all([
      materializeAssets(temporary, ordered),
      materializeContent(temporary, ordered),
    ]);
    const searchIndex = ordered
      .filter((revision) => revision.metadata.kind !== "page" && revision.metadata.listed)
      .map((revision) => ({
        kind: revision.metadata.kind,
        path: revision.metadata.slug,
        title: revision.metadata.title,
        summary: revision.metadata.summary ?? "",
        tags: revision.metadata.tags,
      }));
    await Promise.all([
      atomicWrite(join(temporary, "content-index.json"), `${JSON.stringify(content)}\n`),
      atomicWrite(join(temporary, "publication-manifest.json"), `${JSON.stringify(manifest)}\n`),
      atomicWrite(
        join(temporary, "redirects.json"),
        `${JSON.stringify({ schemaVersion: 1, redirects })}\n`,
      ),
      atomicWrite(
        join(temporary, "search-index.json"),
        `${JSON.stringify({ schemaVersion: 1, pages: searchIndex })}\n`,
      ),
      atomicWrite(join(temporary, "renderer-input.json"), `${JSON.stringify(rendererInput)}\n`),
    ]);
    await replaceDirectory(temporary, target);
    await writeReleaseIdentity(config.publisher.stateDir, {
      schemaVersion: 1,
      revisions: revisionsForRelease(ordered),
      redirectsHash: redirectsPolicyHash(redirects),
      stagingPolicyHash: await releasePolicyHash(target),
    });
    return manifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
};

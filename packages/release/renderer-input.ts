import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { atomicWrite, hash, safePath } from "../fs/index.ts";
import { verifyMdxSnapshot } from "../mdx/artifact.ts";
import { type ApprovedRevision, buildTagTree, type PublicLink } from "../model/index.ts";
import {
  type RendererInput,
  RendererInputSchema,
  type RendererProfile,
} from "../renderer/index.ts";
import { ReleaseError } from "./error.ts";

type PublicArtifact = {
  readonly artifactPath: string;
  readonly publicPath: string;
  readonly hash: string;
  readonly mime: string;
  readonly bytes: number;
};

const publicLink = (revision: ApprovedRevision): PublicLink => ({
  publicId: revision.publicId,
  slug: revision.metadata.slug,
  title: revision.metadata.title,
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

function artifactExtension(path: string, expected: ".html" | ".js" | ".css"): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".map" || (expected === ".js" && ![".js", ".mjs"].includes(extension))) {
    throw new ReleaseError("RELEASE_MDX_ARTIFACT_INVALID", "MDX artifact type is not supported");
  }
  if (expected !== ".js" && extension !== expected) {
    throw new ReleaseError("RELEASE_MDX_ARTIFACT_INVALID", "MDX artifact type is not supported");
  }
  return expected === ".js" ? extension : expected;
}

async function stageArtifact(
  root: string,
  file: {
    readonly path: string;
    readonly hash: string;
    readonly mime: string;
    readonly bytes: number;
    readonly data: string;
  },
  expected: ".html" | ".js" | ".css",
  privateRoot: string,
  denyPatterns: readonly string[],
): Promise<PublicArtifact> {
  const data = Buffer.from(file.data, "base64");
  if (data.byteLength !== file.bytes || hash(data) !== file.hash) {
    throw new ReleaseError(
      "RELEASE_MDX_ARTIFACT_INTEGRITY",
      "Approved MDX artifact bytes do not match their hash",
    );
  }
  const text = data.toString("utf8");
  if (/sourceMappingURL\s*=|sourceMappingURL=/u.test(text)) {
    throw new ReleaseError("RELEASE_MDX_SOURCE_MAP", "MDX source maps are forbidden");
  }
  if (
    /\bprv_[A-Za-z0-9_-]+\b/u.test(text) ||
    text.includes(privateRoot) ||
    denyPatterns.some((pattern) => new RegExp(pattern, "u").test(text))
  ) {
    throw new ReleaseError(
      "RELEASE_STAGING_AUDIT_FAILED",
      "MDX artifact contains private release data",
    );
  }
  const extension = artifactExtension(file.path, expected);
  const digest = file.hash.slice("sha256:".length);
  const artifactPath = `renderer-artifacts/mdx/${digest}${extension}`;
  const output = await safePath(root, artifactPath);
  await mkdir(join(output, ".."), { recursive: true });
  await atomicWrite(output, data);
  return {
    artifactPath,
    publicPath: `/_assets/mdx/${digest}${extension}`,
    hash: file.hash,
    mime: file.mime,
    bytes: file.bytes,
  };
}

export async function createRendererInput(input: {
  readonly root: string;
  readonly siteUrl: string;
  readonly approved: readonly ApprovedRevision[];
  readonly redirects: readonly {
    readonly from: string;
    readonly to: string;
    readonly status: 301;
  }[];
  readonly profile: RendererProfile;
  readonly privateRoot: string;
  readonly denyPatterns: readonly string[];
}): Promise<RendererInput> {
  const pages = [];
  for (const revision of input.approved) {
    let content: RendererInput["pages"][number]["content"];
    if (revision.mdx === undefined) {
      content = { type: "markdown", markdown: revision.markdown, html: revision.html };
    } else {
      if (!input.profile.capabilities.includes("mdx-react-19")) {
        throw new ReleaseError(
          "RELEASE_RENDERER_MDX_INCOMPATIBLE",
          "The selected renderer does not support the approved React 19 MDX runtime",
        );
      }
      const snapshot = verifyMdxSnapshot(revision.mdx);
      const html = await stageArtifact(
        input.root,
        snapshot.artifact.html,
        ".html",
        input.privateRoot,
        input.denyPatterns,
      );
      const scripts = await Promise.all(
        snapshot.artifact.scripts.map((file) =>
          stageArtifact(input.root, file, ".js", input.privateRoot, input.denyPatterns),
        ),
      );
      const styles = await Promise.all(
        snapshot.artifact.styles.map((file) =>
          stageArtifact(input.root, file, ".css", input.privateRoot, input.denyPatterns),
        ),
      );
      content = {
        type: "mdx",
        runtime: "react-19",
        markdown: revision.markdown,
        fallbackHtml: revision.html,
        html: {
          artifactPath: html.artifactPath,
          hash: html.hash,
          mime: html.mime,
          bytes: html.bytes,
        },
        scripts,
        styles,
      };
    }
    pages.push({
      metadata: revision.metadata,
      content,
      outgoingLinks: revision.outgoingLinks,
      backlinks: backlinksFor(revision, input.approved),
      assets: revision.assets.map(({ publicPath, hash: assetHash, mime, bytes }) => ({
        publicPath,
        hash: assetHash,
        mime,
        bytes,
      })),
    });
  }
  return RendererInputSchema.parse({
    protocol: "wikai-static-renderer",
    version: 1,
    siteUrl: input.siteUrl,
    pages,
    redirects: input.redirects,
    assets: pages.flatMap((page) => page.assets),
    tagTree: buildTagTree(input.approved.map((revision) => revision.metadata.tags)),
  });
}

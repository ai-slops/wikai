import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Diagnostic, PublicMetadata, PublisherConfig } from "../model/index.ts";
import { PersistedMetadataSchema, RedirectSchema } from "../model/index.ts";
import { type RendererInput, RendererInputSchema, routeOutputPath } from "../renderer/index.ts";
import { readOutputFile, type ValidatedOutputTree } from "./output-tree.ts";

const StagingIndexSchema = z.looseObject({
  pages: z.array(
    z.looseObject({
      assets: z.array(z.looseObject({ publicPath: z.string(), hash: z.string() })),
    }),
  ),
});

export type AuditPolicy = Readonly<{
  routes: ReadonlySet<string>;
  pages: readonly PublicMetadata[];
  approvedIds: ReadonlySet<string>;
  assets: ReadonlyMap<string, string>;
  diagnostics: readonly Diagnostic[];
  rendererInput: RendererInput | null;
}>;

const diagnostic = (code: string, message: string): Diagnostic => ({
  code,
  severity: "error",
  message,
});
const pageInput = (value: unknown): unknown =>
  typeof value === "object" && value !== null && "pages" in value ? value.pages : undefined;
const redirectInput = (value: unknown): unknown =>
  typeof value === "object" && value !== null && "redirects" in value ? value.redirects : undefined;
export const readAuditPolicy = async (
  tree: ValidatedOutputTree,
  config: PublisherConfig,
): Promise<AuditPolicy> => {
  try {
    const publicManifestBytes = await readOutputFile(tree, "publication-manifest.json");
    const publicRedirectsBytes = await readOutputFile(tree, "redirects.json");
    const trustedManifestBytes = await readFile(
      join(config.publisher.releaseStagingDir, "publication-manifest.json"),
    );
    const trustedRedirectsBytes = await readFile(
      join(config.publisher.releaseStagingDir, "redirects.json"),
    );
    const publicManifestRaw: unknown = JSON.parse(publicManifestBytes.toString("utf8"));
    const publicRedirectsRaw: unknown = JSON.parse(publicRedirectsBytes.toString("utf8"));
    const trustedManifestRaw: unknown = JSON.parse(trustedManifestBytes.toString("utf8"));
    const trustedRedirectsRaw: unknown = JSON.parse(trustedRedirectsBytes.toString("utf8"));
    const stagingIndexRaw: unknown = JSON.parse(
      await readFile(join(config.publisher.releaseStagingDir, "content-index.json"), "utf8"),
    );
    let rendererInput: RendererInput | null = null;
    try {
      rendererInput = RendererInputSchema.parse(
        JSON.parse(
          await readFile(join(config.publisher.releaseStagingDir, "renderer-input.json"), "utf8"),
        ),
      );
    } catch (error) {
      if (config.renderer?.profile === "docker") throw error;
      if (!(error instanceof Error)) throw error;
    }
    const publicManifest = PersistedMetadataSchema.array().safeParse(pageInput(publicManifestRaw));
    const publicRedirects = RedirectSchema.array().safeParse(redirectInput(publicRedirectsRaw));
    const manifest = PersistedMetadataSchema.array().safeParse(pageInput(trustedManifestRaw));
    const redirects = RedirectSchema.array().safeParse(redirectInput(trustedRedirectsRaw));
    const stagingIndex = StagingIndexSchema.safeParse(stagingIndexRaw);
    if (
      !manifest.success ||
      !redirects.success ||
      !publicManifest.success ||
      !publicRedirects.success ||
      !stagingIndex.success
    ) {
      return {
        routes: new Set(),
        pages: [],
        approvedIds: new Set(),
        assets: new Map(),
        diagnostics: [
          diagnostic("AUDIT_ROUTE_MANIFEST_INVALID", "Public route policy files are invalid"),
        ],
        rendererInput,
      };
    }
    const diagnostics =
      publicManifestBytes.equals(trustedManifestBytes) &&
      publicRedirectsBytes.equals(trustedRedirectsBytes)
        ? []
        : [
            diagnostic(
              "AUDIT_ROUTE_POLICY_MISMATCH",
              "Rendered route policy differs from trusted release staging",
            ),
          ];
    const assets = new Map(
      stagingIndex.data.pages.flatMap((page) =>
        page.assets.map((asset) => [asset.publicPath.replace(/^\/+/, ""), asset.hash] as const),
      ),
    );
    for (const page of rendererInput?.pages ?? []) {
      if (page.content.type !== "mdx") continue;
      for (const artifact of [...page.content.scripts, ...page.content.styles]) {
        assets.set(artifact.publicPath.replace(/^\/+/, ""), artifact.hash);
      }
    }
    return {
      routes: new Set([
        ...manifest.data.map((page) => routeOutputPath(page.slug)),
        ...redirects.data.map((redirect) => routeOutputPath(redirect.from)),
      ]),
      pages: manifest.data,
      approvedIds: new Set(manifest.data.map((page) => page.id)),
      assets,
      diagnostics,
      rendererInput,
    };
  } catch (error) {
    if (error instanceof Error)
      return {
        routes: new Set(),
        pages: [],
        approvedIds: new Set(),
        assets: new Map(),
        diagnostics: [diagnostic("AUDIT_STAGING_INVALID", "Trusted staging policy cannot be read")],
        rendererInput: null,
      };
    throw error;
  }
};

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  Diagnostic,
  PublicMetadata,
  PublicRedirect,
  PublisherConfig,
} from "../model/index.ts";
import { MetadataSchema, RedirectSchema } from "../model/index.ts";

const StagingIndexSchema = z
  .object({
    pages: z.array(
      z
        .object({
          assets: z.array(z.object({ publicPath: z.string(), hash: z.string() }).passthrough()),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type AuditPolicy = Readonly<{
  routes: ReadonlySet<string>;
  pages: readonly PublicMetadata[];
  approvedIds: ReadonlySet<string>;
  assets: ReadonlyMap<string, string>;
  diagnostics: readonly Diagnostic[];
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
const metadataRoute = (metadata: PublicMetadata): string =>
  metadata.slug === "/" ? "index.html" : `${metadata.slug.slice(1)}/index.html`;
const redirectRoute = (redirect: PublicRedirect): string =>
  `${redirect.from.replace(/^\/+|\/+$/g, "")}/index.html`;

export const readAuditPolicy = async (
  root: string,
  config: PublisherConfig,
): Promise<AuditPolicy> => {
  try {
    const publicManifestRaw: unknown = JSON.parse(
      await readFile(join(root, "publication-manifest.json"), "utf8"),
    );
    const publicRedirectsRaw: unknown = JSON.parse(
      await readFile(join(root, "redirects.json"), "utf8"),
    );
    const trustedManifestRaw: unknown = JSON.parse(
      await readFile(join(config.publisher.releaseStagingDir, "publication-manifest.json"), "utf8"),
    );
    const trustedRedirectsRaw: unknown = JSON.parse(
      await readFile(join(config.publisher.releaseStagingDir, "redirects.json"), "utf8"),
    );
    const stagingIndexRaw: unknown = JSON.parse(
      await readFile(join(config.publisher.releaseStagingDir, "content-index.json"), "utf8"),
    );
    const publicManifest = MetadataSchema.array().safeParse(pageInput(publicManifestRaw));
    const publicRedirects = RedirectSchema.array().safeParse(redirectInput(publicRedirectsRaw));
    const manifest = MetadataSchema.array().safeParse(pageInput(trustedManifestRaw));
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
      };
    }
    const diagnostics =
      JSON.stringify(publicManifest.data) === JSON.stringify(manifest.data) &&
      JSON.stringify(publicRedirects.data) === JSON.stringify(redirects.data)
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
    return {
      routes: new Set([...manifest.data.map(metadataRoute), ...redirects.data.map(redirectRoute)]),
      pages: manifest.data,
      approvedIds: new Set(manifest.data.map((page) => page.id)),
      assets,
      diagnostics,
    };
  } catch (error) {
    if (error instanceof Error)
      return {
        routes: new Set(),
        pages: [],
        approvedIds: new Set(),
        assets: new Map(),
        diagnostics: [diagnostic("AUDIT_STAGING_INVALID", "Trusted staging policy cannot be read")],
      };
    throw error;
  }
};

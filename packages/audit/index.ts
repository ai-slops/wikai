import { extname } from "node:path";
import { hash } from "../fs/index.ts";
import type { Diagnostic, PublicMetadata, PublisherConfig, VaultSnapshot } from "../model/index.ts";
import { resolveRendererProfile, routeOutputPath } from "../renderer/index.ts";
import {
  inspectOutputTree,
  type OutputTreeInspection,
  readOutputFile,
  readOutputText,
  type ValidatedOutputTree,
} from "./output-tree.ts";
import { readAuditPolicy } from "./policy.ts";
import { privateMarkers, scanText } from "./privacy.ts";
import { rendererOutputPolicy } from "./renderer-output.ts";

const REQUIRED_FILES = [
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
  "sitemap-0.xml",
  "sitemap-index.xml",
  "robots.txt",
  "publication-manifest.json",
  "redirects.json",
] as const;
const TRUSTED_FEEDS = [
  "feeds/all.xml",
  "feeds/work.xml",
  "feeds/knowledge.xml",
  "feeds/log.xml",
] as const;
const FIXED_FILE_SET: ReadonlySet<string> = new Set([...REQUIRED_FILES, ...TRUSTED_FEEDS]);
const CORE_ROUTE_SET: ReadonlySet<string> = new Set(
  REQUIRED_FILES.filter((file) => file.endsWith(".html")),
);
const TEXT_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".xml", ".txt"]);
const diagnostic = (code: string, message: string, sourcePath?: string): Diagnostic => ({
  code,
  severity: "error",
  message,
  ...(sourcePath === undefined ? {} : { sourcePath }),
});

const hasNoindex = (html: string): boolean =>
  (html.match(/<meta\b[^>]*>/giu) ?? []).some(
    (tag) =>
      /\bname\s*=\s*["']robots["']/iu.test(tag) &&
      /\bcontent\s*=\s*["'][^"']*\bnoindex\b[^"']*["']/iu.test(tag),
  );

const indexPolicyDiagnostics = async (
  tree: ValidatedOutputTree,
  pages: readonly PublicMetadata[],
  siteUrl: string,
): Promise<readonly Diagnostic[]> => {
  let sitemap = "";
  try {
    sitemap = await readOutputText(tree, "sitemap-0.xml");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
  const sitemapUrls = new Set(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/giu)].map((match) => match[1]),
  );
  const diagnostics: Diagnostic[] = [];
  for (const page of pages) {
    const expectedUrl = new URL(page.slug, siteUrl).href;
    if (page.index && !sitemapUrls.has(expectedUrl))
      diagnostics.push(
        diagnostic(
          "AUDIT_SITEMAP_MISSING",
          "An indexed public route is missing from the sitemap",
          routeOutputPath(page.slug),
        ),
      );
    if (!page.index && sitemapUrls.has(expectedUrl))
      diagnostics.push(
        diagnostic(
          "AUDIT_SITEMAP_FORBIDDEN",
          "A noindex public route appears in the sitemap",
          routeOutputPath(page.slug),
        ),
      );
    try {
      const outputPath = routeOutputPath(page.slug);
      const html = await readOutputText(tree, outputPath);
      if (hasNoindex(html) === page.index)
        diagnostics.push(
          diagnostic(
            "AUDIT_NOINDEX_MISMATCH",
            "Rendered robots policy differs from trusted metadata",
            outputPath,
          ),
        );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
  return diagnostics;
};

export const auditDist = async (
  path: string,
  config: PublisherConfig,
  vault?: VaultSnapshot,
): Promise<Diagnostic[]> => {
  const diagnostics: Diagnostic[] = [];
  let inspection: OutputTreeInspection;
  try {
    inspection = await inspectOutputTree(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [diagnostic("AUDIT_DIST_MISSING", "Distribution directory does not exist", path)];
    throw error;
  }
  if (!inspection.valid) return [...inspection.diagnostics];
  const { tree } = inspection;
  const { files, relativeFiles } = tree;
  const profile = resolveRendererProfile(config);
  const requiredFiles = profile.legacyOutput
    ? REQUIRED_FILES
    : [
        ...profile.requiredRoutes.map(routeOutputPath),
        "publication-manifest.json",
        "redirects.json",
        "renderer-output.json",
      ];
  for (const required of requiredFiles)
    if (!relativeFiles.has(required))
      diagnostics.push(
        diagnostic(
          "AUDIT_REQUIRED_ROUTE_MISSING",
          `Required public output is missing: ${required}`,
        ),
      );
  const policy = await readAuditPolicy(tree, config);
  diagnostics.push(...policy.diagnostics);
  const outputPolicy = await rendererOutputPolicy({
    tree,
    config,
    policy,
  });
  diagnostics.push(...outputPolicy.diagnostics);
  for (const route of policy.routes)
    if (!relativeFiles.has(route))
      diagnostics.push(
        diagnostic(
          "AUDIT_EXPECTED_ROUTE_MISSING",
          "A trusted public route is missing from rendered output",
          route,
        ),
      );
  for (const asset of policy.assets.keys())
    if (!relativeFiles.has(asset))
      diagnostics.push(
        diagnostic(
          "AUDIT_EXPECTED_ASSET_MISSING",
          "A trusted public asset is missing from rendered output",
          asset,
        ),
      );
  if (profile.capabilities.includes("sitemap")) {
    diagnostics.push(...(await indexPolicyDiagnostics(tree, policy.pages, config.site.url)));
  }
  const allowedRoutes =
    profile.legacyOutput && outputPolicy.legacy
      ? new Set([...CORE_ROUTE_SET, ...policy.routes])
      : outputPolicy.routeFiles;
  for (const file of relativeFiles)
    if (file.endsWith(".html") && !allowedRoutes.has(file))
      diagnostics.push(
        diagnostic(
          "AUDIT_UNEXPECTED_ROUTE",
          "Distribution contains a route outside the public manifest",
          file,
        ),
      );
  const markers = privateMarkers(config, vault, new Set(policy.pages.map((page) => page.title)));
  for (const relativePath of files) {
    diagnostics.push(...scanText(relativePath, relativePath, config, markers, policy.approvedIds));
    const extension = extname(relativePath).toLowerCase();
    if (relativePath.endsWith(".map"))
      diagnostics.push(
        diagnostic("AUDIT_SOURCE_MAP", "Source maps are forbidden in public output", relativePath),
      );
    const declaredAsset = policy.assets.has(relativePath);
    if (
      !(profile.legacyOutput && FIXED_FILE_SET.has(relativePath)) &&
      !allowedRoutes.has(relativePath) &&
      !declaredAsset &&
      !outputPolicy.allowedFiles.has(relativePath)
    )
      diagnostics.push(
        diagnostic(
          "AUDIT_UNEXPECTED_FILE",
          "Distribution contains a file outside the trusted release allowlist",
          relativePath,
        ),
      );
    if (declaredAsset) {
      const expectedHash = policy.assets.get(relativePath);
      if (
        expectedHash !== undefined &&
        hash(await readOutputFile(tree, relativePath)) !== expectedHash
      )
        diagnostics.push(
          diagnostic(
            "AUDIT_ASSET_HASH_MISMATCH",
            "A rendered public asset differs from its approved hash",
            relativePath,
          ),
        );
    }
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    diagnostics.push(
      ...scanText(
        await readOutputText(tree, relativePath),
        relativePath,
        config,
        markers,
        policy.approvedIds,
      ),
    );
  }
  return diagnostics;
};

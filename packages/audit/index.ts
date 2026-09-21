import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { hash } from "../fs/index.ts";
import type { Diagnostic, PublicMetadata, PublisherConfig, VaultSnapshot } from "../model/index.ts";
import { readAuditPolicy } from "./policy.ts";
import { privateMarkers, scanText } from "./privacy.ts";

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
const ALLOWED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".avif",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
]);

const diagnostic = (code: string, message: string, sourcePath?: string): Diagnostic => ({
  code,
  severity: "error",
  message,
  ...(sourcePath === undefined ? {} : { sourcePath }),
});

const walk = async (root: string, current = root): Promise<readonly string[]> => {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) files.push(path);
    else if (info.isDirectory()) files.push(...(await walk(root, path)));
    else files.push(path);
  }
  return files;
};

const normalizedRelative = (root: string, path: string): string =>
  relative(root, path).split(sep).join("/");
const metadataRoute = (metadata: PublicMetadata): string =>
  metadata.slug === "/" ? "index.html" : `${metadata.slug.slice(1)}/index.html`;

const hasNoindex = (html: string): boolean =>
  (html.match(/<meta\b[^>]*>/giu) ?? []).some(
    (tag) =>
      /\bname\s*=\s*["']robots["']/iu.test(tag) &&
      /\bcontent\s*=\s*["'][^"']*\bnoindex\b[^"']*["']/iu.test(tag),
  );

const indexPolicyDiagnostics = async (
  root: string,
  pages: readonly PublicMetadata[],
  siteUrl: string,
): Promise<readonly Diagnostic[]> => {
  let sitemap = "";
  try {
    sitemap = await readFile(join(root, "sitemap-0.xml"), "utf8");
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
          metadataRoute(page),
        ),
      );
    if (!page.index && sitemapUrls.has(expectedUrl))
      diagnostics.push(
        diagnostic(
          "AUDIT_SITEMAP_FORBIDDEN",
          "A noindex public route appears in the sitemap",
          metadataRoute(page),
        ),
      );
    try {
      const html = await readFile(join(root, metadataRoute(page)), "utf8");
      if (hasNoindex(html) === page.index)
        diagnostics.push(
          diagnostic(
            "AUDIT_NOINDEX_MISMATCH",
            "Rendered robots policy differs from trusted metadata",
            metadataRoute(page),
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
  let files: readonly string[];
  try {
    files = await walk(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [diagnostic("AUDIT_DIST_MISSING", "Distribution directory does not exist", path)];
    throw error;
  }
  const relativeFiles = new Set(files.map((file) => normalizedRelative(path, file)));
  for (const required of REQUIRED_FILES)
    if (!relativeFiles.has(required))
      diagnostics.push(
        diagnostic(
          "AUDIT_REQUIRED_ROUTE_MISSING",
          `Required public output is missing: ${required}`,
        ),
      );
  const policy = await readAuditPolicy(path, config);
  diagnostics.push(...policy.diagnostics);
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
  diagnostics.push(...(await indexPolicyDiagnostics(path, policy.pages, config.site.url)));
  const allowedRoutes = new Set([...CORE_ROUTE_SET, ...policy.routes]);
  for (const file of relativeFiles)
    if (file.endsWith(".html") && !allowedRoutes.has(file))
      diagnostics.push(
        diagnostic(
          "AUDIT_UNEXPECTED_ROUTE",
          "Distribution contains a route outside the public manifest",
          file,
        ),
      );
  const markers = privateMarkers(config, vault);
  for (const file of files) {
    const relativePath = normalizedRelative(path, file);
    const info = await lstat(file);
    if (info.isSymbolicLink()) {
      diagnostics.push(
        diagnostic("AUDIT_SYMLINK", "Distribution contains a symbolic link", relativePath),
      );
      continue;
    }
    const extension = extname(relativePath).toLowerCase();
    if (relativePath.endsWith(".map"))
      diagnostics.push(
        diagnostic("AUDIT_SOURCE_MAP", "Source maps are forbidden in public output", relativePath),
      );
    const generatedAsset = relativePath.startsWith("_assets/") && ALLOWED_EXTENSIONS.has(extension);
    const declaredAsset = policy.assets.has(relativePath);
    if (
      !FIXED_FILE_SET.has(relativePath) &&
      !allowedRoutes.has(relativePath) &&
      !generatedAsset &&
      !declaredAsset
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
      if (expectedHash !== undefined && hash(await readFile(file)) !== expectedHash)
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
      ...scanText(await readFile(file, "utf8"), relativePath, config, markers, policy.approvedIds),
    );
  }
  return diagnostics;
};

import { extname } from "node:path";
import { hash, isFsError } from "../fs/index.ts";
import type { Diagnostic, PublisherConfig } from "../model/index.ts";
import {
  astroCategoryRoutes,
  type RendererOutput,
  RendererOutputSchema,
  resolveRendererProfile,
  routeOutputPath,
} from "../renderer/index.ts";
import { readOutputFile, readOutputText, type ValidatedOutputTree } from "./output-tree.ts";
import type { AuditPolicy } from "./policy.ts";

const diagnostic = (code: string, message: string, sourcePath?: string): Diagnostic => ({
  code,
  severity: "error",
  message,
  ...(sourcePath === undefined ? {} : { sourcePath }),
});

const routeForLegacyPath = (path: string): string => {
  if (path === "index.html") return "/";
  if (path.endsWith("/index.html")) return `/${path.slice(0, -"/index.html".length)}`;
  return `/${path}`;
};

async function legacyAstroOutput(
  tree: ValidatedOutputTree,
  allowedRoutes: ReadonlySet<string>,
  assetPrefixes: readonly string[],
): Promise<RendererOutput> {
  const files = await Promise.all(
    [...tree.relativeFiles]
      .filter(
        (path) =>
          path !== "renderer-output.json" &&
          (allowedRoutes.has(path) ||
            ["publication-manifest.json", "redirects.json"].includes(path) ||
            assetPrefixes.some((prefix) => path.startsWith(prefix))),
      )
      .map(async (path) => {
        const digest = hash(await readOutputFile(tree, path));
        if (allowedRoutes.has(path)) {
          return { path, hash: digest, type: "route" as const, route: routeForLegacyPath(path) };
        }
        return {
          path,
          hash: digest,
          type: ["publication-manifest.json", "redirects.json"].includes(path)
            ? ("policy" as const)
            : ("asset" as const),
        };
      }),
  );
  return RendererOutputSchema.parse({ protocol: "wikai-static-renderer", version: 1, files });
}

export async function rendererOutputPolicy(input: {
  readonly tree: ValidatedOutputTree;
  readonly config: PublisherConfig;
  readonly policy: AuditPolicy;
}): Promise<{
  readonly allowedFiles: ReadonlySet<string>;
  readonly routeFiles: ReadonlySet<string>;
  readonly diagnostics: readonly Diagnostic[];
  readonly legacy: boolean;
}> {
  const profile = resolveRendererProfile(input.config);
  const expectedContentRoutes = new Map(
    input.policy.pages.map((page) => [page.slug, routeOutputPath(page.slug)] as const),
  );
  const expectedRoutes = new Set([
    ...expectedContentRoutes.keys(),
    ...(input.policy.rendererInput?.redirects.map((redirect) => redirect.from) ?? []),
    ...profile.requiredRoutes,
    ...(profile.name === "astro" &&
    input.policy.rendererInput != null &&
    input.tree.relativeFiles.has("renderer-output.json")
      ? astroCategoryRoutes(input.policy.rendererInput.pages)
      : []),
  ]);
  const allowedRoutes = new Set([...expectedRoutes, ...profile.reservedRoutes]);
  const expectedRoutePaths = new Map(
    [...allowedRoutes].map((route) => [route, routeOutputPath(route)] as const),
  );
  const expectedRouteFiles = new Set([
    ...input.policy.routes,
    ...profile.requiredRoutes.map(routeOutputPath),
  ]);
  let output: RendererOutput;
  try {
    output = RendererOutputSchema.parse(
      JSON.parse(await readOutputText(input.tree, "renderer-output.json")),
    );
  } catch (error) {
    if (!profile.legacyOutput || (!isFsError(error, "ENOENT") && !(error instanceof SyntaxError))) {
      return {
        allowedFiles: new Set(),
        routeFiles: new Set(),
        legacy: false,
        diagnostics: [
          diagnostic(
            "AUDIT_RENDERER_OUTPUT_INVALID",
            "Renderer output manifest is missing or invalid",
          ),
        ],
      };
    }
    output = await legacyAstroOutput(
      input.tree,
      new Set([...expectedRouteFiles, ...profile.reservedRoutes.map(routeOutputPath)]),
      profile.assetPrefixes,
    );
  }
  const diagnostics: Diagnostic[] = [];
  const allowedFiles = new Set(["renderer-output.json"]);
  const routeFiles = new Set<string>();
  const announcedRoutes = new Set<string>();
  for (const file of output.files) {
    allowedFiles.add(file.path);
    if (!input.tree.relativeFiles.has(file.path)) {
      diagnostics.push(
        diagnostic(
          "AUDIT_RENDERER_FILE_MISSING",
          "Announced renderer output is missing",
          file.path,
        ),
      );
      continue;
    }
    if (hash(await readOutputFile(input.tree, file.path)) !== file.hash) {
      diagnostics.push(
        diagnostic(
          "AUDIT_RENDERER_HASH_MISMATCH",
          "Renderer output hash does not match",
          file.path,
        ),
      );
    }
    if (
      file.type === "policy" &&
      !["publication-manifest.json", "redirects.json"].includes(file.path)
    ) {
      diagnostics.push(
        diagnostic(
          "AUDIT_UNEXPECTED_FILE",
          "Renderer announced an undeclared policy file",
          file.path,
        ),
      );
    }
    if (
      file.type === "asset" &&
      !input.policy.assets.has(file.path) &&
      !profile.assetPrefixes.some((prefix) => file.path.startsWith(prefix))
    ) {
      diagnostics.push(
        diagnostic(
          "AUDIT_UNEXPECTED_FILE",
          "Renderer announced an asset outside its profile",
          file.path,
        ),
      );
    }
    if (file.type !== "route") continue;
    announcedRoutes.add(file.route);
    routeFiles.add(file.path);
    if (!allowedRoutes.has(file.route)) {
      diagnostics.push(
        diagnostic("AUDIT_UNEXPECTED_ROUTE", "Renderer announced an undeclared route", file.path),
      );
    }
    const expectedPath = expectedRoutePaths.get(file.route);
    if (expectedPath !== undefined && expectedPath !== file.path) {
      diagnostics.push(
        diagnostic(
          "AUDIT_ROUTE_PATH_MISMATCH",
          "Canonical route uses an unexpected output path",
          file.path,
        ),
      );
    }
  }
  for (const route of expectedRoutes) {
    if (!announcedRoutes.has(route)) {
      diagnostics.push(
        diagnostic("AUDIT_EXPECTED_ROUTE_MISSING", "A trusted public route is missing", route),
      );
    }
  }
  for (const path of input.tree.relativeFiles) {
    if (allowedFiles.has(path)) continue;
    const prefixAllowed = profile.assetPrefixes.some((prefix) => path.startsWith(prefix));
    if (profile.legacyOutput && prefixAllowed && extname(path) !== ".map") {
      allowedFiles.add(path);
      continue;
    }
    diagnostics.push(
      diagnostic("AUDIT_UNEXPECTED_FILE", "Distribution contains an unannounced file", path),
    );
  }
  return {
    allowedFiles,
    routeFiles,
    diagnostics,
    legacy: !input.tree.relativeFiles.has("renderer-output.json"),
  };
}

import type { PublisherConfig } from "../model/index.ts";

export type RendererCapability = "html" | "markdown" | "mdx-react-19" | "sitemap";

export type RendererProfile = {
  readonly name: "astro" | "docker";
  readonly protocolVersion: 1;
  readonly image: string;
  readonly capabilities: readonly RendererCapability[];
  readonly reservedRoutes: readonly string[];
  readonly requiredRoutes: readonly string[];
  readonly assetPrefixes: readonly string[];
  readonly legacyOutput: boolean;
};

const ASTRO_RESERVED_ROUTES = [
  "/work",
  "/knowledge",
  "/log",
  "/search",
  "/categories",
  "/feeds",
  "/feed.xml",
  "/work.xml",
  "/knowledge.xml",
  "/log.xml",
  "/feeds/all.xml",
  "/feeds/work.xml",
  "/feeds/knowledge.xml",
  "/feeds/log.xml",
  "/robots.txt",
  "/sitemap-index.xml",
  "/sitemap-0.xml",
  "/publication-manifest.json",
  "/redirects.json",
] as const;

const ASTRO_REQUIRED_ROUTES = [
  "/",
  "/about",
  "/now",
  "/contact",
  "/search",
  "/work",
  "/knowledge",
  "/log",
  "/feed.xml",
  "/work.xml",
  "/knowledge.xml",
  "/log.xml",
  "/sitemap-0.xml",
  "/sitemap-index.xml",
  "/robots.txt",
] as const;

export function resolveRendererProfile(config: PublisherConfig): RendererProfile {
  const renderer = config.renderer ?? { profile: "astro" as const, protocolVersion: 1 as const };
  if (renderer.profile === "astro") {
    return {
      name: "astro",
      protocolVersion: 1,
      image: config.site.image,
      capabilities: ["html", "markdown", "mdx-react-19", "sitemap"],
      reservedRoutes: ASTRO_RESERVED_ROUTES,
      requiredRoutes: ASTRO_REQUIRED_ROUTES,
      assetPrefixes: ["_assets/"],
      legacyOutput: true,
    };
  }
  return {
    name: "docker",
    protocolVersion: renderer.protocolVersion,
    image: renderer.image,
    capabilities: renderer.capabilities,
    reservedRoutes: renderer.reservedRoutes,
    requiredRoutes: renderer.requiredRoutes,
    assetPrefixes: renderer.assetPrefixes,
    legacyOutput: false,
  };
}

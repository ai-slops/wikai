import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../model/index.ts";
import {
  astroCategoryRoutes,
  RendererOutputSchema,
  resolveRendererProfile,
  routeOutputPath,
} from "./index.ts";

describe("renderer protocol", () => {
  it("keeps omitted renderer configuration on the supported Astro profile", () => {
    // Given a legacy configuration with only the site image.
    const config = ConfigSchema.parse({
      vault: { root: "/vault" },
      publisher: {
        stateDir: "/state",
        previewStagingDir: "/preview",
        releaseStagingDir: "/release",
      },
      site: { sourceDir: "/site", distDir: "/dist", image: "legacy-astro:test" },
    });

    // When the trusted renderer profile is resolved.
    const profile = resolveRendererProfile(config);

    // Then legacy behavior is represented explicitly as protocol v1 Astro capabilities.
    expect(profile).toMatchObject({
      name: "astro",
      protocolVersion: 1,
      image: "legacy-astro:test",
      capabilities: ["html", "markdown", "mdx-react-19", "sitemap"],
    });
    expect(profile.requiredRoutes).toContain("/search");
  });

  it("accepts a declarative Docker profile without category route assumptions", () => {
    // Given a trusted prebuilt image and an exact output policy.
    const config = ConfigSchema.parse({
      vault: { root: "/vault" },
      publisher: {
        stateDir: "/state",
        previewStagingDir: "/preview",
        releaseStagingDir: "/release",
      },
      site: { sourceDir: "/site", distDir: "/dist" },
      renderer: {
        profile: "docker",
        protocolVersion: 1,
        image:
          "example/static-renderer@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        capabilities: ["html", "markdown"],
        reservedRoutes: ["/browse"],
        requiredRoutes: ["/browse"],
        assetPrefixes: ["assets/"],
      },
    });

    // When the profile is resolved.
    const profile = resolveRendererProfile(config);

    // Then only its declarative routes are reserved and required.
    expect(profile.requiredRoutes).toEqual(["/browse"]);
    expect(profile.reservedRoutes).toEqual(["/browse"]);
    expect(profile.requiredRoutes).not.toContain("/work");
  });

  it("rejects duplicate routes and source maps in renderer output", () => {
    // Given output attempting to announce one route twice and a source map.
    const duplicate = {
      protocol: "wikai-static-renderer",
      version: 1,
      files: [
        {
          path: "hello/index.html",
          hash: `sha256:${"1".repeat(64)}`,
          type: "route",
          route: "/hello",
        },
        {
          path: "other/index.html",
          hash: `sha256:${"2".repeat(64)}`,
          type: "route",
          route: "/hello",
        },
      ],
    };
    const sourceMap = {
      protocol: "wikai-static-renderer",
      version: 1,
      files: [{ path: "assets/app.js.map", hash: `sha256:${"3".repeat(64)}`, type: "asset" }],
    };

    // When each untrusted result is parsed, then the protocol fails closed.
    expect(RendererOutputSchema.safeParse(duplicate).success).toBe(false);
    expect(RendererOutputSchema.safeParse(sourceMap).success).toBe(false);
  });

  it("maps arbitrary canonical slugs to static output paths", () => {
    // Given canonical routes outside legacy kind prefixes, when mapped, then directory output is stable.
    expect(routeOutputPath("/")).toBe("index.html");
    expect(routeOutputPath("/notes/hello")).toBe("notes/hello/index.html");
  });

  it("allows only Astro category routes derived from approved first-segment category tags", () => {
    // Given approved metadata with multiple hierarchical and category-like tags.
    const pages = [
      {
        metadata: {
          tags: ["category/programming/typescript", "category/web", "categoryx/private"],
          listed: true,
        },
      },
      { metadata: { tags: ["category/programming/react"], listed: false } },
    ];

    // When the trusted Astro profile plans its derived routes.
    const routes = astroCategoryRoutes(pages);

    // Then only listed, exact-root category ancestors become renderer-owned routes.
    expect(routes).toEqual([
      "/categories",
      "/categories/programming",
      "/categories/programming/typescript",
      "/categories/web",
    ]);
  });
});

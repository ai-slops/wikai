import { z } from "zod";
import { isCanonicalPublicRoute } from "./routes.ts";

const VisibilitySchema = z.strictObject({
  listed: z.boolean(),
  index: z.boolean(),
  feed: z.boolean(),
});
const DeploymentNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
const DirectoryDeploymentSchema = z.strictObject({
  type: z.literal("directory"),
  root: z.string().min(1),
});
const RendererCapabilitySchema = z.enum(["html", "markdown", "mdx-react-19", "sitemap"]);
const RendererRouteSchema = z
  .string()
  .startsWith("/")
  .min(1)
  .refine(isCanonicalPublicRoute, "Renderer routes must be canonical");
const RendererSchema = z.discriminatedUnion("profile", [
  z.strictObject({
    profile: z.literal("astro"),
    protocolVersion: z.literal(1).default(1),
  }),
  z.strictObject({
    profile: z.literal("docker"),
    protocolVersion: z.literal(1),
    image: z.string().min(1),
    capabilities: z.array(RendererCapabilitySchema).min(1),
    reservedRoutes: z.array(RendererRouteSchema).default([]),
    requiredRoutes: z.array(RendererRouteSchema).default([]),
    assetPrefixes: z.array(z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\/$/u)).default([]),
  }),
]);
export const ConfigSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  vault: z.strictObject({
    root: z.string(),
    include: z.array(z.string()).default(["**/*.md", "**/*.mdx"]),
    exclude: z
      .array(z.string())
      .default([
        ".git/**",
        ".publisher/**",
        "node_modules/**",
        "build/**",
        "dist/**",
        "generated/**",
      ]),
  }),
  publisher: z.strictObject({
    stateDir: z.string(),
    previewStagingDir: z.string(),
    releaseStagingDir: z.string(),
    cleanBuild: z.literal(true).default(true),
  }),
  publicViews: z
    .strictObject({ roots: z.array(z.string()).default(["public-views"]) })
    .default({ roots: ["public-views"] }),
  mdx: z
    .strictObject({
      enabled: z.boolean().default(false),
      componentRoots: z.array(z.string()).default(["public-components"]),
      dataRoots: z.array(z.string()).default(["public-data"]),
      image: z.string().min(1).default("wikai-mdx:local"),
      maxProfileBytes: z
        .number()
        .int()
        .positive()
        .default(5 * 1024 * 1024),
    })
    .default({
      enabled: false,
      componentRoots: ["public-components"],
      dataRoots: ["public-data"],
      image: "wikai-mdx:local",
      maxProfileBytes: 5 * 1024 * 1024,
    }),
  assets: z
    .strictObject({
      roots: z.array(z.string()).default(["assets", "public-assets"]),
      maxFileBytes: z.number().positive().default(52428800),
      rejectSymlinks: z.literal(true).default(true),
      stripImageMetadata: z.literal(true).default(true),
      reviewedHashes: z.array(z.string()).default([]),
    })
    .default({
      roots: ["assets", "public-assets"],
      maxFileBytes: 52428800,
      rejectSymlinks: true,
      stripImageMetadata: true,
      reviewedHashes: [],
    }),
  security: z
    .strictObject({
      denyPatterns: z.array(z.string()).default(["PRIVATE_SENTINEL_[A-Z0-9_]+"]),
      scanPrivateIdsInDist: z.literal(true).default(true),
      scanPrivatePathsInDist: z.literal(true).default(true),
      warnPrivateTitles: z.boolean().optional(),
      scanPii: z.boolean().optional(),
      scanHighEntropy: z.boolean().optional(),
    })
    .default({
      denyPatterns: ["PRIVATE_SENTINEL_[A-Z0-9_]+"],
      scanPrivateIdsInDist: true,
      scanPrivatePathsInDist: true,
    }),
  review: z
    .strictObject({
      warnAfterDays: z
        .strictObject({
          work: z.number().int().nonnegative().optional(),
          knowledge: z.number().int().nonnegative().optional(),
          log: z.number().int().nonnegative().optional(),
          page: z.number().int().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
  deployments: z.record(DeploymentNameSchema, DirectoryDeploymentSchema).optional(),
  renderer: RendererSchema.default({ profile: "astro", protocolVersion: 1 }),
  site: z.strictObject({
    sourceDir: z.string(),
    distDir: z.string(),
    url: z.url().default("https://example.invalid"),
    isolatedBuild: z.literal(true).default(true),
    network: z.literal("disabled").default("disabled"),
    image: z.string().default("wikai-site:local"),
  }),
  defaults: z
    .strictObject({
      work: VisibilitySchema.default({ listed: true, index: true, feed: true }),
      knowledge: VisibilitySchema.default({ listed: true, index: true, feed: true }),
      log: VisibilitySchema.default({ listed: true, index: false, feed: true }),
      page: VisibilitySchema.default({ listed: false, index: true, feed: false }),
    })
    .default({
      work: { listed: true, index: true, feed: true },
      knowledge: { listed: true, index: true, feed: true },
      log: { listed: true, index: false, feed: true },
      page: { listed: false, index: true, feed: false },
    }),
});
type ParsedPublisherConfig = z.infer<typeof ConfigSchema>;
export type PublisherConfig = Omit<ParsedPublisherConfig, "mdx" | "renderer"> & {
  readonly mdx?: ParsedPublisherConfig["mdx"];
  readonly renderer?: ParsedPublisherConfig["renderer"];
};

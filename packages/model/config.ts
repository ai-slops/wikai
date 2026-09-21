import { z } from "zod";

const VisibilitySchema = z.object({ listed: z.boolean(), index: z.boolean(), feed: z.boolean() });
export const ConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  vault: z.object({
    root: z.string(),
    include: z.array(z.string()).default(["**/*.md"]),
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
  publisher: z.object({
    stateDir: z.string(),
    previewStagingDir: z.string(),
    releaseStagingDir: z.string(),
    cleanBuild: z.literal(true).default(true),
  }),
  publicViews: z
    .object({ roots: z.array(z.string()).default(["public-views"]) })
    .default({ roots: ["public-views"] }),
  assets: z
    .object({
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
    .object({
      denyPatterns: z.array(z.string()).default(["PRIVATE_SENTINEL_[A-Z0-9_]+"]),
      scanPrivateIdsInDist: z.literal(true).default(true),
      scanPrivatePathsInDist: z.literal(true).default(true),
    })
    .default({
      denyPatterns: ["PRIVATE_SENTINEL_[A-Z0-9_]+"],
      scanPrivateIdsInDist: true,
      scanPrivatePathsInDist: true,
    }),
  site: z.object({
    sourceDir: z.string(),
    distDir: z.string(),
    url: z.url().default("https://example.invalid"),
    isolatedBuild: z.literal(true).default(true),
    network: z.literal("disabled").default("disabled"),
    image: z.string().default("wikai-site:local"),
  }),
  defaults: z
    .object({
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
export type PublisherConfig = z.infer<typeof ConfigSchema>;

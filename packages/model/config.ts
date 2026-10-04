import { z } from "zod";

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
export const ConfigSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  vault: z.strictObject({
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
  publisher: z.strictObject({
    stateDir: z.string(),
    previewStagingDir: z.string(),
    releaseStagingDir: z.string(),
    cleanBuild: z.literal(true).default(true),
  }),
  publicViews: z
    .strictObject({ roots: z.array(z.string()).default(["public-views"]) })
    .default({ roots: ["public-views"] }),
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
export type PublisherConfig = z.infer<typeof ConfigSchema>;

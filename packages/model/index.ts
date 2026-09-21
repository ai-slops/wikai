import { z } from "zod";

export const KindSchema = z.enum(["work", "knowledge", "log", "page"]);
export type PublicKind = z.infer<typeof KindSchema>;
export const SourceSchema = z.object({
  id: z.string(),
  anchor: z.string().optional(),
  capturedHash: z.string().optional(),
  note: z.string().optional(),
});
export const WorkSchema = z.object({
  role: z.string().optional(),
  projectStatus: z.enum(["active", "completed", "paused", "archived"]).optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  links: z
    .array(
      z.object({
        label: z.string(),
        url: z.string(),
        type: z.enum(["repository", "demo", "documentation", "article", "other"]).optional(),
      }),
    )
    .optional(),
});
export const KnowledgeSchema = z.object({
  documentType: z
    .enum(["topic", "guide", "design", "research", "decision", "reference"])
    .optional(),
  lastVerifiedAt: z.string().optional(),
});
export const LogSchema = z.object({ occurredAt: z.string() });
export const PageSchema = z.object({
  layout: z.enum(["home", "about", "now", "contact", "generic"]).optional(),
  order: z.number().optional(),
});
export const ContentStateSchema = z.enum([
  "draft",
  "active",
  "stable",
  "needs-review",
  "deprecated",
  "archived",
]);
export const PublicSpecSchema = z.object({
  id: z.string().regex(/^pub_[A-Za-z0-9_-]+$/),
  status: z.enum(["candidate", "review", "published", "withdrawn"]),
  mode: z.enum(["mirror", "projection"]),
  kind: KindSchema,
  slug: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  listed: z.boolean().optional(),
  index: z.boolean().optional(),
  feed: z.boolean().optional(),
  featured: z.boolean().default(false),
  contentState: ContentStateSchema.optional(),
  canonical: z.string().optional(),
  sources: z.array(SourceSchema).default([]),
  work: WorkSchema.optional(),
  knowledge: KnowledgeSchema.optional(),
  log: LogSchema.optional(),
  page: PageSchema.optional(),
});
export type PublicSpec = z.infer<typeof PublicSpecSchema>;
export const FrontmatterSchema = z
  .object({
    id: z
      .string()
      .regex(/^prv_[A-Za-z0-9_-]+$/)
      .optional(),
    title: z.string().optional(),
    aliases: z.array(z.string()).default([]),
    public: PublicSpecSchema.optional(),
  })
  .passthrough();
export type PrivateFrontmatter = z.infer<typeof FrontmatterSchema>;
export const MetadataSchema = PublicSpecSchema.omit({
  status: true,
  mode: true,
  sources: true,
}).extend({
  slug: z.string(),
  title: z.string(),
  listed: z.boolean(),
  index: z.boolean(),
  feed: z.boolean(),
  publishedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastReviewedAt: z.string().optional(),
  lastVerifiedAt: z.string().optional(),
});
export type PublicMetadata = z.infer<typeof MetadataSchema>;
export const DiagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  sourcePath: z.string().optional(),
  publicId: z.string().optional(),
  sourceRange: z
    .object({
      startLine: z.number(),
      startColumn: z.number(),
      endLine: z.number(),
      endColumn: z.number(),
    })
    .optional(),
  relatedIds: z.array(z.string()).optional(),
  hint: z.string().optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export const AssetSchema = z.object({
  publicPath: z.string(),
  hash: z.string(),
  mime: z.string(),
  bytes: z.number(),
  data: z.string(),
  sourcePath: z.string().optional(),
  reviewed: z.boolean().default(false),
});
export type MaterializedAsset = z.infer<typeof AssetSchema>;
export const LinkSchema = z.object({
  publicId: z.string(),
  slug: z.string(),
  title: z.string(),
  anchor: z.string().optional(),
});
export type PublicLink = z.infer<typeof LinkSchema>;
export const WorkingSchema = z.object({
  publicId: z.string(),
  sourceId: z.string(),
  sourcePath: z.string(),
  sourceHash: z.string(),
  sourceMode: z.enum(["mirror", "projection"]),
  workflowStatus: z.enum(["candidate", "review", "published", "withdrawn"]),
  metadata: MetadataSchema,
  markdown: z.string(),
  html: z.string(),
  outgoingLinks: z.array(LinkSchema),
  assets: z.array(AssetSchema),
  sources: z.array(SourceSchema),
  exposureHash: z.string(),
  diagnostics: z.array(DiagnosticSchema),
});
export type WorkingPublication = z.infer<typeof WorkingSchema>;
export const RevisionSchema = z.object({
  publicId: z.string(),
  revisionHash: z.string(),
  exposureHash: z.string(),
  metadata: MetadataSchema,
  markdown: z.string(),
  html: z.string(),
  outgoingLinks: z.array(LinkSchema),
  assets: z.array(AssetSchema),
  approvedAt: z.string(),
});
export type ApprovedRevision = z.infer<typeof RevisionSchema>;
export type PrivateDocument = {
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly raw: string;
  readonly body: string;
  readonly frontmatter: PrivateFrontmatter;
  readonly headings: readonly { readonly title: string; readonly id: string }[];
};
export type VaultSnapshot = {
  readonly documents: readonly PrivateDocument[];
  readonly diagnostics: readonly Diagnostic[];
};
export type PublicationPlan = {
  readonly publications: readonly WorkingPublication[];
  readonly diagnostics: readonly Diagnostic[];
};
export const RedirectSchema = z.object({
  from: z.string(),
  to: z.string(),
  status: z.literal(301).default(301),
});
export type PublicRedirect = z.infer<typeof RedirectSchema>;
export type ReleaseManifest = {
  readonly schemaVersion: 1;
  readonly pages: readonly PublicMetadata[];
};
export { ConfigSchema, type PublisherConfig } from "./config.ts";
export class PublisherError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PublisherError";
    this.code = code;
  }
}

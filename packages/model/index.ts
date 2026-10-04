import { z } from "zod";
import {
  MetadataSchema,
  PersistedMetadataSchema,
  type PrivateFrontmatter,
  type PublicMetadata,
  SourceSchema,
} from "./publication.ts";

export {
  ContentStateSchema,
  FrontmatterSchema,
  KindSchema,
  KnowledgeSchema,
  LogSchema,
  MetadataSchema,
  PageSchema,
  PersistedMetadataSchema,
  type PrivateFrontmatter,
  type PublicKind,
  type PublicMetadata,
  type PublicSpec,
  PublicSpecSchema,
  type SourceReference,
  SourceSchema,
  type SourceSelection,
  SourceSelectionSchema,
  WorkSchema,
} from "./publication.ts";
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
  metadata: PersistedMetadataSchema,
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
export {
  isCanonicalPublicRoute,
  isFixedPageRoute,
  isRendererRoute,
  type PageLayout,
  publicRouteKey,
  routeMatchesKind,
} from "./routes.ts";
export class PublisherError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PublisherError";
    this.code = code;
  }
}

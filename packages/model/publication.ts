import { z } from "zod";

export const KindSchema = z.enum(["work", "knowledge", "log", "page"]);
export type PublicKind = z.infer<typeof KindSchema>;

export const SourceSelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ version: z.literal(1), kind: z.literal("heading"), value: z.string().min(1) }),
  z.strictObject({ version: z.literal(1), kind: z.literal("block"), value: z.string().min(1) }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("lines"),
    lineCount: z.number().int().positive(),
  }),
]);
export type SourceSelection = Readonly<z.infer<typeof SourceSelectionSchema>>;

export const SourceSchema = z
  .strictObject({
    id: z.string(),
    anchor: z.string().optional(),
    capturedHash: z.string().optional(),
    note: z.string().optional(),
    selection: SourceSelectionSchema.optional(),
  })
  .refine(
    (source) =>
      source.selection === undefined || /^sha256:[a-f0-9]{64}$/u.test(source.capturedHash ?? ""),
    { message: "A versioned selection requires a captured SHA-256 hash", path: ["capturedHash"] },
  );
export type SourceReference = Readonly<z.infer<typeof SourceSchema>>;

const IsoDateSchema = z.iso.date();
const IsoTimestampSchema = z.iso.datetime({ offset: true });
const ProjectStatusSchema = z.enum(["active", "completed", "paused", "archived"]);
const LinkTypeSchema = z.enum(["repository", "demo", "documentation", "article", "other"]);
const DocumentTypeSchema = z.enum([
  "topic",
  "guide",
  "design",
  "research",
  "decision",
  "reference",
]);
const LayoutSchema = z.enum(["home", "about", "now", "contact", "generic"]);

export const WorkSchema = z.strictObject({
  role: z.string().optional(),
  projectStatus: ProjectStatusSchema.optional(),
  startedAt: IsoDateSchema.optional(),
  endedAt: IsoDateSchema.optional(),
  links: z
    .array(
      z.strictObject({
        label: z.string(),
        url: z.string(),
        type: LinkTypeSchema.optional(),
      }),
    )
    .optional(),
});
export const KnowledgeSchema = z.strictObject({
  documentType: DocumentTypeSchema.optional(),
  lastVerifiedAt: IsoDateSchema.optional(),
});
export const LogSchema = z.strictObject({ occurredAt: IsoTimestampSchema });
export const PageSchema = z.strictObject({
  layout: LayoutSchema.optional(),
  order: z.number().optional(),
});

const PersistedWorkSchema = z.object({
  role: z.string().optional(),
  projectStatus: ProjectStatusSchema.optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  links: z
    .array(
      z.object({
        label: z.string(),
        url: z.string(),
        type: LinkTypeSchema.optional(),
      }),
    )
    .optional(),
});
const PersistedKnowledgeSchema = z.object({
  documentType: DocumentTypeSchema.optional(),
  lastVerifiedAt: z.string().optional(),
});
const PersistedLogSchema = z.object({ occurredAt: z.string() });
const PersistedPageSchema = z.object({
  layout: LayoutSchema.optional(),
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
const KindMetadataKeys = ["work", "knowledge", "log", "page"] as const;

const PublicSpecObjectSchema = z.strictObject({
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

export const PublicSpecSchema = PublicSpecObjectSchema.superRefine((spec, context) => {
  for (const key of KindMetadataKeys) {
    if (key !== spec.kind && spec[key] !== undefined) {
      context.addIssue({
        code: "custom",
        message: `The ${key} metadata block does not match publication kind ${spec.kind}`,
        path: [key],
      });
    }
  }
});
export type PublicSpec = z.infer<typeof PublicSpecSchema>;

export const FrontmatterSchema = z.looseObject({
  id: z
    .string()
    .regex(/^prv_[A-Za-z0-9_-]+$/)
    .optional(),
  title: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  public: PublicSpecSchema.optional(),
});
export type PrivateFrontmatter = z.infer<typeof FrontmatterSchema>;

const RequiredMetadataSchema = {
  slug: z.string(),
  title: z.string(),
  listed: z.boolean(),
  index: z.boolean(),
  feed: z.boolean(),
} as const;

export const MetadataSchema = z
  .object(PublicSpecObjectSchema.omit({ status: true, mode: true, sources: true }).shape)
  .extend({
    ...RequiredMetadataSchema,
    publishedAt: IsoTimestampSchema.optional(),
    updatedAt: IsoTimestampSchema.optional(),
    lastReviewedAt: IsoTimestampSchema.optional(),
    lastVerifiedAt: IsoDateSchema.optional(),
  });
export type PublicMetadata = z.infer<typeof MetadataSchema>;

export const PersistedMetadataSchema = z.object({
  id: z.string().regex(/^pub_[A-Za-z0-9_-]+$/),
  kind: KindSchema,
  ...RequiredMetadataSchema,
  summary: z.string().optional(),
  tags: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  contentState: ContentStateSchema.optional(),
  canonical: z.string().optional(),
  work: PersistedWorkSchema.optional(),
  knowledge: PersistedKnowledgeSchema.optional(),
  log: PersistedLogSchema.optional(),
  page: PersistedPageSchema.optional(),
  publishedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastReviewedAt: z.string().optional(),
  lastVerifiedAt: z.string().optional(),
});

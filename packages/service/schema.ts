import { z } from "zod";
import {
  DiagnosticSchema,
  KindSchema,
  KnowledgeSchema,
  LogSchema,
  PageSchema,
  RevisionSchema,
  WorkingSchema,
  WorkSchema,
} from "../model/index.ts";

export const CandidateInputSchema = z.object({
  path: z.string().min(1),
  kind: KindSchema,
  mode: z.enum(["mirror", "projection"]),
  expectedHash: z.string().optional(),
});
export type CandidateInput = z.infer<typeof CandidateInputSchema>;

export const ProjectInputSchema = z.object({
  path: z.string().min(1),
  to: z.string().min(1),
  kind: KindSchema,
  expectedHash: z.string().optional(),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export const LineSelectionSchema = z.union([
  z.string().regex(/^\d+:\d+$/u),
  z.object({ start: z.number().int().positive(), end: z.number().int().positive() }),
]);

export const ExtractInputSchema = ProjectInputSchema.extend({
  heading: z.string().min(1).optional(),
  block: z.string().min(1).optional(),
  lines: LineSelectionSchema.optional(),
}).refine(
  (input) =>
    [input.heading, input.block, input.lines].filter((value) => value !== undefined).length === 1,
  { message: "Choose exactly one extraction selector" },
);
export type ExtractInput = z.infer<typeof ExtractInputSchema>;

export const MetadataPatchSchema = z
  .object({
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    listed: z.boolean().optional(),
    index: z.boolean().optional(),
    feed: z.boolean().optional(),
    featured: z.boolean().optional(),
    contentState: z
      .enum(["draft", "active", "stable", "needs-review", "deprecated", "archived"])
      .optional(),
    canonical: z.string().optional(),
    work: WorkSchema.optional(),
    knowledge: KnowledgeSchema.optional(),
    log: LogSchema.optional(),
    page: PageSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "Metadata patch is empty" });
export type MetadataPatch = z.infer<typeof MetadataPatchSchema>;

export const PublicationStatusSchema = z.enum([
  "private",
  "candidate",
  "review",
  "published",
  "update-available",
  "blocked",
  "withdrawn",
  "orphaned",
  "source-drift",
]);

export const StatusRowSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  slug: z.string(),
  kind: KindSchema,
  status: PublicationStatusSchema,
  exposureHash: z.string().nullable(),
  approvedHash: z.string().nullable(),
  sourcePath: z.string().nullable(),
  diagnostics: z.array(DiagnosticSchema),
  sourceDrift: z.boolean(),
});
export type StatusRow = z.infer<typeof StatusRowSchema>;

export const StatusSchema = z.object({
  publications: z.array(StatusRowSchema),
  diagnostics: z.array(DiagnosticSchema),
});
export type PublisherStatus = z.infer<typeof StatusSchema>;

export const DetailSchema = z.object({
  working: WorkingSchema.nullable(),
  approved: RevisionSchema.nullable(),
  history: z.array(RevisionSchema),
  sourceDrift: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
});
export type PublicationDetail = z.infer<typeof DetailSchema>;

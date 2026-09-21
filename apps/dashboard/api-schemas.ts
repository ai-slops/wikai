import { z } from "zod";
import { KindSchema } from "../../packages/model/index.ts";
import { MetadataPatchSchema } from "../../packages/service/schema.ts";

export const PublicIdSchema = z.string().regex(/^pub_[A-Za-z0-9_-]+$/);
export const HashSchema = z.string().min(1).max(256);
export const ModeSchema = z.enum(["working", "approved"]);

export const ApproveSchema = z.object({ expectedHash: HashSchema }).strict();
export const WithdrawSchema = z
  .object({ expectedHash: HashSchema, redirect: z.string().min(1).max(512).optional() })
  .strict();
export const CandidateSchema = z
  .object({
    path: z.string().min(1).max(4096),
    kind: KindSchema,
    mode: z.enum(["mirror", "projection"]),
    expectedHash: HashSchema.optional(),
  })
  .strict();
export const ProjectSchema = z
  .object({
    path: z.string().min(1).max(4096),
    to: z.string().min(1).max(4096),
    kind: KindSchema,
    expectedHash: HashSchema.optional(),
  })
  .strict();
export const ExtractSchema = ProjectSchema.extend({
  heading: z.string().min(1).max(512).optional(),
  block: z.string().min(1).max(512).optional(),
  lines: z
    .string()
    .regex(/^\d+:\d+$/)
    .optional(),
}).refine((value) => [value.heading, value.block, value.lines].filter(Boolean).length === 1, {
  message: "Choose exactly one extraction selector: heading, block, or lines",
});
export const RestoreSchema = z
  .object({ revisionHash: HashSchema, expectedHash: HashSchema })
  .strict();
export const MetadataUpdateSchema = z
  .object({ expectedHash: HashSchema, patch: MetadataPatchSchema })
  .strict();

export type CandidateInput = z.infer<typeof CandidateSchema>;
export type ProjectInput = z.infer<typeof ProjectSchema>;
export type ExtractInput = z.infer<typeof ExtractSchema>;

import { z } from "zod";
import { TagListSchema, TagMatchModeSchema, TagPathSchema } from "../model/index.ts";

export const TagFilterInputSchema = z.strictObject({
  tags: TagListSchema.min(1),
  mode: TagMatchModeSchema.default("exact"),
});
export type TagFilterInput = z.input<typeof TagFilterInputSchema>;

export const TagRenameInputSchema = z.strictObject({
  from: TagPathSchema,
  to: TagPathSchema,
  mode: TagMatchModeSchema.default("exact"),
});
export type TagRenameInput = z.input<typeof TagRenameInputSchema>;

export const TagRenameApplySchema = TagRenameInputSchema.extend({
  expectedHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});
export type TagRenameApply = z.input<typeof TagRenameApplySchema>;

export type TaggedDocument = {
  readonly publicId: string;
  readonly title: string;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly tags: readonly string[];
};

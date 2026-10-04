import { z } from "zod";

export const SourceUpdateInputSchema = z
  .strictObject({
    sourceId: z.string().regex(/^prv_[A-Za-z0-9_-]+$/u),
    referenceIndex: z.number().int().nonnegative().optional(),
    heading: z.string().min(1).optional(),
    block: z.string().min(1).optional(),
    lines: z
      .string()
      .regex(/^\d+:\d+$/u)
      .optional(),
  })
  .refine(
    (input) =>
      [input.heading, input.block, input.lines].filter((value) => value !== undefined).length <= 1,
    { message: "Choose at most one source selector" },
  );
export const SourceUpdateApplySchema = SourceUpdateInputSchema.safeExtend({
  expectedHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  body: z.string().max(2 * 1024 * 1024),
});
export type SourceUpdateInput = z.infer<typeof SourceUpdateInputSchema>;
export type SourceUpdateApply = z.infer<typeof SourceUpdateApplySchema>;

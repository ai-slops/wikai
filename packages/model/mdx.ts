import { z } from "zod";

const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const MdxFileSchema = z.strictObject({
  path: z.string().min(1),
  hash: HashSchema,
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  data: z.string(),
});

export const MdxSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  contentInputHash: HashSchema,
  profileDigest: HashSchema,
  runtime: z.strictObject({
    image: z.string().min(1),
    imageId: HashSchema.optional(),
    lockHash: HashSchema.optional(),
    runtimeHash: HashSchema.optional(),
  }),
  identity: z
    .strictObject({
      sourcePath: z.string().min(1),
      componentRoots: z.array(z.string()),
      dataRoots: z.array(z.string()),
    })
    .optional(),
  dependencies: z.array(MdxFileSchema),
  artifact: z.strictObject({
    html: MdxFileSchema,
    scripts: z.array(MdxFileSchema).min(1),
    styles: z.array(MdxFileSchema),
  }),
});

export type MdxFile = z.infer<typeof MdxFileSchema>;
export type MdxSnapshot = z.infer<typeof MdxSnapshotSchema>;

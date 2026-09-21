import { z } from "zod";
import { RedirectSchema, RevisionSchema, SourceSchema } from "../model/index.ts";

export const StatePublicIdSchema = z.string().regex(/^pub_[A-Za-z0-9_-]+$/u);
export const StateHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const InternalPathSchema = z.string().superRefine((value, context) => {
  if (
    !value.startsWith("/") ||
    (value.length > 1 && value.endsWith("/")) ||
    /[?#\\]/u.test(value) ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    }) ||
    /%2e|%2f|%5c/iu.test(value) ||
    (value !== "/" &&
      value
        .slice(1)
        .split("/")
        .some((segment) => segment.length === 0 || [".", ".."].includes(segment)))
  ) {
    context.addIssue({ code: "custom", message: "Invalid internal public path" });
  }
});

export const StoredRevisionSchema = RevisionSchema.extend({
  publicId: StatePublicIdSchema,
  revisionHash: StateHashSchema,
  exposureHash: StateHashSchema,
  integrityHash: StateHashSchema,
});

export type StoredRevision = z.infer<typeof StoredRevisionSchema>;

export const PublicationStateSchema = z
  .object({
    sourceId: z.string(),
    sourcePath: z.string(),
    sourceMode: z.enum(["mirror", "projection"]),
    activeRevisionHash: StateHashSchema.nullable(),
    activeSourceHash: StateHashSchema.nullable(),
    activeSources: z.array(SourceSchema),
    latestExposureHash: StateHashSchema,
    revisionHashes: z.array(StateHashSchema),
    revisionSourceHashes: z.record(StateHashSchema, StateHashSchema),
    revisionSources: z.record(StateHashSchema, z.array(SourceSchema)),
    reservedSlugs: z.array(InternalPathSchema),
    withdrawalFrom: InternalPathSchema.optional(),
    withdrawalRedirect: InternalPathSchema.optional(),
  })
  .superRefine((entry, context) => {
    if (
      entry.activeRevisionHash !== null &&
      !entry.revisionHashes.includes(entry.activeRevisionHash)
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeRevisionHash"],
        message: "Active revision must belong to history",
      });
    }
    for (const revisionHash of entry.revisionHashes) {
      if (
        !(revisionHash in entry.revisionSourceHashes) ||
        !(revisionHash in entry.revisionSources)
      ) {
        context.addIssue({
          code: "custom",
          path: ["revisionHashes"],
          message: "Revision metadata is incomplete",
        });
      }
    }
  });

export type PublicationState = z.infer<typeof PublicationStateSchema>;
export type SourceIdentity = Pick<PublicationState, "sourceId" | "sourcePath" | "sourceMode">;

export const StateDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  publications: z.record(StatePublicIdSchema, PublicationStateSchema),
});

export type StateDocument = z.infer<typeof StateDocumentSchema>;

export const StateSnapshotSchema = z.object({
  approved: z.array(RevisionSchema),
  redirects: z.array(RedirectSchema),
});

export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

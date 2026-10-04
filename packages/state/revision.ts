import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWrite, hash, readOptional, safePath } from "../fs/index.ts";
import type { ApprovedRevision, WorkingPublication } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import { type StoredRevision, StoredRevisionSchema } from "./schema.ts";

const RevisionIntegritySchema = z.looseObject({
  publicId: z.string(),
  revisionHash: z.string(),
  exposureHash: z.string(),
  metadata: z.looseObject({ id: z.string() }),
  markdown: z.string(),
  html: z.string(),
  outgoingLinks: z.array(z.unknown()),
  assets: z.array(z.unknown()),
  approvedAt: z.string(),
  integrityHash: z.string(),
});

type RevisionContentInput = {
  readonly publicId: string;
  readonly exposureHash: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly markdown: string;
  readonly html: string;
  readonly outgoingLinks: readonly unknown[];
  readonly assets: readonly unknown[];
};

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input)
          .filter((entry) => entry[1] !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value)) ?? "null";
}

function canonicalRevisionContent(revision: RevisionContentInput): string {
  const {
    publishedAt: _publishedAt,
    updatedAt: _updatedAt,
    lastReviewedAt: _lastReviewedAt,
    lastVerifiedAt: _lastVerifiedAt,
    ...metadata
  } = revision.metadata;
  return canonicalJson({
    publicId: revision.publicId,
    exposureHash: revision.exposureHash,
    metadata,
    markdown: revision.markdown,
    html: revision.html,
    outgoingLinks: revision.outgoingLinks,
    assets: revision.assets,
  });
}

export function revisionContent(revision: ApprovedRevision): string {
  return canonicalRevisionContent(revision);
}

export function createRevision(
  working: WorkingPublication,
  timestamps: { readonly publishedAt?: string; readonly isUpdate: boolean },
): StoredRevision {
  const approvedAt = new Date().toISOString();
  const publishedAt = timestamps.publishedAt ?? approvedAt;
  const draft: ApprovedRevision = {
    publicId: working.publicId,
    revisionHash: "",
    exposureHash: working.exposureHash,
    metadata: {
      ...working.metadata,
      publishedAt,
      ...(timestamps.isUpdate ? { updatedAt: approvedAt } : {}),
    },
    markdown: working.markdown,
    html: working.html,
    outgoingLinks: working.outgoingLinks,
    assets: working.assets,
    approvedAt,
  };
  const revisionHash = hash(revisionContent(draft));
  const revision = { ...draft, revisionHash };
  return { ...revision, integrityHash: hash(canonicalJson(revision)) };
}

export async function readRevision(
  stateDir: string,
  publicId: string,
  revisionHash: string,
): Promise<StoredRevision> {
  const path = await safePath(stateDir, join("revisions", publicId, `${revisionHash}.json`));
  const raw = await readOptional(path);
  if (raw === undefined) {
    throw new PublisherError("REVISION_NOT_FOUND", "The requested approved revision was not found");
  }
  return decodeRevision(raw, publicId, revisionHash);
}

export function decodeRevision(
  raw: string,
  publicId: string,
  revisionHash: string,
): StoredRevision {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new PublisherError("REVISION_INTEGRITY_FAILURE", "Approved revision data is invalid");
    }
    throw error;
  }
  const integrityEnvelope = RevisionIntegritySchema.safeParse(decoded);
  if (!integrityEnvelope.success) {
    throw new PublisherError("REVISION_INTEGRITY_FAILURE", "Approved revision data is invalid");
  }
  if (
    integrityEnvelope.data.publicId !== publicId ||
    integrityEnvelope.data.metadata.id !== publicId ||
    integrityEnvelope.data.revisionHash !== revisionHash
  ) {
    throw new PublisherError(
      "REVISION_INTEGRITY_FAILURE",
      "Approved revision coordinates do not match its content",
    );
  }
  const { integrityHash, ...revision } = integrityEnvelope.data;
  if (
    hash(canonicalJson(revision)) !== integrityHash ||
    hash(canonicalRevisionContent(revision)) !== revision.revisionHash
  ) {
    throw new PublisherError(
      "REVISION_INTEGRITY_FAILURE",
      "Approved revision integrity check failed",
    );
  }
  const stored = StoredRevisionSchema.safeParse(integrityEnvelope.data);
  if (!stored.success) {
    throw new PublisherError("REVISION_INTEGRITY_FAILURE", "Approved revision data is invalid");
  }
  return stored.data;
}

export async function writeRevision(stateDir: string, revision: StoredRevision): Promise<void> {
  const directory = join(stateDir, "revisions", revision.publicId);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${revision.revisionHash}.json`);
  const existing = await readOptional(path);
  if (existing !== undefined) {
    await readRevision(stateDir, revision.publicId, revision.revisionHash);
    return;
  }
  await atomicWrite(path, `${JSON.stringify(revision, null, 2)}\n`);
}

export function publicRevision(stored: StoredRevision): ApprovedRevision {
  const { integrityHash: _, ...revision } = stored;
  return revision;
}

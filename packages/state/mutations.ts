import { withLock } from "../fs/index.ts";
import type { ApprovedRevision, WorkingPublication } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import { markInitialized, readStateSnapshot, writeStateDocument } from "./document.ts";
import { assertRevisionNamesAvailable, assertWorkingNamesAvailable } from "./reservations.ts";
import { createRevision, publicRevision, readRevision, writeRevision } from "./revision.ts";
import { InternalPathSchema, type PublicationState } from "./schema.ts";

export type ApprovalCapture = {
  readonly working: WorkingPublication;
  readonly sourceHash: string;
  readonly sources: WorkingPublication["sources"];
};

type ApprovalInput = {
  readonly stateDir: string;
  readonly working: WorkingPublication;
  readonly expectedHash: string;
  readonly capture?: () => Promise<ApprovalCapture>;
};

export async function approvePublication(input: ApprovalInput): Promise<ApprovedRevision> {
  const { working, expectedHash } = input;
  if (working.exposureHash !== expectedHash) {
    throw new PublisherError("STALE_EXPOSURE_HASH", "The publication changed before approval");
  }
  if (working.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new PublisherError("PUBLICATION_BLOCKED", "A blocked publication cannot be approved");
  }
  return withLock(input.stateDir, async () => {
    const { document, expectedHash: stateHash } = await readStateSnapshot(input.stateDir);
    const captured =
      input.capture === undefined
        ? { working, sourceHash: working.sourceHash, sources: working.sources }
        : await input.capture();
    const current = captured.working;
    if (current.publicId !== working.publicId || current.exposureHash !== expectedHash) {
      throw new PublisherError("STALE_EXPOSURE_HASH", "The publication changed before approval");
    }
    if (current.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      throw new PublisherError("PUBLICATION_BLOCKED", "A blocked publication cannot be approved");
    }
    const previous = document.publications[current.publicId];
    if (previous !== undefined && previous.sourceId !== current.sourceId) {
      throw new PublisherError(
        "PUBLIC_ID_COLLISION",
        "The public identifier is reserved by another private source",
      );
    }
    assertWorkingNamesAvailable(document, current);
    const firstRevisionHash = previous?.revisionHashes[0];
    const firstRevision =
      firstRevisionHash === undefined
        ? undefined
        : await readRevision(input.stateDir, current.publicId, firstRevisionHash);
    const candidate = createRevision(current, {
      ...(firstRevision?.metadata.publishedAt === undefined
        ? {}
        : { publishedAt: firstRevision.metadata.publishedAt }),
      isUpdate: firstRevision !== undefined,
    });
    await markInitialized(input.stateDir);
    await writeRevision(input.stateDir, candidate);
    const existing = await readRevision(input.stateDir, candidate.publicId, candidate.revisionHash);
    const revisionHashes = previous?.revisionHashes.includes(candidate.revisionHash)
      ? previous.revisionHashes
      : [...(previous?.revisionHashes ?? []), candidate.revisionHash];
    document.publications[current.publicId] = {
      sourceId: current.sourceId,
      sourcePath: current.sourcePath,
      sourceMode: current.sourceMode,
      activeRevisionHash: candidate.revisionHash,
      activeSourceHash: captured.sourceHash,
      activeSources: [...captured.sources],
      latestExposureHash: candidate.exposureHash,
      revisionHashes,
      revisionSourceHashes: {
        ...(previous?.revisionSourceHashes ?? {}),
        [candidate.revisionHash]: captured.sourceHash,
      },
      revisionSources: {
        ...(previous?.revisionSources ?? {}),
        [candidate.revisionHash]: [...captured.sources],
      },
      reservedSlugs: Array.from(
        new Set([
          ...(previous?.reservedSlugs ?? []),
          current.metadata.slug,
          ...current.metadata.aliases,
        ]),
      ),
      lastReviewedAt: new Date().toISOString(),
      ...(previous?.lastDeployedRevision === undefined
        ? {}
        : { lastDeployedRevision: previous.lastDeployedRevision }),
    };
    await writeStateDocument(input.stateDir, document, stateHash);
    return publicRevision(existing);
  });
}

type WithdrawalInput = {
  readonly stateDir: string;
  readonly publicId: string;
  readonly expectedHash: string;
  readonly redirect?: string;
};

export async function withdrawPublication(input: WithdrawalInput): Promise<void> {
  if (input.redirect !== undefined && !InternalPathSchema.safeParse(input.redirect).success) {
    throw new PublisherError(
      "INVALID_REDIRECT",
      "Withdrawal redirect must be a canonical internal path",
    );
  }
  await withLock(input.stateDir, async () => {
    const { document, expectedHash: stateHash } = await readStateSnapshot(input.stateDir);
    const entry = document.publications[input.publicId];
    if (entry === undefined || entry.activeRevisionHash === null) {
      throw new PublisherError("PUBLICATION_NOT_APPROVED", "The publication is not approved");
    }
    const revision = await readRevision(input.stateDir, input.publicId, entry.activeRevisionHash);
    if (revision.exposureHash !== input.expectedHash) {
      throw new PublisherError("STALE_EXPOSURE_HASH", "The approved publication changed");
    }
    const next: PublicationState = {
      ...entry,
      activeRevisionHash: null,
      activeSourceHash: null,
      activeSources: [],
      withdrawalFrom: revision.metadata.slug,
      ...(input.redirect === undefined ? {} : { withdrawalRedirect: input.redirect }),
    };
    document.publications[input.publicId] = next;
    await writeStateDocument(input.stateDir, document, stateHash);
  });
}

type RestoreInput = {
  readonly stateDir: string;
  readonly publicId: string;
  readonly revisionHash: string;
  readonly expectedHash: string;
};

export async function restorePublication(input: RestoreInput): Promise<ApprovedRevision> {
  return withLock(input.stateDir, async () => {
    const { document, expectedHash: stateHash } = await readStateSnapshot(input.stateDir);
    const entry = document.publications[input.publicId];
    if (entry === undefined || !entry.revisionHashes.includes(input.revisionHash)) {
      throw new PublisherError(
        "REVISION_NOT_FOUND",
        "The requested approved revision was not found",
      );
    }
    const revision = await readRevision(input.stateDir, input.publicId, input.revisionHash);
    if (entry.latestExposureHash !== input.expectedHash) {
      throw new PublisherError("STALE_EXPOSURE_HASH", "The requested revision hash is stale");
    }
    assertRevisionNamesAvailable(document, input.publicId, revision);
    const { withdrawalFrom: _from, withdrawalRedirect: _redirect, ...retained } = entry;
    document.publications[input.publicId] = {
      ...retained,
      activeRevisionHash: input.revisionHash,
      activeSourceHash: entry.revisionSourceHashes[input.revisionHash] ?? null,
      activeSources: entry.revisionSources[input.revisionHash] ?? null,
      latestExposureHash: revision.exposureHash,
      lastReviewedAt: new Date().toISOString(),
    };
    await writeStateDocument(input.stateDir, document, stateHash);
    return publicRevision(revision);
  });
}

export async function recordDeployment(
  stateDir: string,
  revisions: Readonly<Record<string, string>>,
  mode: "active" | "history" = "active",
): Promise<void> {
  await withLock(stateDir, async () => {
    const { document, expectedHash } = await readStateSnapshot(stateDir);
    if (mode === "active") {
      const active = Object.fromEntries(
        Object.entries(document.publications).flatMap(([publicId, entry]) =>
          entry.activeRevisionHash === null ? [] : [[publicId, entry.activeRevisionHash]],
        ),
      );
      const activeEntries = Object.entries(active).sort(([left], [right]) =>
        left.localeCompare(right),
      );
      const revisionEntries = Object.entries(revisions).sort(([left], [right]) =>
        left.localeCompare(right),
      );
      if (JSON.stringify(activeEntries) !== JSON.stringify(revisionEntries)) {
        throw new PublisherError(
          "DEPLOYMENT_STATE_CHANGED",
          "Active publication state changed before deployment bookkeeping",
        );
      }
    }
    for (const [publicId, revisionHash] of Object.entries(revisions)) {
      const entry = document.publications[publicId];
      if (entry === undefined || !entry.revisionHashes.includes(revisionHash)) {
        throw new PublisherError(
          "DEPLOYMENT_STATE_CHANGED",
          "Deployment revision state changed before bookkeeping",
        );
      }
    }
    for (const [publicId, entry] of Object.entries(document.publications)) {
      const revisionHash = revisions[publicId];
      if (revisionHash === undefined) {
        const { lastDeployedRevision: _lastDeployedRevision, ...retained } = entry;
        document.publications[publicId] = retained;
      } else {
        document.publications[publicId] = { ...entry, lastDeployedRevision: revisionHash };
      }
    }
    await writeStateDocument(stateDir, document, expectedHash);
  });
}

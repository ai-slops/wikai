import { withLock } from "../fs/index.ts";
import type { ApprovedRevision, PublicRedirect, WorkingPublication } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import { readStateDocument, writeStateDocument } from "./document.ts";
import { assertRevisionNamesAvailable, assertWorkingNamesAvailable } from "./reservations.ts";
import { createRevision, publicRevision, readRevision, writeRevision } from "./revision.ts";
import {
  InternalPathSchema,
  type PublicationState,
  type SourceIdentity,
  type StateSnapshot,
} from "./schema.ts";

type ApprovalCapture = {
  readonly working: WorkingPublication;
  readonly sourceHash: string;
  readonly sources: WorkingPublication["sources"];
};

export class PublisherState {
  private readonly stateDir: string;

  private constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  static async open(stateDir: string): Promise<PublisherState> {
    const state = new PublisherState(stateDir);
    await readStateDocument(stateDir);
    return state;
  }

  async approve(
    working: WorkingPublication,
    expectedHash: string,
    capture?: () => Promise<ApprovalCapture>,
  ): Promise<ApprovedRevision> {
    if (working.exposureHash !== expectedHash) {
      throw new PublisherError("STALE_EXPOSURE_HASH", "The publication changed before approval");
    }
    if (working.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      throw new PublisherError("PUBLICATION_BLOCKED", "A blocked publication cannot be approved");
    }
    return withLock(this.stateDir, async () => {
      const document = await readStateDocument(this.stateDir);
      const captured =
        capture === undefined
          ? { working, sourceHash: working.sourceHash, sources: working.sources }
          : await capture();
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
          : await readRevision(this.stateDir, current.publicId, firstRevisionHash);
      const candidate = createRevision(current, {
        ...(firstRevision?.metadata.publishedAt === undefined
          ? {}
          : { publishedAt: firstRevision.metadata.publishedAt }),
        isUpdate: firstRevision !== undefined,
      });
      await writeRevision(this.stateDir, candidate);
      const existing = await readRevision(
        this.stateDir,
        candidate.publicId,
        candidate.revisionHash,
      );
      const revisionHashes = previous?.revisionHashes.includes(candidate.revisionHash)
        ? previous.revisionHashes
        : [...(previous?.revisionHashes ?? []), candidate.revisionHash];
      const reservedSlugs = Array.from(
        new Set([
          ...(previous?.reservedSlugs ?? []),
          current.metadata.slug,
          ...current.metadata.aliases,
        ]),
      );
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
        reservedSlugs,
      };
      await writeStateDocument(this.stateDir, document);
      return publicRevision(existing);
    });
  }

  async withdraw(publicId: string, expectedHash: string, redirect?: string): Promise<void> {
    if (redirect !== undefined && !InternalPathSchema.safeParse(redirect).success) {
      throw new PublisherError(
        "INVALID_REDIRECT",
        "Withdrawal redirect must be a canonical internal path",
      );
    }
    await withLock(this.stateDir, async () => {
      const document = await readStateDocument(this.stateDir);
      const entry = document.publications[publicId];
      if (entry === undefined || entry.activeRevisionHash === null) {
        throw new PublisherError("PUBLICATION_NOT_APPROVED", "The publication is not approved");
      }
      const revision = await readRevision(this.stateDir, publicId, entry.activeRevisionHash);
      if (revision.exposureHash !== expectedHash) {
        throw new PublisherError("STALE_EXPOSURE_HASH", "The approved publication changed");
      }
      const next: PublicationState = {
        sourceId: entry.sourceId,
        sourcePath: entry.sourcePath,
        sourceMode: entry.sourceMode,
        activeRevisionHash: null,
        activeSourceHash: null,
        activeSources: [],
        latestExposureHash: entry.latestExposureHash,
        revisionHashes: entry.revisionHashes,
        revisionSourceHashes: entry.revisionSourceHashes,
        revisionSources: entry.revisionSources,
        reservedSlugs: entry.reservedSlugs,
        withdrawalFrom: revision.metadata.slug,
        ...(redirect === undefined ? {} : { withdrawalRedirect: redirect }),
      };
      document.publications[publicId] = next;
      await writeStateDocument(this.stateDir, document);
    });
  }

  async restore(
    publicId: string,
    revisionHash: string,
    expectedHash: string,
  ): Promise<ApprovedRevision> {
    return withLock(this.stateDir, async () => {
      const document = await readStateDocument(this.stateDir);
      const entry = document.publications[publicId];
      if (entry === undefined || !entry.revisionHashes.includes(revisionHash)) {
        throw new PublisherError(
          "REVISION_NOT_FOUND",
          "The requested approved revision was not found",
        );
      }
      const revision = await readRevision(this.stateDir, publicId, revisionHash);
      if (entry.latestExposureHash !== expectedHash) {
        throw new PublisherError("STALE_EXPOSURE_HASH", "The requested revision hash is stale");
      }
      assertRevisionNamesAvailable(document, publicId, revision);
      document.publications[publicId] = {
        sourceId: entry.sourceId,
        sourcePath: entry.sourcePath,
        sourceMode: entry.sourceMode,
        activeRevisionHash: revisionHash,
        activeSourceHash: entry.revisionSourceHashes[revisionHash] ?? null,
        activeSources: entry.revisionSources[revisionHash] ?? [],
        latestExposureHash: revision.exposureHash,
        revisionHashes: entry.revisionHashes,
        revisionSourceHashes: entry.revisionSourceHashes,
        revisionSources: entry.revisionSources,
        reservedSlugs: entry.reservedSlugs,
      };
      await writeStateDocument(this.stateDir, document);
      return publicRevision(revision);
    });
  }

  async approved(publicId: string): Promise<ApprovedRevision | null> {
    const document = await readStateDocument(this.stateDir);
    const active = document.publications[publicId]?.activeRevisionHash;
    if (active === undefined || active === null) return null;
    return publicRevision(await readRevision(this.stateDir, publicId, active));
  }

  async history(publicId: string): Promise<readonly ApprovedRevision[]> {
    const document = await readStateDocument(this.stateDir);
    const hashes = document.publications[publicId]?.revisionHashes ?? [];
    return Promise.all(
      hashes.map(async (revisionHash) =>
        publicRevision(await readRevision(this.stateDir, publicId, revisionHash)),
      ),
    );
  }

  async approvedSourceHash(publicId: string): Promise<string | null> {
    return (
      (await readStateDocument(this.stateDir)).publications[publicId]?.activeSourceHash ?? null
    );
  }

  async approvedSources(publicId: string): Promise<WorkingPublication["sources"]> {
    return (await readStateDocument(this.stateDir)).publications[publicId]?.activeSources ?? [];
  }

  async publicationIds(): Promise<readonly string[]> {
    return Object.keys((await readStateDocument(this.stateDir)).publications).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  async source(publicId: string): Promise<SourceIdentity | null> {
    const entry = (await readStateDocument(this.stateDir)).publications[publicId];
    if (entry === undefined) return null;
    return {
      sourceId: entry.sourceId,
      sourcePath: entry.sourcePath,
      sourceMode: entry.sourceMode,
    };
  }

  async snapshot(): Promise<StateSnapshot> {
    const document = await readStateDocument(this.stateDir);
    const approved: ApprovedRevision[] = [];
    const redirects: PublicRedirect[] = [];
    for (const [publicId, entry] of Object.entries(document.publications)) {
      if (entry.activeRevisionHash !== null) {
        const revision = publicRevision(
          await readRevision(this.stateDir, publicId, entry.activeRevisionHash),
        );
        approved.push(revision);
        for (const alias of revision.metadata.aliases) {
          redirects.push({ from: alias, to: revision.metadata.slug, status: 301 });
        }
      } else if (entry.withdrawalFrom !== undefined && entry.withdrawalRedirect !== undefined) {
        redirects.push({ from: entry.withdrawalFrom, to: entry.withdrawalRedirect, status: 301 });
      }
    }
    return { approved, redirects };
  }
}

export type { StateDocument, StateSnapshot } from "./schema.ts";
export { StateDocumentSchema, StateSnapshotSchema } from "./schema.ts";

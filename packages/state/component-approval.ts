import { withLock } from "../fs/index.ts";
import type { ApprovedRevision, WorkingPublication } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import { markInitialized, readStateSnapshot, writeStateDocument } from "./document.ts";
import { assertWorkingNamesAvailable } from "./reservations.ts";
import { createRevision, publicRevision, readRevision, writeRevision } from "./revision.ts";

export type ComponentApprovalCapture = {
  readonly working: WorkingPublication;
  readonly sourceHash: string;
  readonly sources: WorkingPublication["sources"];
  readonly expectedActiveRevisionHash: string;
  readonly expectedActiveExposureHash: string;
  readonly expectedDesiredExposureHash: string;
  readonly expectedContentInputHash: string;
  readonly expectedProfileDigest: string;
  readonly expectedSourceHash: string;
};

type ComponentBatchCapture = {
  readonly planHash: string;
  readonly approvals: readonly ComponentApprovalCapture[];
};

type ComponentBatchInput = {
  readonly stateDir: string;
  readonly expectedPlanHash: string;
  readonly capture: (active: readonly ApprovedRevision[]) => Promise<ComponentBatchCapture>;
};

export type ComponentBatchResult = {
  readonly applied: true;
  readonly planHash: string;
  readonly approved: readonly {
    readonly publicId: string;
    readonly revisionHash: string;
    readonly exposureHash: string;
  }[];
};

export async function approveComponentUpdateBatch(
  input: ComponentBatchInput,
): Promise<ComponentBatchResult> {
  return withLock(input.stateDir, async () => {
    const { document, expectedHash: stateHash } = await readStateSnapshot(input.stateDir);
    const active = await Promise.all(
      Object.entries(document.publications).flatMap(([publicId, entry]) =>
        entry.activeRevisionHash === null
          ? []
          : [readRevision(input.stateDir, publicId, entry.activeRevisionHash).then(publicRevision)],
      ),
    );
    const captured = await input.capture(active);
    if (captured.planHash !== input.expectedPlanHash) {
      throw new PublisherError(
        "STALE_COMPONENT_PLAN",
        "Component update candidates changed; inspect a new plan",
      );
    }
    if (captured.approvals.length === 0) {
      return { applied: true, planHash: captured.planHash, approved: [] };
    }
    const prepared = [];
    for (const approval of captured.approvals) {
      const current = approval.working;
      const previous = document.publications[current.publicId];
      if (
        previous === undefined ||
        previous.activeRevisionHash !== approval.expectedActiveRevisionHash
      ) {
        throw new PublisherError(
          "STALE_COMPONENT_PLAN",
          "The active approved revision changed; inspect a new plan",
        );
      }
      const activeRevision = await readRevision(
        input.stateDir,
        current.publicId,
        previous.activeRevisionHash,
      );
      if (activeRevision.exposureHash !== approval.expectedActiveExposureHash) {
        throw new PublisherError(
          "STALE_COMPONENT_PLAN",
          "The active approved exposure changed; inspect a new plan",
        );
      }
      if (
        current.exposureHash !== approval.expectedDesiredExposureHash ||
        current.mdx?.contentInputHash !== approval.expectedContentInputHash ||
        current.mdx.profileDigest !== approval.expectedProfileDigest ||
        approval.sourceHash !== approval.expectedSourceHash
      ) {
        throw new PublisherError(
          "STALE_COMPONENT_PLAN",
          "The desired component update changed; inspect a new plan",
        );
      }
      if (current.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new PublisherError("PUBLICATION_BLOCKED", "A blocked publication cannot be approved");
      }
      if (previous.sourceId !== current.sourceId) {
        throw new PublisherError(
          "PUBLIC_ID_COLLISION",
          "The public identifier is reserved by another private source",
        );
      }
      assertWorkingNamesAvailable(document, current);
      const firstRevisionHash = previous.revisionHashes[0];
      const firstRevision =
        firstRevisionHash === undefined
          ? undefined
          : await readRevision(input.stateDir, current.publicId, firstRevisionHash);
      const revision = createRevision(current, {
        ...(firstRevision?.metadata.publishedAt === undefined
          ? {}
          : { publishedAt: firstRevision.metadata.publishedAt }),
        isUpdate: true,
      });
      const revisionHashes = previous.revisionHashes.includes(revision.revisionHash)
        ? previous.revisionHashes
        : [...previous.revisionHashes, revision.revisionHash];
      document.publications[current.publicId] = {
        ...previous,
        sourcePath: current.sourcePath,
        sourceMode: current.sourceMode,
        activeRevisionHash: revision.revisionHash,
        activeSourceHash: approval.sourceHash,
        activeSources: [...approval.sources],
        latestExposureHash: revision.exposureHash,
        revisionHashes,
        revisionSourceHashes: {
          ...previous.revisionSourceHashes,
          [revision.revisionHash]: approval.sourceHash,
        },
        revisionSources: {
          ...previous.revisionSources,
          [revision.revisionHash]: [...approval.sources],
        },
        reservedSlugs: Array.from(
          new Set([...previous.reservedSlugs, current.metadata.slug, ...current.metadata.aliases]),
        ),
        lastReviewedAt: new Date().toISOString(),
      };
      prepared.push(revision);
    }
    await markInitialized(input.stateDir);
    for (const revision of prepared) await writeRevision(input.stateDir, revision);
    await writeStateDocument(input.stateDir, document, stateHash);
    return {
      applied: true,
      planHash: captured.planHash,
      approved: prepared.map((revision) => ({
        publicId: revision.publicId,
        revisionHash: revision.revisionHash,
        exposureHash: revision.exposureHash,
      })),
    };
  });
}

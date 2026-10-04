import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { deploymentEvidenceInventory } from "../deploy/evidence.ts";
import { hash, withLock } from "../fs/index.ts";
import type { Diagnostic } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import { readStateSnapshot, statePath, writeStateDocument } from "./document.ts";
import { revisionInventory } from "./inventory.ts";
import type { StateDocument } from "./schema.ts";

export type RevisionGcInput = {
  readonly stateDir: string;
  readonly retainHistory: number;
};

type RevisionCoordinate = { readonly publicId: string; readonly revisionHash: string };

function missingRevision(publicId: string): Diagnostic {
  return {
    code: "STATE_REVISION_MISSING",
    severity: "error",
    message: "State history references missing revision evidence",
    publicId,
  };
}

async function prepareRevisionGc(input: RevisionGcInput) {
  if (!Number.isSafeInteger(input.retainHistory) || input.retainHistory < 0) {
    throw new PublisherError(
      "INVALID_HISTORY_COUNT",
      "Revision retention must be a non-negative integer",
    );
  }
  const stateDir = resolve(input.stateDir);
  const { document, expectedHash: stateHash } = await readStateSnapshot(stateDir);
  const inventory = await revisionInventory(stateDir);
  const deploymentInventory = await deploymentEvidenceInventory(stateDir);
  const diagnostics = [...inventory.diagnostics, ...deploymentInventory.diagnostics];
  const available = new Set(
    inventory.revisions.map((revision) => `${revision.publicId}\0${revision.revisionHash}`),
  );
  const retained = new Set<string>();
  for (const revision of deploymentInventory.revisions) {
    const coordinate = `${revision.publicId}\0${revision.revisionHash}`;
    if (!available.has(coordinate)) diagnostics.push(missingRevision(revision.publicId));
    retained.add(coordinate);
  }
  for (const [publicId, entry] of Object.entries(document.publications)) {
    for (const revisionHash of entry.revisionHashes) {
      if (!available.has(`${publicId}\0${revisionHash}`))
        diagnostics.push(missingRevision(publicId));
    }
    const protectedHashes = new Set(
      [entry.activeRevisionHash, entry.lastDeployedRevision].filter(
        (revisionHash): revisionHash is string =>
          revisionHash !== null && revisionHash !== undefined,
      ),
    );
    const history = entry.revisionHashes.filter(
      (revisionHash) => !protectedHashes.has(revisionHash),
    );
    const retainedHistory = input.retainHistory === 0 ? [] : history.slice(-input.retainHistory);
    for (const revisionHash of retainedHistory) protectedHashes.add(revisionHash);
    for (const revisionHash of protectedHashes) retained.add(`${publicId}\0${revisionHash}`);
  }
  const remove = inventory.revisions
    .filter((revision) => !retained.has(`${revision.publicId}\0${revision.revisionHash}`))
    .map(({ publicId, revisionHash }) => ({ publicId, revisionHash }))
    .sort(
      (left, right) =>
        left.publicId.localeCompare(right.publicId) ||
        left.revisionHash.localeCompare(right.revisionHash),
    );
  const report = {
    operation: "revision-gc" as const,
    stateDir,
    retainHistory: input.retainHistory,
    remove,
    diagnostics,
    canApply: !diagnostics.some((item) => item.severity === "error"),
  };
  const planHash = hash(
    JSON.stringify({
      report,
      stateHash,
      inventory: inventory.fingerprint,
      deployments: deploymentInventory.fingerprint,
    }),
  );
  return { report: { ...report, planHash }, document, stateHash };
}

export async function planRevisionGc(input: RevisionGcInput) {
  return (await prepareRevisionGc(input)).report;
}

function pruneState(document: StateDocument, remove: readonly RevisionCoordinate[]): void {
  const removals = new Map<string, Set<string>>();
  for (const item of remove) {
    const hashes = removals.get(item.publicId) ?? new Set<string>();
    hashes.add(item.revisionHash);
    removals.set(item.publicId, hashes);
  }
  for (const [publicId, hashes] of removals) {
    const entry = document.publications[publicId];
    if (entry === undefined) continue;
    document.publications[publicId] = {
      ...entry,
      revisionHashes: entry.revisionHashes.filter((revisionHash) => !hashes.has(revisionHash)),
      revisionSourceHashes: Object.fromEntries(
        Object.entries(entry.revisionSourceHashes).filter(
          ([revisionHash]) => !hashes.has(revisionHash),
        ),
      ),
      revisionSources: Object.fromEntries(
        Object.entries(entry.revisionSources).filter(([revisionHash]) => !hashes.has(revisionHash)),
      ),
    };
  }
}

export async function applyRevisionGc(
  input: RevisionGcInput,
  expectedPlanHash: string,
): Promise<{ readonly applied: true; readonly planHash: string; readonly removed: number }> {
  return withLock(input.stateDir, async () => {
    const prepared = await prepareRevisionGc(input);
    if (prepared.report.planHash !== expectedPlanHash) {
      throw new PublisherError("STALE_STATE_PLAN", "State evidence changed; inspect a new plan");
    }
    if (!prepared.report.canApply) {
      throw new PublisherError(
        "STATE_MAINTENANCE_BLOCKED",
        "Revision garbage collection has unsafe evidence",
      );
    }
    pruneState(prepared.document, prepared.report.remove);
    await writeStateDocument(input.stateDir, prepared.document, prepared.stateHash);
    for (const item of prepared.report.remove) {
      await rm(
        await statePath(
          input.stateDir,
          join("revisions", item.publicId, `${item.revisionHash}.json`),
        ),
      );
    }
    return {
      applied: true,
      planHash: prepared.report.planHash,
      removed: prepared.report.remove.length,
    };
  });
}

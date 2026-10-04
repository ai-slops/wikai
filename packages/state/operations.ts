import { resolve } from "node:path";
import { hash, withLock } from "../fs/index.ts";
import type { Diagnostic } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import { readStateSnapshot, writeStateDocument } from "./document.ts";
import { revisionInventory } from "./inventory.ts";
import { normalizedSlug } from "./reservations.ts";
import { InternalPathSchema } from "./schema.ts";

export { applyRevisionGc, planRevisionGc, type RevisionGcInput } from "./revision-gc.ts";

export type SlugReleaseInput = {
  readonly stateDir: string;
  readonly publicId: string;
  readonly slug: string;
};

function diagnostic(code: string, message: string, publicId?: string): Diagnostic {
  return { code, severity: "error", message, ...(publicId === undefined ? {} : { publicId }) };
}

async function prepareSlugRelease(input: SlugReleaseInput) {
  if (!InternalPathSchema.safeParse(input.slug).success) {
    throw new PublisherError(
      "INVALID_SLUG_RELEASE",
      "Slug release requires a canonical public path",
    );
  }
  const stateDir = resolve(input.stateDir);
  const { document, expectedHash: stateHash } = await readStateSnapshot(stateDir);
  const inventory = await revisionInventory(stateDir);
  const diagnostics = [...inventory.diagnostics];
  const normalized = normalizedSlug(input.slug);
  const owners = Object.entries(document.publications)
    .filter(([, entry]) =>
      entry.reservedSlugs.some((candidate) => normalizedSlug(candidate) === normalized),
    )
    .map(([publicId]) => publicId)
    .sort((left, right) => left.localeCompare(right));
  const ownerId = owners.length === 1 ? owners[0] : null;
  if (owners.length > 1) {
    diagnostics.push(
      diagnostic("SLUG_RESERVATION_CORRUPT", "A slug is reserved by multiple publications"),
    );
  }
  const revisions = new Map(
    inventory.revisions.map((revision) => [
      `${revision.publicId}\0${revision.revisionHash}`,
      revision,
    ]),
  );
  const blockers = new Set<string>();
  for (const [publicId, entry] of Object.entries(document.publications)) {
    if (entry.activeRevisionHash !== null) {
      const revision = revisions.get(`${publicId}\0${entry.activeRevisionHash}`);
      if (revision === undefined) {
        diagnostics.push(
          diagnostic(
            "STATE_REVISION_MISSING",
            "Active state references missing revision evidence",
            publicId,
          ),
        );
        continue;
      }
      const currentNames = [revision.metadata.slug, ...revision.metadata.aliases];
      if (currentNames.some((candidate) => normalizedSlug(candidate) === normalized)) {
        blockers.add("ACTIVE_NAME");
      }
      if (revision.outgoingLinks.some((link) => normalizedSlug(link.slug) === normalized)) {
        blockers.add("ACTIVE_LINK_DESTINATION");
      }
    }
    if (
      entry.withdrawalFrom !== undefined &&
      entry.withdrawalRedirect !== undefined &&
      [entry.withdrawalFrom, entry.withdrawalRedirect].some(
        (candidate) => normalizedSlug(candidate) === normalized,
      )
    ) {
      blockers.add("ACTIVE_REDIRECT");
    }
  }
  if (ownerId === null) blockers.add("NOT_RESERVED");
  if (ownerId !== null && ownerId !== input.publicId) blockers.add("FOREIGN_OWNER");
  const report = {
    operation: "slug-release" as const,
    stateDir,
    publicId: input.publicId,
    slug: input.slug,
    ownerId,
    blockers: [...blockers].sort((left, right) => left.localeCompare(right)),
    diagnostics,
    canApply:
      ownerId === input.publicId &&
      blockers.size === 0 &&
      !diagnostics.some((item) => item.severity === "error"),
  };
  const planHash = hash(JSON.stringify({ report, stateHash, inventory: inventory.fingerprint }));
  return { report: { ...report, planHash }, document, stateHash };
}

export async function planSlugRelease(input: SlugReleaseInput) {
  return (await prepareSlugRelease(input)).report;
}

export async function applySlugRelease(
  input: SlugReleaseInput,
  expectedPlanHash: string,
): Promise<{ readonly applied: true; readonly planHash: string }> {
  return withLock(input.stateDir, async () => {
    const prepared = await prepareSlugRelease(input);
    if (prepared.report.planHash !== expectedPlanHash) {
      throw new PublisherError("STALE_STATE_PLAN", "State evidence changed; inspect a new plan");
    }
    if (!prepared.report.canApply) {
      throw new PublisherError("SLUG_RELEASE_BLOCKED", "The slug cannot be safely released");
    }
    const entry = prepared.document.publications[input.publicId];
    if (entry === undefined) {
      throw new PublisherError("SLUG_RELEASE_BLOCKED", "The slug owner no longer exists");
    }
    const normalized = normalizedSlug(input.slug);
    prepared.document.publications[input.publicId] = {
      ...entry,
      reservedSlugs: entry.reservedSlugs.filter(
        (candidate) => normalizedSlug(candidate) !== normalized,
      ),
    };
    await writeStateDocument(input.stateDir, prepared.document, prepared.stateHash);
    return { applied: true, planHash: prepared.report.planHash };
  });
}

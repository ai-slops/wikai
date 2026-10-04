import type { Diagnostic } from "../model/index.ts";
import { BindingSchema, type SourceBindings, stateProblem } from "./maintenance-input.ts";
import { normalizedSlug } from "./reservations.ts";
import {
  InternalPathSchema,
  type StateDocument,
  StateDocumentSchema,
  type StoredRevision,
} from "./schema.ts";

export function reconstructState(input: {
  readonly revisions: readonly StoredRevision[];
  readonly backup: StateDocument | null;
  readonly bindings: SourceBindings;
}): { readonly document: StateDocument; readonly diagnostics: Diagnostic[] } {
  const document: StateDocument = { schemaVersion: 2, publications: {} };
  const diagnostics: Diagnostic[] = [];
  const groups = new Map<string, StoredRevision[]>();
  for (const revision of input.revisions) {
    const group = groups.get(revision.publicId) ?? [];
    group.push(revision);
    groups.set(revision.publicId, group);
  }
  const ids = new Set([...groups.keys(), ...Object.keys(input.backup?.publications ?? {})]);
  for (const id of Object.keys(input.bindings)) {
    if (!ids.has(id))
      diagnostics.push(
        stateProblem("STATE_BINDING_UNUSED", "A binding has no revision evidence", id),
      );
  }
  for (const id of [...ids].sort()) {
    const revisions = groups.get(id) ?? [];
    const prior = input.backup?.publications[id];
    const binding = input.bindings[id];
    const identity = binding ?? prior;
    const latest = revisions.at(-1);
    if (latest === undefined) {
      diagnostics.push(
        stateProblem(
          "STATE_BACKUP_REVISION_MISSING",
          "A backup publication has no intact revision evidence",
          id,
        ),
      );
      continue;
    }
    if (identity === undefined) {
      diagnostics.push(
        stateProblem(
          "STATE_BINDING_REQUIRED",
          "Provide a reviewed source binding or a valid state backup",
          id,
        ),
      );
      continue;
    }
    const source = BindingSchema.safeParse({
      sourceId: identity.sourceId,
      sourcePath: identity.sourcePath,
      sourceMode: identity.sourceMode,
    });
    if (!source.success) {
      diagnostics.push(
        stateProblem("STATE_BINDINGS_INVALID", "Recovered source identity is invalid", id),
      );
      continue;
    }
    if (prior !== undefined) {
      if (
        binding !== undefined &&
        (binding.sourceId !== prior.sourceId ||
          binding.sourcePath !== prior.sourcePath ||
          binding.sourceMode !== prior.sourceMode)
      ) {
        diagnostics.push(
          stateProblem("STATE_BINDING_CONFLICT", "Binding conflicts with backed-up ownership", id),
        );
      }
      const known = new Map(revisions.map((revision) => [revision.revisionHash, revision]));
      if (
        prior.revisionHashes.some((revisionHash) => !known.has(revisionHash)) ||
        !prior.revisionHashes.some(
          (revisionHash) => known.get(revisionHash)?.exposureHash === prior.latestExposureHash,
        ) ||
        (prior.activeRevisionHash !== null &&
          known.get(prior.activeRevisionHash)?.exposureHash !== prior.latestExposureHash)
      ) {
        diagnostics.push(
          stateProblem(
            "STATE_BACKUP_REVISION_MISSING",
            "Backup revision coordinates or exposure do not match available evidence",
            id,
          ),
        );
      }
    }
    const reservedSlugs = [
      ...new Set([
        ...(prior?.reservedSlugs ?? []),
        ...(prior?.withdrawalFrom === undefined ? [] : [prior.withdrawalFrom]),
        ...revisions.flatMap((revision) => [revision.metadata.slug, ...revision.metadata.aliases]),
      ]),
    ];
    if (reservedSlugs.some((slug) => !InternalPathSchema.safeParse(slug).success)) {
      diagnostics.push(
        stateProblem(
          "STATE_RECOVERY_SLUG_INVALID",
          "Revision evidence contains an unsafe public URL",
          id,
        ),
      );
      continue;
    }
    document.publications[id] = {
      ...source.data,
      activeRevisionHash: null,
      activeSourceHash: null,
      activeSources: [],
      latestExposureHash: latest.exposureHash,
      revisionHashes: revisions.map((revision) => revision.revisionHash),
      revisionSourceHashes: Object.fromEntries(
        revisions.map((revision) => [
          revision.revisionHash,
          prior?.revisionSourceHashes[revision.revisionHash] ?? null,
        ]),
      ),
      revisionSources: Object.fromEntries(
        revisions.map((revision) => [
          revision.revisionHash,
          prior?.revisionSources[revision.revisionHash] ?? null,
        ]),
      ),
      reservedSlugs,
      ...(prior?.lastReviewedAt === undefined ? {} : { lastReviewedAt: prior.lastReviewedAt }),
      ...(prior?.lastDeployedRevision === undefined ||
      !revisions.some((revision) => revision.revisionHash === prior.lastDeployedRevision)
        ? {}
        : { lastDeployedRevision: prior.lastDeployedRevision }),
    };
  }
  const owners = new Map<string, string>();
  for (const [id, entry] of Object.entries(document.publications)) {
    for (const slug of entry.reservedSlugs) {
      const name = normalizedSlug(slug);
      const owner = owners.get(name);
      if (owner !== undefined && owner !== id) {
        diagnostics.push(
          stateProblem("SLUG_COLLISION", "Recovered URL reservations have conflicting owners", id),
        );
      }
      owners.set(name, id);
    }
  }
  return { document: StateDocumentSchema.parse(document), diagnostics };
}

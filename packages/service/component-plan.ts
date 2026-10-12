import { hash } from "../fs/index.ts";
import type {
  ApprovedRevision,
  Diagnostic,
  MaterializedAsset,
  PublicLink,
  WorkingPublication,
} from "../model/index.ts";

export type ComponentUpdateSkipReason =
  | "assets-changed"
  | "authored-mdx-changed"
  | "blocked"
  | "body-changed"
  | "explicit-slug-required"
  | "links-changed"
  | "metadata-changed"
  | "new-mdx"
  | "not-mdx"
  | "not-published"
  | "orphaned"
  | "profile-unchanged"
  | "source-drift"
  | "tags-changed"
  | "unapproved-first-time";

export type ComponentUpdateApprovalItem = {
  readonly publicId: string;
  readonly activeRevisionHash: string;
  readonly activeExposureHash: string;
  readonly desiredExposureHash: string;
  readonly sourceHash: string;
  readonly dependencySourceHashes: readonly {
    readonly sourceId: string;
    readonly capturedHash: string | null;
  }[];
  readonly contentInputHash: string;
  readonly activeProfileDigest: string;
  readonly desiredProfileDigest: string;
};

export type ComponentUpdateApprovalPlan = {
  readonly operation: "component-update-approval";
  readonly eligible: readonly ComponentUpdateApprovalItem[];
  readonly skipped: readonly {
    readonly publicId: string;
    readonly reasons: readonly ComponentUpdateSkipReason[];
  }[];
  readonly planHash: string;
};

type PlanInput = {
  readonly working: readonly WorkingPublication[];
  readonly approved: readonly ApprovedRevision[];
  readonly diagnostics: readonly Diagnostic[];
  readonly sourceDriftIds: readonly string[];
  readonly missingExplicitSlugIds?: readonly string[];
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
};

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function stableMetadata(
  publication: WorkingPublication | ApprovedRevision,
): Record<string, unknown> {
  const {
    publishedAt: _publishedAt,
    updatedAt: _updatedAt,
    lastReviewedAt: _lastReviewedAt,
    lastVerifiedAt: _lastVerifiedAt,
    tags: _tags,
    ...metadata
  } = publication.metadata;
  return metadata;
}

const assetDescriptors = (assets: readonly MaterializedAsset[]) =>
  assets.map(({ publicPath, hash: assetHash, mime, bytes }) => ({
    publicPath,
    hash: assetHash,
    mime,
    bytes,
  }));

const orderedLinks = (links: readonly PublicLink[]) =>
  [...links].sort((left, right) =>
    `${left.publicId}\0${left.anchor ?? ""}`.localeCompare(
      `${right.publicId}\0${right.anchor ?? ""}`,
    ),
  );

function reasonsFor(
  before: ApprovedRevision | undefined,
  after: WorkingPublication | undefined,
  blocked: boolean,
  sourceDrift: boolean,
  missingExplicitSlug: boolean,
): readonly ComponentUpdateSkipReason[] {
  const reasons: ComponentUpdateSkipReason[] = [];
  if (blocked) reasons.push("blocked");
  if (sourceDrift) reasons.push("source-drift");
  if (after === undefined) return [...reasons, "orphaned"];
  if (missingExplicitSlug) reasons.push("explicit-slug-required");
  if (after.workflowStatus !== "published") reasons.push("not-published");
  if (after.mdx === undefined) reasons.push("not-mdx");
  if (before === undefined) return [...reasons, "unapproved-first-time"];
  if (before.mdx === undefined && after.mdx !== undefined) reasons.push("new-mdx");
  if (!same(stableMetadata(before), stableMetadata(after))) reasons.push("metadata-changed");
  if (!same(before.metadata.tags, after.metadata.tags)) reasons.push("tags-changed");
  if (before.markdown !== after.markdown) reasons.push("body-changed");
  if (!same(orderedLinks(before.outgoingLinks), orderedLinks(after.outgoingLinks)))
    reasons.push("links-changed");
  if (!same(assetDescriptors(before.assets), assetDescriptors(after.assets)))
    reasons.push("assets-changed");
  if (
    before.mdx !== undefined &&
    after.mdx !== undefined &&
    before.mdx.contentInputHash !== after.mdx.contentInputHash
  )
    reasons.push("authored-mdx-changed");
  if (
    before.mdx !== undefined &&
    after.mdx !== undefined &&
    before.mdx.profileDigest === after.mdx.profileDigest
  )
    reasons.push("profile-unchanged");
  return reasons;
}

export function createComponentUpdateApprovalPlan(input: PlanInput): ComponentUpdateApprovalPlan {
  const working = new Map(input.working.map((publication) => [publication.publicId, publication]));
  const approved = new Map(
    input.approved.map((publication) => [publication.publicId, publication]),
  );
  const drift = new Set(input.sourceDriftIds);
  const missingExplicitSlug = new Set(input.missingExplicitSlugIds ?? []);
  const errors = input.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const globalBlocked = errors.some((diagnostic) => diagnostic.publicId === undefined);
  const ids = [...new Set([...working.keys(), ...approved.keys()])].sort((left, right) =>
    left.localeCompare(right),
  );
  const eligible: ComponentUpdateApprovalItem[] = [];
  const skipped: ComponentUpdateApprovalPlan["skipped"][number][] = [];
  for (const publicId of ids) {
    const before = approved.get(publicId);
    const after = working.get(publicId);
    const blocked = globalBlocked || errors.some((diagnostic) => diagnostic.publicId === publicId);
    const reasons = reasonsFor(
      before,
      after,
      blocked,
      drift.has(publicId),
      missingExplicitSlug.has(publicId),
    );
    if (before?.mdx !== undefined && after?.mdx !== undefined && reasons.length === 0) {
      eligible.push({
        publicId,
        activeRevisionHash: before.revisionHash,
        activeExposureHash: before.exposureHash,
        desiredExposureHash: after.exposureHash,
        sourceHash: after.sourceHash,
        dependencySourceHashes: after.sources.map((source) => ({
          sourceId: source.id,
          capturedHash: source.capturedHash ?? null,
        })),
        contentInputHash: after.mdx.contentInputHash,
        activeProfileDigest: before.mdx.profileDigest,
        desiredProfileDigest: after.mdx.profileDigest,
      });
    } else {
      skipped.push({ publicId, reasons });
    }
  }
  const report = { operation: "component-update-approval" as const, eligible, skipped };
  return { ...report, planHash: hash(JSON.stringify(report)) };
}

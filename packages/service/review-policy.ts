import type { ApprovedRevision, Diagnostic, PublicKind, PublisherConfig } from "../model/index.ts";

const DEFAULT_WARN_AFTER_DAYS: Readonly<Record<PublicKind, number>> = {
  work: 180,
  knowledge: 180,
  log: 0,
  page: 365,
};
const DAY_MILLISECONDS = 86_400_000;

export type ReviewAgeInput = Readonly<{
  approved: readonly ApprovedRevision[];
  config: PublisherConfig;
  now?: Date;
  reviewedAt?: Readonly<Record<string, string>>;
}>;

export const reviewAgeDiagnostics = ({
  approved,
  config,
  now = new Date(),
  reviewedAt = {},
}: ReviewAgeInput): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const revision of approved) {
    const kind = revision.metadata.kind;
    const warnAfterDays = config.review?.warnAfterDays?.[kind] ?? DEFAULT_WARN_AFTER_DAYS[kind];
    if (warnAfterDays === 0) continue;
    const timestamp =
      reviewedAt[revision.publicId] ?? revision.metadata.lastReviewedAt ?? revision.approvedAt;
    const reviewedTime = Date.parse(timestamp);
    if (!Number.isFinite(reviewedTime)) continue;
    if (now.getTime() - reviewedTime < warnAfterDays * DAY_MILLISECONDS) continue;
    diagnostics.push({
      code: "REVIEW_OVERDUE",
      severity: "warning",
      message: "The active approved publication is due for review",
      publicId: revision.publicId,
      hint: "Review the approved snapshot and record a new private review timestamp",
    });
  }
  return diagnostics;
};

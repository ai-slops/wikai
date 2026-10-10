import type {
  ApprovedRevision,
  Diagnostic,
  PublicRedirect,
  WorkingPublication,
} from "../model/index.ts";
import { type PublicationDifferences, publicationDifferences } from "./publication-differences.ts";

export type { PublicationDifferences } from "./publication-differences.ts";

export type BuildBaselineUnavailableReason =
  | "missing-receipt"
  | "invalid-receipt"
  | "stale-staging-policy"
  | "missing-revision";

export type LastBuildBaseline =
  | {
      readonly available: true;
      readonly publications: readonly ApprovedRevision[];
      readonly redirects: readonly PublicRedirect[];
    }
  | { readonly available: false; readonly reason: BuildBaselineUnavailableReason };

export type ProposalStatus = "added" | "updated" | "unchanged" | "blocked" | "orphaned";
export type ReleaseStatus = "added" | "updated" | "unchanged" | "withdrawn";

type PublicationChange<Status extends string> = {
  readonly publicId: string;
  readonly status: Status;
  readonly beforeExposureHash: string | null;
  readonly afterExposureHash: string | null;
  readonly differences: PublicationDifferences | null;
  readonly diagnostics: readonly Diagnostic[];
};

type ProposalSummary = Readonly<Record<ProposalStatus, number>>;
type ReleaseSummary = Readonly<Record<ReleaseStatus, number>>;
type RedirectChanges = {
  readonly added: readonly PublicRedirect[];
  readonly removed: readonly PublicRedirect[];
  readonly updated: readonly {
    readonly from: string;
    readonly before: PublicRedirect;
    readonly after: PublicRedirect;
  }[];
};

export type ChangePlan = {
  readonly proposals: {
    readonly baseline: "active-approved";
    readonly summary: ProposalSummary;
    readonly publications: readonly PublicationChange<ProposalStatus>[];
  };
  readonly release:
    | {
        readonly baseline: "last-successful-build";
        readonly available: true;
        readonly summary: ReleaseSummary;
        readonly publications: readonly PublicationChange<ReleaseStatus>[];
        readonly redirects: RedirectChanges;
      }
    | {
        readonly baseline: "last-successful-build";
        readonly available: false;
        readonly reason: BuildBaselineUnavailableReason;
      };
};

type ChangePlanInput = {
  readonly working: readonly WorkingPublication[];
  readonly approved: readonly ApprovedRevision[];
  readonly diagnostics: readonly Diagnostic[];
  readonly redirects: readonly PublicRedirect[];
  readonly lastBuild: LastBuildBaseline;
};

const ordered = <T>(values: readonly T[], key: (value: T) => string): readonly T[] =>
  [...values].sort((left, right) => key(left).localeCompare(key(right)));
const exposureHash = (
  publication: WorkingPublication | ApprovedRevision | undefined,
): string | null => publication?.exposureHash ?? null;

function proposalChanges(input: ChangePlanInput): ChangePlan["proposals"] {
  const working = new Map(input.working.map((publication) => [publication.publicId, publication]));
  const approved = new Map(
    input.approved.map((publication) => [publication.publicId, publication]),
  );
  const errorDiagnostics = input.diagnostics.filter((item) => item.severity === "error");
  const globalErrors = errorDiagnostics.filter((item) => item.publicId === undefined);
  const ids = [
    ...new Set([
      ...working.keys(),
      ...approved.keys(),
      ...errorDiagnostics.flatMap((item) => (item.publicId === undefined ? [] : [item.publicId])),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const summary: Record<ProposalStatus, number> = {
    added: 0,
    updated: 0,
    unchanged: 0,
    blocked: 0,
    orphaned: 0,
  };
  const publications = ids.map((publicId): PublicationChange<ProposalStatus> => {
    const before = approved.get(publicId);
    const after = working.get(publicId);
    const idDiagnostics = errorDiagnostics.filter((item) => item.publicId === publicId);
    const applicableDiagnostics =
      after === undefined ? idDiagnostics : [...globalErrors, ...idDiagnostics];
    const blocked = applicableDiagnostics.length > 0;
    const status: ProposalStatus = blocked
      ? "blocked"
      : after === undefined
        ? "orphaned"
        : before === undefined
          ? "added"
          : before.exposureHash === after.exposureHash
            ? "unchanged"
            : "updated";
    summary[status] += 1;
    return {
      publicId,
      status,
      beforeExposureHash: exposureHash(before),
      afterExposureHash: exposureHash(after),
      differences: after === undefined ? null : publicationDifferences(before ?? null, after),
      diagnostics: applicableDiagnostics,
    };
  });
  return { baseline: "active-approved", summary, publications };
}

function redirectChanges(
  before: readonly PublicRedirect[],
  after: readonly PublicRedirect[],
): RedirectChanges {
  const beforeMap = new Map(before.map((redirect) => [redirect.from, redirect]));
  const afterMap = new Map(after.map((redirect) => [redirect.from, redirect]));
  return {
    added: ordered(
      after.filter((redirect) => !beforeMap.has(redirect.from)),
      (redirect) => redirect.from,
    ),
    removed: ordered(
      before.filter((redirect) => !afterMap.has(redirect.from)),
      (redirect) => redirect.from,
    ),
    updated: ordered(
      before.flatMap((previous) => {
        const next = afterMap.get(previous.from);
        return next === undefined || (previous.to === next.to && previous.status === next.status)
          ? []
          : [{ from: previous.from, before: previous, after: next }];
      }),
      (change) => change.from,
    ),
  };
}

function releaseChanges(input: ChangePlanInput): ChangePlan["release"] {
  if (!input.lastBuild.available) {
    return {
      baseline: "last-successful-build",
      available: false,
      reason: input.lastBuild.reason,
    };
  }
  const before = new Map(input.lastBuild.publications.map((item) => [item.publicId, item]));
  const after = new Map(input.approved.map((item) => [item.publicId, item]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort((left, right) =>
    left.localeCompare(right),
  );
  const summary: Record<ReleaseStatus, number> = {
    added: 0,
    updated: 0,
    unchanged: 0,
    withdrawn: 0,
  };
  const publications = ids.map((publicId): PublicationChange<ReleaseStatus> => {
    const previous = before.get(publicId);
    const next = after.get(publicId);
    const status: ReleaseStatus =
      next === undefined
        ? "withdrawn"
        : previous === undefined
          ? "added"
          : previous.revisionHash === next.revisionHash
            ? "unchanged"
            : "updated";
    summary[status] += 1;
    return {
      publicId,
      status,
      beforeExposureHash: exposureHash(previous),
      afterExposureHash: exposureHash(next),
      differences: publicationDifferences(previous ?? null, next ?? null),
      diagnostics: [],
    };
  });
  return {
    baseline: "last-successful-build",
    available: true,
    summary,
    publications,
    redirects: redirectChanges(input.lastBuild.redirects, input.redirects),
  };
}

export function createChangePlan(input: ChangePlanInput): ChangePlan {
  return { proposals: proposalChanges(input), release: releaseChanges(input) };
}

import type {
  ApprovedRevision,
  Diagnostic,
  PublicationPlan,
  VaultSnapshot,
  WorkingPublication,
} from "../model/index.ts";
import type { PublisherState } from "../state/index.ts";
import { hasSourceDrift } from "./drift.ts";
import type { PublisherStatus, StatusRow } from "./schema.ts";

type StatusContext = {
  readonly plan: PublicationPlan;
  readonly state: PublisherState;
  readonly approved: readonly ApprovedRevision[];
  readonly vault: VaultSnapshot;
};

function publicationDiagnostics(
  publicId: string,
  working: WorkingPublication | undefined,
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  return [
    ...(working?.diagnostics ?? []),
    ...diagnostics.filter((diagnostic) => diagnostic.publicId === publicId),
  ];
}

function workingStatus(
  working: WorkingPublication,
  approved: ApprovedRevision | undefined,
  hasHistory: boolean,
  sourceDrift: boolean,
  diagnostics: readonly Diagnostic[],
): StatusRow["status"] {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return "blocked";
  if (approved !== undefined) {
    if (working.exposureHash !== approved.exposureHash) return "update-available";
    if (sourceDrift) return "source-drift";
    return "published";
  }
  if (hasHistory) return "withdrawn";
  if (working.workflowStatus === "candidate") return "candidate";
  return "review";
}

export async function createStatus(context: StatusContext): Promise<PublisherStatus> {
  const workingById = new Map(
    context.plan.publications.map((publication) => [publication.publicId, publication]),
  );
  const approvedById = new Map(context.approved.map((revision) => [revision.publicId, revision]));
  const ids = new Set([
    ...workingById.keys(),
    ...approvedById.keys(),
    ...(await context.state.publicationIds()),
    ...context.plan.diagnostics.flatMap((diagnostic) =>
      diagnostic.publicId === undefined ? [] : [diagnostic.publicId],
    ),
  ]);
  const publications: StatusRow[] = [];
  for (const publicId of [...ids].sort((left, right) => left.localeCompare(right))) {
    const working = workingById.get(publicId);
    const approved = approvedById.get(publicId);
    const history = await context.state.history(publicId);
    const source = await context.state.source(publicId);
    const sourceDrift = await hasSourceDrift({
      state: context.state,
      publicId,
      working,
      vault: context.vault,
    });
    const diagnostics = publicationDiagnostics(publicId, working, context.plan.diagnostics);
    const authored = context.vault.documents.find(
      (document) => document.frontmatter.public?.id === publicId,
    );
    const spec = authored?.frontmatter.public;
    const authoredReference =
      authored === undefined || spec === undefined
        ? undefined
        : {
            title: spec.title ?? authored.frontmatter.title ?? publicId,
            slug: spec.slug ?? "",
            kind: spec.kind,
          };
    const reference =
      working?.metadata ?? approved?.metadata ?? history.at(-1)?.metadata ?? authoredReference;
    if (reference === undefined) continue;
    const status =
      working === undefined
        ? diagnostics.some((diagnostic) => diagnostic.severity === "error")
          ? "blocked"
          : approved !== undefined
            ? "orphaned"
            : history.length > 0
              ? "withdrawn"
              : spec?.status === "candidate"
                ? "candidate"
                : "review"
        : workingStatus(working, approved, history.length > 0, sourceDrift, diagnostics);
    publications.push({
      publicId,
      title: reference.title,
      slug: reference.slug,
      kind: reference.kind,
      status,
      exposureHash: working?.exposureHash ?? null,
      approvedHash: approved?.exposureHash ?? null,
      sourcePath: working?.sourcePath ?? source?.sourcePath ?? authored?.sourcePath ?? null,
      diagnostics,
      sourceDrift,
    });
  }
  return { publications, diagnostics: [...context.plan.diagnostics] };
}

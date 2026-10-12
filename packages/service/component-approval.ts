import { compile, loadVault } from "../compiler/index.ts";
import type { ApprovedRevision, PublisherConfig, VaultSnapshot } from "../model/index.ts";
import type { PublisherState } from "../state/index.ts";
import { assertExplicitSlug, captureComponentApproval } from "./approval.ts";
import {
  type ComponentUpdateApprovalPlan,
  createComponentUpdateApprovalPlan,
} from "./component-plan.ts";
import { hasSourceDrift } from "./drift.ts";

type PreparedPlan = {
  readonly report: ComponentUpdateApprovalPlan;
  readonly compiled: Awaited<ReturnType<typeof compile>>;
  readonly vault: VaultSnapshot;
};

async function prepareComponentUpdateApproval(
  config: PublisherConfig,
  state: PublisherState,
  approved: readonly ApprovedRevision[],
): Promise<PreparedPlan> {
  const vault = await loadVault(config);
  const compiled = await compile(vault, config, approved);
  const approvedIds = new Set(approved.map((publication) => publication.publicId));
  const sourceDriftIds = (
    await Promise.all(
      compiled.publications
        .filter((publication) => approvedIds.has(publication.publicId))
        .map(async (publication) => ({
          publicId: publication.publicId,
          drift: await hasSourceDrift({
            state,
            publicId: publication.publicId,
            working: publication,
            vault,
          }),
        })),
    )
  ).flatMap((result) => (result.drift ? [result.publicId] : []));
  const missingExplicitSlugIds = compiled.publications.flatMap((publication) => {
    const document = vault.documents.find(
      (candidate) => candidate.sourcePath === publication.sourcePath,
    );
    return document?.frontmatter.public?.slug === undefined ? [publication.publicId] : [];
  });
  return {
    report: createComponentUpdateApprovalPlan({
      working: compiled.publications,
      approved,
      diagnostics: [
        ...compiled.diagnostics,
        ...compiled.publications.flatMap((publication) => publication.diagnostics),
      ],
      sourceDriftIds,
      missingExplicitSlugIds,
    }),
    compiled,
    vault,
  };
}

export async function planComponentUpdateApproval(
  config: PublisherConfig,
  state: PublisherState,
): Promise<ComponentUpdateApprovalPlan> {
  const approved = (await state.snapshot()).approved;
  return (await prepareComponentUpdateApproval(config, state, approved)).report;
}

export async function applyComponentUpdateApproval(
  config: PublisherConfig,
  state: PublisherState,
  expectedPlanHash: string,
) {
  return state.approveComponentUpdates(expectedPlanHash, async (active) => {
    const prepared = await prepareComponentUpdateApproval(config, state, active);
    const approvals = await Promise.all(
      prepared.report.eligible.map(async (item) => {
        const working = prepared.compiled.publications.find(
          (publication) => publication.publicId === item.publicId,
        );
        if (working === undefined) throw new TypeError("Eligible publication is missing");
        assertExplicitSlug(working, prepared.vault);
        return {
          working,
          ...(await captureComponentApproval(config, working, prepared.vault)),
          expectedActiveRevisionHash: item.activeRevisionHash,
          expectedActiveExposureHash: item.activeExposureHash,
          expectedDesiredExposureHash: item.desiredExposureHash,
          expectedContentInputHash: item.contentInputHash,
          expectedProfileDigest: item.desiredProfileDigest,
          expectedSourceHash: item.sourceHash,
        };
      }),
    );
    return { planHash: prepared.report.planHash, approvals };
  });
}

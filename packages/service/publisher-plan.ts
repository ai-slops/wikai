import { compile, loadVault } from "../compiler/index.ts";
import type { ApprovedRevision, PublicationPlan, PublisherConfig } from "../model/index.ts";
import type { PublisherState } from "../state/index.ts";
import { type ChangePlan, createChangePlan } from "./change-plan.ts";
import { loadLastBuildBaseline } from "./change-plan-baseline.ts";
import { reviewAgeDiagnostics } from "./review-policy.ts";

export type PublisherPlan = PublicationPlan & {
  readonly approved: readonly ApprovedRevision[];
  readonly redirects: Awaited<ReturnType<PublisherState["snapshot"]>>["redirects"];
  readonly changes: ChangePlan;
};

export async function createPublisherPlan(
  config: PublisherConfig,
  state: PublisherState,
): Promise<PublisherPlan> {
  const snapshot = await state.snapshot();
  const vault = await loadVault(config);
  const plan = await compile(vault, config, snapshot.approved);
  const diagnostics = [
    ...plan.diagnostics,
    ...reviewAgeDiagnostics({
      approved: snapshot.approved,
      config,
      reviewedAt: await state.reviewTimes(),
    }),
  ];
  return {
    ...plan,
    diagnostics,
    approved: snapshot.approved,
    redirects: snapshot.redirects,
    changes: createChangePlan({
      working: plan.publications,
      approved: snapshot.approved,
      diagnostics,
      redirects: snapshot.redirects,
      lastBuild: await loadLastBuildBaseline(config, state),
    }),
  };
}

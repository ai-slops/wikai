import { join } from "node:path";
import { z } from "zod";
import { readOptional } from "../fs/index.ts";
import { type PublisherConfig, RedirectSchema } from "../model/index.ts";
import { readReleaseReceipt, redirectsPolicyHash, releasePolicyHash } from "../release/receipt.ts";
import type { PublisherState } from "../state/index.ts";
import type { LastBuildBaseline } from "./change-plan.ts";

const RedirectFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  redirects: z.array(RedirectSchema),
});

export async function loadLastBuildBaseline(
  config: PublisherConfig,
  state: PublisherState,
): Promise<LastBuildBaseline> {
  const receiptPath = join(config.publisher.stateDir, "release-receipt.json");
  if ((await readOptional(receiptPath)) === undefined) {
    return { available: false, reason: "missing-receipt" };
  }
  let receipt: Awaited<ReturnType<typeof readReleaseReceipt>>;
  try {
    receipt = await readReleaseReceipt(config.publisher.stateDir);
  } catch (error) {
    if (error instanceof Error) return { available: false, reason: "invalid-receipt" };
    throw error;
  }
  let redirects: z.infer<typeof RedirectFileSchema>["redirects"];
  try {
    const policyHash = await releasePolicyHash(config.publisher.releaseStagingDir);
    const rawRedirects = await readOptional(
      join(config.publisher.releaseStagingDir, "redirects.json"),
    );
    if (rawRedirects === undefined || policyHash !== receipt.stagingPolicyHash) {
      return { available: false, reason: "stale-staging-policy" };
    }
    redirects = RedirectFileSchema.parse(JSON.parse(rawRedirects)).redirects;
  } catch (error) {
    if (error instanceof Error) return { available: false, reason: "stale-staging-policy" };
    throw error;
  }
  if (redirectsPolicyHash(redirects) !== receipt.redirectsHash) {
    return { available: false, reason: "stale-staging-policy" };
  }
  const publications = [];
  for (const [publicId, revisionHash] of Object.entries(receipt.revisions).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const revision = (await state.history(publicId)).find(
      (candidate) => candidate.revisionHash === revisionHash,
    );
    if (revision === undefined) return { available: false, reason: "missing-revision" };
    publications.push(revision);
  }
  return { available: true, publications, redirects };
}

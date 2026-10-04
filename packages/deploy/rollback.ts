import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { auditDist } from "../audit/index.ts";
import { hash, withLock } from "../fs/index.ts";
import { PublisherError } from "../model/index.ts";
import { directoryFingerprintHash, releasePolicyHash } from "../release/receipt.ts";
import { PublisherState } from "../state/index.ts";
import { deploymentEvidencePath, readDeploymentEvidence } from "./evidence.ts";
import { assertSafeDestination, fingerprintDirectory } from "./filesystem.ts";
import type { DirectoryDeploymentInput } from "./index.ts";
import {
  type DeploymentFileOperations,
  defaultDeploymentFileOperations,
  swapGenerations,
} from "./transaction.ts";

async function prepareRollback(input: DirectoryDeploymentInput) {
  const deployment = input.deployments[input.environment];
  if (deployment === undefined) {
    throw new PublisherError(
      "DEPLOYMENT_NOT_CONFIGURED",
      "Deployment requires an explicitly configured environment",
    );
  }
  const destination = resolve(deployment.root);
  await assertSafeDestination(input.config, destination);
  const previous = `${destination}.previous`;
  const evidence = deploymentEvidencePath(input.config.publisher.stateDir, input.environment);
  const previousEvidence = `${evidence}.previous`;
  const currentFingerprint = await fingerprintDirectory(destination);
  const previousFingerprint = await fingerprintDirectory(previous);
  const currentEvidenceFingerprint = await fingerprintDirectory(evidence);
  const previousEvidenceFingerprint = await fingerprintDirectory(previousEvidence);
  const currentDeploymentEvidence = await readDeploymentEvidence(evidence, destination);
  const deploymentEvidence = await readDeploymentEvidence(previousEvidence, destination);
  if (
    directoryFingerprintHash(currentFingerprint) !==
      currentDeploymentEvidence.distFingerprintHash ||
    directoryFingerprintHash(previousFingerprint) !== deploymentEvidence.distFingerprintHash ||
    (await releasePolicyHash(evidence)) !== currentDeploymentEvidence.stagingPolicyHash ||
    (await releasePolicyHash(previousEvidence)) !== deploymentEvidence.stagingPolicyHash
  ) {
    throw new PublisherError(
      "DEPLOYMENT_EVIDENCE_INVALID",
      "Deployment generations differ from their private receipts",
    );
  }
  const auditConfig = {
    ...input.config,
    publisher: { ...input.config.publisher, releaseStagingDir: previousEvidence },
  };
  const diagnostics = await auditDist(previous, auditConfig, input.vault);
  const report = {
    operation: "directory-rollback" as const,
    environment: input.environment,
    destination,
    previous,
    revisions: deploymentEvidence.revisions,
    diagnostics,
    canApply: !diagnostics.some((item) => item.severity === "error"),
  };
  return {
    report: {
      ...report,
      planHash: hash(
        JSON.stringify({
          report,
          currentFingerprint,
          previousFingerprint,
          currentEvidenceFingerprint,
          previousEvidenceFingerprint,
        }),
      ),
    },
  };
}

export async function planDirectoryRollback(input: DirectoryDeploymentInput) {
  return (await prepareRollback(input)).report;
}

export async function applyDirectoryRollback(
  input: DirectoryDeploymentInput,
  expectedPlanHash: string,
): Promise<{ readonly applied: true; readonly planHash: string }> {
  const lockDir = join(input.config.publisher.stateDir, "deployment-locks", input.environment);
  return withLock(lockDir, async () => {
    const prepared = await prepareRollback(input);
    if (prepared.report.planHash !== expectedPlanHash) {
      throw new PublisherError(
        "STALE_DEPLOYMENT_PLAN",
        "Rollback evidence changed; inspect a new plan",
      );
    }
    if (!prepared.report.canApply) {
      throw new PublisherError("DEPLOYMENT_AUDIT_FAILED", "Previous deployment failed audit");
    }
    const evidence = deploymentEvidencePath(input.config.publisher.stateDir, input.environment);
    const operations: DeploymentFileOperations =
      input.fileOperations ?? defaultDeploymentFileOperations;
    const swap = (current: string, previous: string) =>
      swapGenerations({
        current,
        previous,
        temporary: `${current}.rollback-${randomUUID()}`,
        operations,
      });
    const syncParents = async (): Promise<void> => {
      await operations.syncDirectory(dirname(prepared.report.destination));
      await operations.syncDirectory(dirname(evidence));
    };
    await swap(prepared.report.destination, prepared.report.previous);
    try {
      await swap(evidence, `${evidence}.previous`);
    } catch (error) {
      await swap(prepared.report.destination, prepared.report.previous);
      await syncParents();
      throw error;
    }
    try {
      await syncParents();
    } catch (error) {
      await swap(evidence, `${evidence}.previous`);
      await swap(prepared.report.destination, prepared.report.previous);
      await syncParents();
      throw error;
    }
    try {
      const state = await PublisherState.open(input.config.publisher.stateDir);
      await state.recordRollback(prepared.report.revisions);
    } catch (error) {
      await swap(evidence, `${evidence}.previous`);
      await swap(prepared.report.destination, prepared.report.previous);
      await syncParents();
      throw error;
    }
    return { applied: true, planHash: prepared.report.planHash };
  });
}

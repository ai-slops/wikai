import { cp, mkdtemp, open, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { auditDist } from "../audit/index.ts";
import { hash, replaceDirectory, withLock } from "../fs/index.ts";
import type { PublisherConfig, VaultSnapshot } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import {
  directoryFingerprintHash,
  redirectsPolicyHash,
  revisionsForRelease,
} from "../release/receipt.ts";
import { PublisherState } from "../state/index.ts";
import { deploymentEvidencePath, stageDeploymentEvidence } from "./evidence.ts";
import { assertSafeDestination, directoryExists, fingerprintDirectory } from "./filesystem.ts";
import { type DeploymentFileOperations, defaultDeploymentFileOperations } from "./transaction.ts";

export { applyDirectoryRollback, planDirectoryRollback } from "./rollback.ts";

export type DirectoryDeployment = {
  readonly type: "directory";
  readonly root: string;
};

export type DeploymentConfig = Readonly<Record<string, DirectoryDeployment>>;

export type DirectoryDeploymentInput = {
  readonly config: PublisherConfig;
  readonly deployments: DeploymentConfig;
  readonly environment: string;
  readonly vault?: VaultSnapshot;
  readonly afterEvidenceSnapshot?: () => Promise<void>;
  readonly fileOperations?: DeploymentFileOperations;
};

function destinationFor(input: DirectoryDeploymentInput): string {
  const deployment = input.deployments[input.environment];
  if (deployment === undefined) {
    throw new PublisherError(
      "DEPLOYMENT_NOT_CONFIGURED",
      "Deployment requires an explicitly configured environment",
    );
  }
  return resolve(deployment.root);
}

function sameRevisions(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const entries = (value: Readonly<Record<string, string>>) =>
    Object.entries(value).sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right));
}

async function prepareDeployment(input: DirectoryDeploymentInput) {
  const destination = destinationFor(input);
  await assertSafeDestination(input.config, destination);
  const stagedEvidence = await stageDeploymentEvidence({
    config: input.config,
    environment: input.environment,
    destination,
  });
  try {
    await input.afterEvidenceSnapshot?.();
    const source = resolve(input.config.site.distDir);
    const sourceFingerprint = await fingerprintDirectory(source);
    if (
      directoryFingerprintHash(sourceFingerprint) !== stagedEvidence.receipt.distFingerprintHash
    ) {
      throw new PublisherError(
        "RELEASE_OUTPUT_CHANGED",
        "Distribution differs from the successfully audited release",
      );
    }
    const state = await PublisherState.open(input.config.publisher.stateDir);
    const snapshot = await state.snapshot();
    const currentRevisions = revisionsForRelease(snapshot.approved);
    if (
      !sameRevisions(currentRevisions, stagedEvidence.receipt.revisions) ||
      redirectsPolicyHash(snapshot.redirects) !== stagedEvidence.receipt.redirectsHash
    ) {
      throw new PublisherError(
        "RELEASE_STATE_CHANGED",
        "Active publication state changed after the release was built",
      );
    }
    const auditConfig = {
      ...input.config,
      publisher: { ...input.config.publisher, releaseStagingDir: stagedEvidence.evidence },
    };
    const diagnostics = await auditDist(source, auditConfig, input.vault);
    const evidenceFingerprint = await fingerprintDirectory(stagedEvidence.evidence);
    const report = {
      operation: "directory-deploy" as const,
      environment: input.environment,
      source,
      destination,
      revisions: stagedEvidence.receipt.revisions,
      diagnostics,
      canApply: !diagnostics.some((item) => item.severity === "error"),
    };
    const planHash = hash(JSON.stringify({ report, sourceFingerprint, evidenceFingerprint }));
    return { report: { ...report, planHash }, sourceFingerprint, stagedEvidence, auditConfig };
  } catch (error) {
    await rm(stagedEvidence.root, { recursive: true, force: true });
    throw error;
  }
}

export async function planDirectoryDeployment(input: DirectoryDeploymentInput) {
  const prepared = await prepareDeployment(input);
  await rm(prepared.stagedEvidence.root, { recursive: true, force: true });
  return prepared.report;
}

async function restoreDestination(destination: string, hadPrevious: boolean): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  if (hadPrevious) await rename(`${destination}.previous`, destination);
  const directory = await open(dirname(destination), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function applyDirectoryDeployment(
  input: DirectoryDeploymentInput,
  expectedPlanHash: string,
): Promise<{ readonly applied: true; readonly planHash: string; readonly destination: string }> {
  const lockDir = join(input.config.publisher.stateDir, "deployment-locks", input.environment);
  return withLock(lockDir, async () => {
    const prepared = await prepareDeployment(input);
    if (prepared.report.planHash !== expectedPlanHash) {
      throw new PublisherError(
        "STALE_DEPLOYMENT_PLAN",
        "Deployment evidence changed; inspect a new plan",
      );
    }
    if (!prepared.report.canApply) {
      throw new PublisherError("DEPLOYMENT_AUDIT_FAILED", "Distribution audit blocks deployment");
    }
    const parent = await mkdtemp(join(dirname(prepared.report.destination), ".wikai-deploy-"));
    const copied = join(parent, "copy");
    const hadPrevious = await directoryExists(prepared.report.destination);
    const evidenceDestination = deploymentEvidencePath(
      input.config.publisher.stateDir,
      input.environment,
    );
    const hadEvidence = await directoryExists(evidenceDestination);
    const operations = input.fileOperations ?? defaultDeploymentFileOperations;
    let evidencePromoted = false;
    try {
      await cp(prepared.report.source, copied, {
        recursive: true,
        force: false,
        errorOnExist: true,
        dereference: false,
      });
      const copiedFingerprint = await fingerprintDirectory(copied);
      if (JSON.stringify(copiedFingerprint) !== JSON.stringify(prepared.sourceFingerprint)) {
        throw new PublisherError(
          "DEPLOYMENT_COPY_MISMATCH",
          "Copied deployment differs from the reviewed distribution",
        );
      }
      const copiedDiagnostics = await auditDist(copied, prepared.auditConfig, input.vault);
      if (copiedDiagnostics.some((item) => item.severity === "error")) {
        throw new PublisherError(
          "DEPLOYMENT_AUDIT_FAILED",
          "Copied distribution failed the privacy audit",
        );
      }
      await replaceDirectory(copied, prepared.report.destination);
      try {
        await replaceDirectory(prepared.stagedEvidence.evidence, evidenceDestination);
        evidencePromoted = true;
        await rm(parent, { recursive: true, force: true });
        await rm(prepared.stagedEvidence.root, { recursive: true, force: true });
        await operations.syncDirectory(dirname(prepared.report.destination));
        await operations.syncDirectory(dirname(evidenceDestination));
        const state = await PublisherState.open(input.config.publisher.stateDir);
        await state.recordDeployment(prepared.report.revisions);
      } catch (error) {
        if (evidencePromoted) await restoreDestination(evidenceDestination, hadEvidence);
        await restoreDestination(prepared.report.destination, hadPrevious);
        throw error;
      }
      return {
        applied: true,
        planHash: prepared.report.planHash,
        destination: prepared.report.destination,
      };
    } catch (error) {
      await rm(parent, { recursive: true, force: true });
      await rm(prepared.stagedEvidence.root, { recursive: true, force: true });
      throw error;
    }
  });
}

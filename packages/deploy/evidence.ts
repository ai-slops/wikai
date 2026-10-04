import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { hash, isFsError } from "../fs/index.ts";
import type { Diagnostic, PublisherConfig } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";
import {
  type ReleaseReceipt,
  ReleaseReceiptSchema,
  readReleaseReceipt,
  releasePolicyHash,
} from "../release/receipt.ts";
import { fingerprintDirectory } from "./filesystem.ts";

const POLICY_FILES = ["publication-manifest.json", "redirects.json", "content-index.json"] as const;
const EVIDENCE_FILES = new Set([...POLICY_FILES, "deployment.json"]);
const DeploymentEvidenceSchema = z.strictObject({
  ...ReleaseReceiptSchema.shape,
  destination: z.string().refine(isAbsolute),
});

export type DeploymentEvidence = Readonly<z.infer<typeof DeploymentEvidenceSchema>>;
type StageDeploymentEvidenceInput = {
  readonly config: PublisherConfig;
  readonly environment: string;
  readonly destination: string;
};

export function deploymentEvidencePath(stateDir: string, environment: string): string {
  return join(resolve(stateDir), "deployments", hash(environment).slice("sha256:".length));
}

export async function stageDeploymentEvidence(input: StageDeploymentEvidenceInput): Promise<{
  readonly root: string;
  readonly evidence: string;
  readonly receipt: ReleaseReceipt;
}> {
  const receipt = await readReleaseReceipt(input.config.publisher.stateDir);
  const current = deploymentEvidencePath(input.config.publisher.stateDir, input.environment);
  await mkdir(dirname(current), { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(dirname(current), ".wikai-evidence-"));
  try {
    const evidence = join(root, "copy");
    await mkdir(evidence);
    const policyBefore = await releasePolicyHash(input.config.publisher.releaseStagingDir);
    for (const name of POLICY_FILES) {
      await cp(join(input.config.publisher.releaseStagingDir, name), join(evidence, name), {
        dereference: false,
        errorOnExist: true,
        force: false,
      });
    }
    const policyAfter = await releasePolicyHash(input.config.publisher.releaseStagingDir);
    if (
      policyBefore !== policyAfter ||
      (await releasePolicyHash(evidence)) !== policyBefore ||
      policyBefore !== receipt.stagingPolicyHash
    ) {
      throw new PublisherError(
        "RELEASE_POLICY_CHANGED",
        "Release policy differs from the audited build receipt",
      );
    }
    await writeFile(
      join(evidence, "deployment.json"),
      `${JSON.stringify(
        {
          ...receipt,
          destination: resolve(input.destination),
        },
        null,
        2,
      )}\n`,
      { flag: "wx", mode: 0o600 },
    );
    await fingerprintDirectory(evidence);
    return { root, evidence, receipt };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function readDeploymentEvidence(
  path: string,
  destination: string,
): Promise<DeploymentEvidence> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(path, "deployment.json"), "utf8"));
    const evidence = DeploymentEvidenceSchema.parse(parsed);
    if (resolve(evidence.destination) !== resolve(destination)) {
      throw new PublisherError(
        "DEPLOYMENT_EVIDENCE_INVALID",
        "Deployment evidence belongs to a different destination",
      );
    }
    return evidence;
  } catch (error) {
    if (error instanceof PublisherError) throw error;
    if (error instanceof Error) {
      throw new PublisherError(
        "DEPLOYMENT_EVIDENCE_INVALID",
        "Trusted deployment evidence cannot be read",
      );
    }
    throw error;
  }
}

const evidenceDiagnostic = (): Diagnostic => ({
  code: "DEPLOYMENT_EVIDENCE_INVALID",
  severity: "error",
  message: "Deployment generation evidence is malformed or unreadable",
});

export async function deploymentEvidenceInventory(stateDir: string): Promise<{
  readonly revisions: readonly { readonly publicId: string; readonly revisionHash: string }[];
  readonly diagnostics: readonly Diagnostic[];
  readonly fingerprint: readonly object[];
}> {
  const root = join(resolve(stateDir), "deployments");
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const revisions: { publicId: string; revisionHash: string }[] = [];
    const fingerprint: object[] = [];
    const diagnostics: Diagnostic[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(root, entry.name);
      const info = await lstat(path);
      if (
        !/^[0-9a-f]{64}(?:\.previous)?$/u.test(entry.name) ||
        !entry.isDirectory() ||
        info.isSymbolicLink()
      ) {
        diagnostics.push(evidenceDiagnostic());
        fingerprint.push({ path: entry.name, kind: "invalid" });
        continue;
      }
      try {
        const evidenceFiles = await readdir(path);
        if (
          evidenceFiles.length !== EVIDENCE_FILES.size ||
          evidenceFiles.some((name) => !EVIDENCE_FILES.has(name))
        ) {
          throw new PublisherError(
            "DEPLOYMENT_EVIDENCE_INVALID",
            "Deployment evidence contains unexpected files",
          );
        }
        const evidence = DeploymentEvidenceSchema.parse(
          JSON.parse(await readFile(join(path, "deployment.json"), "utf8")),
        );
        if ((await releasePolicyHash(path)) !== evidence.stagingPolicyHash) {
          throw new PublisherError(
            "DEPLOYMENT_EVIDENCE_INVALID",
            "Deployment policy differs from its private receipt",
          );
        }
        fingerprint.push({ path: entry.name, entries: await fingerprintDirectory(path) });
        for (const [publicId, revisionHash] of Object.entries(evidence.revisions)) {
          revisions.push({ publicId, revisionHash });
        }
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        diagnostics.push(evidenceDiagnostic());
        fingerprint.push({ path: entry.name, kind: "invalid" });
      }
    }
    return { revisions, diagnostics, fingerprint };
  } catch (error) {
    if (isFsError(error, "ENOENT")) return { revisions: [], diagnostics: [], fingerprint: [] };
    if (error instanceof Error) {
      return { revisions: [], diagnostics: [evidenceDiagnostic()], fingerprint: [] };
    }
    throw error;
  }
}

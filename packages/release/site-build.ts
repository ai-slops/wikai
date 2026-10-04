import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fingerprintDirectory } from "../deploy/filesystem.ts";
import { replaceDirectory } from "../fs/index.ts";
import type { PublisherConfig, VaultSnapshot } from "../model/index.ts";
import { ReleaseError } from "./error.ts";
import {
  directoryFingerprintHash,
  readReleaseIdentity,
  releasePolicyHash,
  writeReleaseReceipt,
} from "./receipt.ts";

export type SandboxSpec = Readonly<{
  createArgs: readonly string[];
  stagingPath: string;
  outputPath: string;
}>;

export const createSandboxSpec = (
  config: PublisherConfig,
  name: string,
  image = config.site.image,
  distVolume = `${name}-dist`,
): SandboxSpec => {
  if (!config.site.isolatedBuild || config.site.network !== "disabled")
    throw new ReleaseError(
      "RELEASE_SANDBOX_REQUIRED",
      "Release rendering requires the isolated network-disabled site configuration",
    );
  const createArgs = [
    "create",
    "--name",
    name,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=512m,uid=1000,gid=1000",
    "--mount",
    `type=volume,src=${distVolume},dst=/dist`,
    "--env",
    "WIKAI_STAGING_DIR=/staging",
    "--env",
    "WIKAI_RENDER_DIR=/tmp/render",
    "--env",
    "WIKAI_CACHE_DIR=/tmp/cache",
    "--env",
    "WIKAI_VITE_CACHE_DIR=/tmp/vite-cache",
    "--env",
    "WIKAI_OUT_DIR=/dist",
    "--env",
    `WIKAI_SITE_URL=${config.site.url}`,
    "--env",
    "ASTRO_TELEMETRY_DISABLED=1",
    "--env",
    "HOME=/tmp",
    image,
  ] as const;
  return { createArgs, stagingPath: "/staging", outputPath: "/dist" };
};

export const createExportSpec = (
  name: string,
  distVolume: string,
  image: string,
): readonly string[] =>
  [
    "create",
    "--name",
    name,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--mount",
    `type=volume,src=${distVolume},dst=/dist,readonly`,
    image,
    "sleep",
    "120",
  ] as const;

const docker = async (args: readonly string[], timeout?: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...(timeout === undefined ? {} : { timeout, killSignal: "SIGKILL" }),
    });
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      errorOutput += chunk;
    });
    child.on("error", (error) =>
      reject(new ReleaseError("RELEASE_DOCKER_UNAVAILABLE", error.message)),
    );
    child.on("close", (code, signal) => {
      if (code === 0) resolve(output.trim());
      else if (signal !== null && timeout !== undefined)
        reject(
          new ReleaseError(
            "RELEASE_BUILD_TIMEOUT",
            "Isolated site rendering exceeded its time limit",
          ),
        );
      else
        reject(
          new ReleaseError("RELEASE_DOCKER_FAILED", errorOutput.trim() || `docker exited ${code}`),
        );
    });
  });

const removeDockerResource = async (args: readonly string[]): Promise<void> => {
  try {
    await docker(args);
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
  }
};

export const buildSite = async (
  config: PublisherConfig,
  vault?: VaultSnapshot,
): Promise<{ readonly distPath: string }> => {
  const name = `wikai-site-${process.pid}-${Date.now()}`;
  const stagingContainer = `${name}-staging`;
  const exportContainer = `${name}-export`;
  const distVolume = `${name}-dist`;
  const runtimeImage = `${name}:staged`;
  const spec = createSandboxSpec(config, name, runtimeImage, distVolume);
  await mkdir(dirname(config.site.distDir), { recursive: true });
  const temporary = await mkdtemp(join(dirname(config.site.distDir), ".site-dist-"));
  const rendered = join(temporary, "export");
  const staging = join(temporary, "staging");
  let rendererCreated = false;
  let stagingCreated = false;
  let exporterCreated = false;
  let volumeCreated = false;
  try {
    await cp(config.publisher.releaseStagingDir, staging, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    await fingerprintDirectory(staging);
    const identity = await readReleaseIdentity(config.publisher.stateDir);
    if ((await releasePolicyHash(staging)) !== identity.stagingPolicyHash) {
      throw new ReleaseError(
        "RELEASE_IDENTITY_CHANGED",
        "Release staging changed after its private identity was recorded",
      );
    }
    await docker(["create", "--name", stagingContainer, config.site.image]);
    stagingCreated = true;
    await docker(["cp", `${staging}/.`, `${stagingContainer}:${spec.stagingPath}`]);
    await docker(["commit", stagingContainer, runtimeImage]);
    await docker(["rm", "--force", stagingContainer]);
    stagingCreated = false;
    await docker(["volume", "create", distVolume]);
    volumeCreated = true;
    await docker(spec.createArgs);
    rendererCreated = true;
    await docker(["start", name]);
    const exitCode = await docker(["wait", name], 120_000);
    if (!/^[0-9]+$/.test(exitCode) || Number(exitCode) !== 0)
      throw new ReleaseError(
        "RELEASE_BUILD_FAILED",
        `Isolated site renderer exited with code ${exitCode}`,
      );
    await docker(createExportSpec(exportContainer, distVolume, config.site.image));
    exporterCreated = true;
    await mkdir(rendered);
    await docker(["start", exportContainer]);
    await docker(["cp", `${exportContainer}:/dist/.`, rendered], 60_000);
    const { auditDist } = await import("../audit/index.ts");
    const auditConfig = {
      ...config,
      publisher: { ...config.publisher, releaseStagingDir: staging },
    };
    const diagnostics = await auditDist(rendered, auditConfig, vault);
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0)
      throw new ReleaseError(
        "RELEASE_AUDIT_FAILED",
        `Rendered output failed the privacy audit: ${errors.map((diagnostic) => diagnostic.code).join(", ")}`,
      );
    await writeReleaseReceipt(config.publisher.stateDir, {
      ...identity,
      distFingerprintHash: directoryFingerprintHash(await fingerprintDirectory(rendered)),
    });
    await replaceDirectory(rendered, config.site.distDir);
    await rm(temporary, { recursive: true, force: true });
    return { distPath: config.site.distDir };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    if (rendererCreated) await removeDockerResource(["rm", "--force", name]);
    if (exporterCreated) await removeDockerResource(["rm", "--force", exportContainer]);
    if (stagingCreated) await removeDockerResource(["rm", "--force", stagingContainer]);
    if (volumeCreated) await removeDockerResource(["volume", "rm", "--force", distVolume]);
    await removeDockerResource(["image", "rm", "--force", runtimeImage]);
  }
};

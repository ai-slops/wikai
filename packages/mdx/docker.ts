import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isFsError } from "../fs/index.ts";
import { MdxError } from "./error.ts";
import { type MdxRuntimeOutput, readMdxOutput } from "./output.ts";
import type { MdxImmutableInput } from "./snapshot.ts";

async function stageFile(root: string, path: string, data: string | Buffer): Promise<void> {
  const segments = path.split("/");
  let directory = root;
  for (const segment of segments.slice(0, -1)) {
    directory = join(directory, segment);
    await mkdir(directory, { recursive: true });
    await chmod(directory, 0o755);
  }
  const target = join(root, path);
  await writeFile(target, data);
  await chmod(target, 0o444);
}

async function docker(args: readonly string[]): Promise<string> {
  const dockerEnvironment = Object.fromEntries(
    ["DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"].flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  return new Promise<string>((resolve, reject) => {
    const child = spawn("docker", args, {
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", ...dockerEnvironment },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", () =>
      reject(new MdxError("MDX_RUNTIME_UNAVAILABLE", "Isolated MDX runtime is unavailable")),
    );
    child.on("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new MdxError("MDX_COMPILE_FAILED", "MDX could not be compiled safely"));
    });
  });
}

export async function resolveMdxImage(image: string): Promise<string> {
  const imageId = await docker(["image", "inspect", "--format={{.Id}}", image]);
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageId)) {
    throw new MdxError("MDX_COMPILE_FAILED", "MDX runtime image identity is invalid");
  }
  return imageId;
}

export async function runMdxDocker(input: {
  readonly body: string;
  readonly immutable: MdxImmutableInput;
}): Promise<MdxRuntimeOutput> {
  const root = await mkdtemp(join(tmpdir(), "wikai-mdx-"));
  const staged = join(root, "input");
  const output = join(root, "output");
  const name = `wikai-mdx-${process.pid}-${Date.now()}`;
  const stagingContainer = `${name}-staging`;
  const exporterContainer = `${name}-export`;
  const outputVolume = `${name}-output`;
  let stagingCreated = false;
  let runtimeCreated = false;
  let exporterCreated = false;
  let volumeCreated = false;
  let stagedImageId: string | undefined;
  try {
    await mkdir(staged);
    await mkdir(output);
    await chmod(output, 0o777);
    await stageFile(staged, input.immutable.sourcePath, input.body);
    for (const dependency of input.immutable.files) {
      await stageFile(staged, dependency.path, Buffer.from(dependency.data, "base64"));
    }
    await chmod(staged, 0o555);
    const roots = [...input.immutable.componentRoots, ...input.immutable.dataRoots].join(":");
    await docker(["create", "--name", stagingContainer, input.immutable.imageId]);
    stagingCreated = true;
    await docker(["cp", `${staged}/.`, `${stagingContainer}:/input`]);
    stagedImageId = await docker(["commit", stagingContainer]);
    if (!/^sha256:[0-9a-f]{64}$/u.test(stagedImageId)) {
      throw new MdxError("MDX_COMPILE_FAILED", "MDX staged runtime identity is invalid");
    }
    await docker(["rm", "--force", stagingContainer]);
    stagingCreated = false;
    await docker(["volume", "create", outputVolume]);
    volumeCreated = true;
    await docker([
      "create",
      "--name",
      name,
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true",
      "--memory=512m",
      "--cpus=1",
      "--pids-limit=64",
      "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=128m,uid=10001,gid=10001",
      "--mount",
      `type=volume,src=${outputVolume},dst=/output`,
      "--env",
      `WIKAI_MDX_ENTRY=${input.immutable.sourcePath}`,
      "--env",
      `WIKAI_MDX_ROOTS=${roots}`,
      stagedImageId,
    ]);
    runtimeCreated = true;
    await docker(["start", "--attach", name]);
    await docker([
      "create",
      "--name",
      exporterContainer,
      "--network=none",
      "--read-only",
      "--mount",
      `type=volume,src=${outputVolume},dst=/output,readonly`,
      input.immutable.imageId,
      "sleep",
      "120",
    ]);
    exporterCreated = true;
    await docker(["start", exporterContainer]);
    await docker(["cp", `${exporterContainer}:/output/.`, output]);
    return await readMdxOutput(output);
  } finally {
    const cleanup = async (args: readonly string[]): Promise<void> => {
      try {
        await docker(args);
      } catch (error) {
        if (!(error instanceof MdxError)) throw error;
      }
    };
    if (runtimeCreated) await cleanup(["rm", "--force", name]);
    if (exporterCreated) await cleanup(["rm", "--force", exporterContainer]);
    if (stagingCreated) await cleanup(["rm", "--force", stagingContainer]);
    if (volumeCreated) await cleanup(["volume", "rm", "--force", outputVolume]);
    if (stagedImageId !== undefined) await cleanup(["image", "rm", "--force", stagedImageId]);
    await chmod(staged, 0o755).catch((error) => {
      if (!isFsError(error, "ENOENT")) throw error;
    });
    await rm(root, { recursive: true, force: true });
  }
}

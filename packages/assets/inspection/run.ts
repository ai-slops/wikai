import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectMedia } from "./ffprobe.ts";
import {
  INSPECTION_LIMITS,
  type InspectionCode,
  InspectionFormatSchema,
  type InspectionResult,
  InspectionResultSchema,
  MediaFormatSchema,
} from "./schema.ts";

const worker = fileURLToPath(new URL("./worker.ts", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = fileURLToPath(new URL("./", import.meta.url));

export async function inspectBytes(input: Buffer, extension: string): Promise<InspectionResult> {
  const format = InspectionFormatSchema.parse(extension);
  if (input.length > INSPECTION_LIMITS.inputBytes)
    return { ok: false, code: "ASSET_INSPECTION_LIMIT" };
  if (process.platform !== "linux") return { ok: false, code: "ASSET_INSPECTION_UNAVAILABLE" };
  const mediaFormat = MediaFormatSchema.safeParse(format);
  if (mediaFormat.success) return inspectMedia(input, mediaFormat.data);
  return new Promise((resolve) => {
    const child = spawn(
      "/usr/bin/prlimit",
      [
        "--as=2147483648",
        "--cpu=5:5",
        "--core=0:0",
        "--",
        process.execPath,
        "--max-old-space-size=128",
        "--disable-wasm-trap-handler",
        "--disallow-code-generation-from-strings",
        "--permission",
        `--allow-fs-read=${directory}`,
        `--allow-fs-read=${root}/node_modules`,
        `--allow-fs-read=${root}/package.json`,
        worker,
        format,
      ],
      {
        cwd: directory,
        env: { TZ: "UTC", NODE_NO_WARNINGS: "1" },
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const chunks: Buffer[] = [];
    let length = 0;
    let failure: InspectionCode | undefined;
    const timer = setTimeout(() => {
      failure = "ASSET_INSPECTION_LIMIT";
      child.kill("SIGKILL");
    }, INSPECTION_LIMITS.timeoutMs);
    child.on("error", () => {
      failure = "ASSET_INSPECTION_UNAVAILABLE";
    });
    child.stdin.on("error", () => {
      failure ??= "ASSET_INSPECTION_FAILED";
    });
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > INSPECTION_LIMITS.outputBytes) {
        failure = "ASSET_INSPECTION_LIMIT";
        child.kill("SIGKILL");
      } else chunks.push(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure !== undefined || code !== 0) {
        resolve({ ok: false, code: failure ?? "ASSET_INSPECTION_FAILED" });
        return;
      }
      try {
        const parsed = InspectionResultSchema.safeParse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        resolve(parsed.success ? parsed.data : { ok: false, code: "ASSET_INSPECTION_FAILED" });
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        resolve({ ok: false, code: "ASSET_INSPECTION_FAILED" });
      }
    });
    child.stdin.end(input);
  });
}

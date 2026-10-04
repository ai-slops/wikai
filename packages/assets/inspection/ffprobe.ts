import { spawn } from "node:child_process";
import { parseMediaProbe } from "./media.ts";
import {
  INSPECTION_LIMITS,
  type InspectionCode,
  InspectionError,
  type InspectionResult,
  type MediaFormat,
} from "./schema.ts";

const FFPROBE = "/usr/local/bin/ffprobe";
const formatWhitelist: Readonly<Record<MediaFormat, string>> = {
  ".mp3": "mp3",
  ".wav": "wav",
  ".mp4": "mov",
  ".webm": "matroska",
};
const mime: Readonly<Record<MediaFormat, string>> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export function inspectMedia(input: Buffer, format: MediaFormat): Promise<InspectionResult> {
  return new Promise((resolve) => {
    const child = spawn(
      "/usr/bin/prlimit",
      [
        "--as=1073741824",
        "--cpu=5:5",
        "--core=0:0",
        "--",
        FFPROBE,
        "-v",
        "error",
        "-max_alloc",
        "134217728",
        "-probesize",
        "5000000",
        "-analyzeduration",
        "5000000",
        "-protocol_whitelist",
        "pipe",
        "-format_whitelist",
        formatWhitelist[format],
        "-show_entries",
        "format=format_name,duration,bit_rate:format_tags=title,artist,album,date,comment,genre,encoder:stream=index,codec_type,codec_name,profile,duration,bit_rate,width,height,sample_rate,channels,channel_layout:stream_tags=language,title",
        "-of",
        "json",
        "-i",
        "pipe:0",
      ],
      { env: { TZ: "UTC" }, stdio: ["pipe", "pipe", "ignore"] },
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
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (failure !== undefined || code !== 0) {
        if (code === 127) {
          resolve({ ok: false, code: "ASSET_INSPECTION_UNAVAILABLE" });
          return;
        }
        resolve({
          ok: false,
          code: failure ?? (signal === null ? "ASSET_INSPECTION_FAILED" : "ASSET_INSPECTION_LIMIT"),
        });
        return;
      }
      try {
        resolve({
          ok: true,
          detectedMime: mime[format],
          metadata: parseMediaProbe(Buffer.concat(chunks).toString("utf8"), format),
          notes: [
            "Container, common tags and stream headers only; frames, samples, cover art and codec payloads are not returned. Input is read from a bounded pipe and external file or network protocols are disabled.",
          ],
        });
      } catch (error) {
        if (error instanceof InspectionError) resolve({ ok: false, code: error.code });
        else throw error;
      }
    });
    child.stdin.end(input);
  });
}

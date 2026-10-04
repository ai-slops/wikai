import { describe, expect, it } from "vitest";
import { parseMediaProbe } from "./inspection/media.ts";
import { inspectBytes } from "./inspection/run.ts";
import { INSPECTION_LIMITS } from "./inspection/schema.ts";
import { mediaFixture } from "./media-fixture.ts";

const cases = [
  {
    file: "tone.mp3",
    extension: ".mp3",
    mime: "audio/mpeg",
    container: "mp3",
    stream: { type: "audio", codec: "mp3", channels: 1 },
  },
  {
    file: "tone.wav",
    extension: ".wav",
    mime: "audio/wav",
    container: "wav",
    stream: { type: "audio", codec: "pcm_s16le", channels: 1 },
  },
  {
    file: "tone.mp4",
    extension: ".mp4",
    mime: "video/mp4",
    container: "mov,mp4,m4a,3gp,3g2,mj2",
    stream: { type: "video", codec: "mpeg4", width: 32, height: 24 },
  },
  {
    file: "tone.webm",
    extension: ".webm",
    mime: "video/webm",
    container: "matroska,webm",
    stream: { type: "video", codec: "vp8", width: 32, height: 24 },
  },
] as const;

describe("bounded media metadata", () => {
  it.each(cases)("inspects real $extension metadata without payload bytes", async (fixture) => {
    const result = await inspectBytes(await mediaFixture(fixture.file), fixture.extension);

    expect(result).toMatchObject({
      ok: true,
      detectedMime: fixture.mime,
      metadata: {
        kind: "media",
        container: fixture.container,
        tags: { title: "PRIVATE_SENTINEL_MEDIA_TITLE" },
        streams: [fixture.stream],
      },
    });
    expect(JSON.stringify(result)).not.toContain("data:");
    expect(JSON.stringify(result)).not.toContain("filename");
  });

  it.each(cases)("rejects malformed $extension bytes without echoing them", async (fixture) => {
    const result = await inspectBytes(Buffer.from("PRIVATE_SENTINEL_BAD_MEDIA"), fixture.extension);

    expect(result).toEqual({ ok: false, code: "ASSET_INSPECTION_FAILED" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL_BAD_MEDIA");
  });

  it("rejects media input beyond the shared byte limit before probing", async () => {
    expect(await inspectBytes(Buffer.alloc(INSPECTION_LIMITS.inputBytes + 1), ".mp3")).toEqual({
      ok: false,
      code: "ASSET_INSPECTION_LIMIT",
    });
  });

  it("rejects an overlong media tag at the parser boundary", () => {
    const probe = JSON.stringify({
      programs: [],
      stream_groups: [],
      streams: [{ index: 0, codec_name: "mp3", codec_type: "audio" }],
      format: {
        format_name: "mp3",
        tags: { title: "x".repeat(INSPECTION_LIMITS.textCharacters + 1) },
      },
    });

    expect(() => parseMediaProbe(probe, ".mp3")).toThrow("ASSET_INSPECTION_LIMIT");
  });

  it("rejects a media report beyond the stream count limit", () => {
    const probe = JSON.stringify({
      programs: [],
      stream_groups: [],
      streams: Array.from({ length: INSPECTION_LIMITS.mediaStreams + 1 }, (_, index) => ({
        index,
        codec_name: "mp3",
        codec_type: "audio",
      })),
      format: { format_name: "mp3" },
    });

    expect(() => parseMediaProbe(probe, ".mp3")).toThrow("ASSET_INSPECTION_LIMIT");
  });

  it("rejects file-reference fields instead of passing them through", () => {
    const probe = JSON.stringify({
      programs: [],
      stream_groups: [],
      streams: [{ index: 0, codec_name: "mp3", codec_type: "audio" }],
      format: { format_name: "mp3", filename: "/private/source.mp3" },
    });

    expect(() => parseMediaProbe(probe, ".mp3")).toThrow("ASSET_INSPECTION_FAILED");
  });
});

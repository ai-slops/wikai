import { z } from "zod";
import {
  INSPECTION_LIMITS,
  InspectionError,
  type MediaFormat,
  type MediaMetadata,
  MediaMetadataSchema,
} from "./schema.ts";

const probeText = z.string().max(INSPECTION_LIMITS.textCharacters);
const probeNumber = z.string().max(64).optional();
const ProbeTagsSchema = z.strictObject({
  title: probeText.optional(),
  TITLE: probeText.optional(),
  artist: probeText.optional(),
  ARTIST: probeText.optional(),
  album: probeText.optional(),
  ALBUM: probeText.optional(),
  date: probeText.optional(),
  DATE: probeText.optional(),
  comment: probeText.optional(),
  COMMENT: probeText.optional(),
  genre: probeText.optional(),
  GENRE: probeText.optional(),
  encoder: probeText.optional(),
  ENCODER: probeText.optional(),
});
const ProbeSchema = z.strictObject({
  programs: z.array(z.never()).max(0),
  stream_groups: z.array(z.never()).max(0),
  streams: z
    .array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        codec_name: probeText,
        profile: probeText.optional(),
        codec_type: z.enum(["audio", "video", "subtitle", "data", "attachment"]),
        duration: probeNumber,
        bit_rate: probeNumber,
        width: z.number().int().nonnegative().optional(),
        height: z.number().int().nonnegative().optional(),
        sample_rate: probeNumber,
        channels: z.number().int().nonnegative().optional(),
        channel_layout: probeText.optional(),
        tags: z
          .strictObject({
            title: probeText.optional(),
            TITLE: probeText.optional(),
            language: probeText.optional(),
            LANGUAGE: probeText.optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(INSPECTION_LIMITS.mediaStreams),
  format: z.strictObject({
    format_name: probeText,
    duration: probeNumber,
    bit_rate: probeNumber,
    tags: ProbeTagsSchema.optional(),
  }),
});
const expectedContainer: Readonly<Record<MediaFormat, string>> = {
  ".mp3": "mp3",
  ".wav": "wav",
  ".mp4": "mp4",
  ".webm": "webm",
};

const boundedNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value === "N/A") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new InspectionError("ASSET_INSPECTION_FAILED");
  return parsed;
};

const hasBoundIssue = (error: z.ZodError): boolean =>
  error.issues.some((issue) => issue.code === "too_big");

export function parseMediaProbe(input: string, format: MediaFormat): MediaMetadata {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch (error) {
    if (error instanceof SyntaxError) throw new InspectionError("ASSET_INSPECTION_FAILED");
    throw error;
  }
  const probed = ProbeSchema.safeParse(value);
  if (!probed.success) {
    throw new InspectionError(
      hasBoundIssue(probed.error) ? "ASSET_INSPECTION_LIMIT" : "ASSET_INSPECTION_FAILED",
    );
  }
  const names = probed.data.format.format_name.split(",");
  if (!names.includes(expectedContainer[format]))
    throw new InspectionError("ASSET_INSPECTION_FAILED");
  const metadata = MediaMetadataSchema.safeParse({
    kind: "media",
    format,
    container: probed.data.format.format_name,
    durationSeconds: boundedNumber(probed.data.format.duration),
    bitRate: boundedNumber(probed.data.format.bit_rate),
    tags:
      probed.data.format.tags === undefined
        ? {}
        : {
            title: probed.data.format.tags.title ?? probed.data.format.tags.TITLE,
            artist: probed.data.format.tags.artist ?? probed.data.format.tags.ARTIST,
            album: probed.data.format.tags.album ?? probed.data.format.tags.ALBUM,
            date: probed.data.format.tags.date ?? probed.data.format.tags.DATE,
            comment: probed.data.format.tags.comment ?? probed.data.format.tags.COMMENT,
            genre: probed.data.format.tags.genre ?? probed.data.format.tags.GENRE,
            encoder: probed.data.format.tags.encoder ?? probed.data.format.tags.ENCODER,
          },
    streams: probed.data.streams.map((stream) => ({
      index: stream.index,
      type: stream.codec_type,
      codec: stream.codec_name,
      profile: stream.profile,
      durationSeconds: boundedNumber(stream.duration),
      bitRate: boundedNumber(stream.bit_rate),
      width: stream.width,
      height: stream.height,
      sampleRate: boundedNumber(stream.sample_rate),
      channels: stream.channels,
      channelLayout: stream.channel_layout,
      tags:
        stream.tags === undefined
          ? {}
          : {
              title: stream.tags.title ?? stream.tags.TITLE,
              language: stream.tags.language ?? stream.tags.LANGUAGE,
            },
    })),
  });
  if (!metadata.success) {
    throw new InspectionError(
      hasBoundIssue(metadata.error) ? "ASSET_INSPECTION_LIMIT" : "ASSET_INSPECTION_FAILED",
    );
  }
  return metadata.data;
}

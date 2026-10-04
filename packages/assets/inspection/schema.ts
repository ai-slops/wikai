import { z } from "zod";

export const INSPECTION_LIMITS = {
  inputBytes: 64 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  declaredBytes: 512 * 1024 * 1024,
  entries: 1000,
  textCharacters: 4096,
  outputBytes: 1024 * 1024,
  timeoutMs: 10_000,
  pdfMetadataBytes: 64 * 1024,
  pdfInfoEntries: 128,
  pdfReferenceDepth: 8,
  mediaStreams: 128,
  mediaDurationSeconds: 10 * 365.25 * 24 * 60 * 60,
  mediaBitRate: 1_000_000_000_000,
  mediaDimension: 65_536,
  mediaSampleRate: 10_000_000,
  mediaChannels: 1024,
} as const;

const text = z.string().max(INSPECTION_LIMITS.textCharacters);
const count = z.number().int().nonnegative();
export const MediaFormatSchema = z.enum([".mp3", ".wav", ".mp4", ".webm"]);
export type MediaFormat = z.infer<typeof MediaFormatSchema>;
export const InspectionFormatSchema = z.enum([
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tar.gz",
  ".mp3",
  ".wav",
  ".mp4",
  ".webm",
]);
export type InspectionFormat = z.infer<typeof InspectionFormatSchema>;
export const InspectionCodeSchema = z.enum([
  "ASSET_INSPECTION_FAILED",
  "ASSET_INSPECTION_LIMIT",
  "ASSET_INSPECTION_UNAVAILABLE",
  "ASSET_INSPECTION_ENCRYPTED",
  "ASSET_ARCHIVE_UNSAFE",
  "ASSET_PDF_METADATA_UNSUPPORTED",
]);
export type InspectionCode = z.infer<typeof InspectionCodeSchema>;
export class InspectionError extends Error {
  readonly code: InspectionCode;
  constructor(code: InspectionCode) {
    super(code);
    this.name = "InspectionError";
    this.code = code;
  }
}

export const ArchiveEntrySchema = z.strictObject({
  name: text,
  type: z.enum(["file", "directory", "unknown"]),
  bytes: count.max(INSPECTION_LIMITS.declaredBytes),
  compressedBytes: count.optional(),
  encrypted: z.boolean().optional(),
  modifiedAt: text.optional(),
  comment: text.optional(),
  owner: text.optional(),
  group: text.optional(),
  mode: count.optional(),
});
export type ArchiveEntry = z.infer<typeof ArchiveEntrySchema>;
export const TarMetadataSchema = z.strictObject({
  kind: z.literal("tar"),
  entries: z.array(ArchiveEntrySchema).max(INSPECTION_LIMITS.entries),
  declaredBytes: count.max(INSPECTION_LIMITS.declaredBytes),
});
export type TarMetadata = z.infer<typeof TarMetadataSchema>;
export const AdditionalPdfInfoSchema = z.discriminatedUnion("kind", [
  z.strictObject({ key: text, kind: z.enum(["string", "name"]), value: text }),
  z.strictObject({ key: text, kind: z.literal("number"), value: z.number() }),
  z.strictObject({ key: text, kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ key: text, kind: z.literal("null"), value: z.null() }),
  z.strictObject({
    key: text,
    kind: z.literal("unsupported"),
    objectType: z.enum(["array", "dictionary", "stream", "reference", "unknown"]),
  }),
]);
export type AdditionalPdfInfo = z.infer<typeof AdditionalPdfInfoSchema>;
export const XmpPacketSchema = z.strictObject({
  text: z.string().max(INSPECTION_LIMITS.pdfMetadataBytes),
  bytes: count.max(INSPECTION_LIMITS.pdfMetadataBytes),
  encoding: z.enum(["utf-8", "utf-16le", "utf-16be"]),
  compression: z.enum(["none", "flate"]),
});
export type XmpPacket = z.infer<typeof XmpPacketSchema>;
const MediaTagsSchema = z.strictObject({
  title: text.optional(),
  artist: text.optional(),
  album: text.optional(),
  date: text.optional(),
  comment: text.optional(),
  genre: text.optional(),
  encoder: text.optional(),
});
const MediaStreamSchema = z.strictObject({
  index: count.max(INSPECTION_LIMITS.mediaStreams),
  type: z.enum(["audio", "video", "subtitle", "data", "attachment"]),
  codec: text,
  profile: text.optional(),
  durationSeconds: z.number().nonnegative().max(INSPECTION_LIMITS.mediaDurationSeconds).optional(),
  bitRate: count.max(INSPECTION_LIMITS.mediaBitRate).optional(),
  width: count.max(INSPECTION_LIMITS.mediaDimension).optional(),
  height: count.max(INSPECTION_LIMITS.mediaDimension).optional(),
  sampleRate: count.max(INSPECTION_LIMITS.mediaSampleRate).optional(),
  channels: count.max(INSPECTION_LIMITS.mediaChannels).optional(),
  channelLayout: text.optional(),
  tags: z.strictObject({ title: text.optional(), language: text.optional() }),
});
export const MediaMetadataSchema = z.strictObject({
  kind: z.literal("media"),
  format: MediaFormatSchema,
  container: text,
  durationSeconds: z.number().nonnegative().max(INSPECTION_LIMITS.mediaDurationSeconds).optional(),
  bitRate: count.max(INSPECTION_LIMITS.mediaBitRate).optional(),
  tags: MediaTagsSchema,
  streams: z.array(MediaStreamSchema).min(1).max(INSPECTION_LIMITS.mediaStreams),
});
export type MediaMetadata = z.infer<typeof MediaMetadataSchema>;
export const MetadataSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("pdf"),
    pageCount: count,
    xmpPresent: z.boolean(),
    xmp: XmpPacketSchema.nullable(),
    additionalInfo: z.array(AdditionalPdfInfoSchema).max(INSPECTION_LIMITS.pdfInfoEntries),
    additionalInfoComplete: z.boolean(),
    info: z.strictObject({
      title: text.optional(),
      author: text.optional(),
      subject: text.optional(),
      keywords: text.optional(),
      creator: text.optional(),
      producer: text.optional(),
      creationDate: text.optional(),
      modificationDate: text.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("zip"),
    comment: text,
    entries: z.array(ArchiveEntrySchema).max(INSPECTION_LIMITS.entries),
    declaredBytes: count.max(INSPECTION_LIMITS.declaredBytes),
  }),
  TarMetadataSchema,
  z.strictObject({
    kind: z.literal("gzip"),
    firstMember: z.strictObject({
      originalName: text.optional(),
      comment: text.optional(),
      modifiedAt: text.optional(),
    }),
    expandedBytes: count.max(INSPECTION_LIMITS.expandedBytes),
    payloadMime: text.nullable(),
    archive: TarMetadataSchema.nullable(),
  }),
  MediaMetadataSchema,
]);
export type InspectionMetadata = z.infer<typeof MetadataSchema>;
export const InspectionResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    detectedMime: text,
    metadata: MetadataSchema,
    notes: z.array(text),
  }),
  z.strictObject({ ok: z.literal(false), code: InspectionCodeSchema }),
]);
export type InspectionResult = z.infer<typeof InspectionResultSchema>;

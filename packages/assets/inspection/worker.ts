import { ZodError, z } from "zod";
import { inspectGzip } from "./gzip.ts";
import { inspectPdf } from "./pdf.ts";
import {
  INSPECTION_LIMITS,
  InspectionError,
  type InspectionMetadata,
  type InspectionResult,
  InspectionResultSchema,
} from "./schema.ts";
import { inspectTar } from "./tar.ts";
import { inspectZip } from "./zip.ts";

const WorkerFormatSchema = z.enum([".pdf", ".zip", ".tar", ".gz", ".tar.gz"]);

async function inspect(): Promise<InspectionResult> {
  const format = WorkerFormatSchema.parse(process.argv[2]);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    if (!Buffer.isBuffer(chunk)) throw new InspectionError("ASSET_INSPECTION_FAILED");
    bytes += chunk.length;
    if (bytes > INSPECTION_LIMITS.inputBytes) throw new InspectionError("ASSET_INSPECTION_LIMIT");
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  let metadata: InspectionMetadata;
  let mime: string;
  const notes: string[] = [];
  switch (format) {
    case ".pdf":
      metadata = await inspectPdf(input);
      mime = "application/pdf";
      notes.push(
        "PDF Info scalars and catalog XMP packet text only. Complex or unresolved additional Info values are marked unsupported. XML entities, scripts and external resources are never interpreted or fetched; page text and attachments are not inspected.",
      );
      break;
    case ".zip":
      metadata = await inspectZip(input);
      mime = "application/zip";
      notes.push(
        "Container MIME and central directory only; payloads, application subtypes, CRCs and actual expanded sizes are not inspected. Link types without Unix attributes may be unknown.",
      );
      break;
    case ".tar":
      metadata = await inspectTar(input);
      mime = "application/x-tar";
      notes.push(
        "Standard TAR header fields only; extended attributes and payloads need manual review. Entry bytes are never written or recursively inspected.",
      );
      break;
    case ".gz":
    case ".tar.gz":
      metadata = await inspectGzip(input, format === ".tar.gz");
      mime = "application/gzip";
      notes.push(
        "Header fields describe the first GZIP member only; the expanded byte budget covers all concatenated members. Payload MIME uses supported format signatures, not recursive payload parsing.",
      );
      break;
    default: {
      const exhaustive: never = format;
      return exhaustive;
    }
  }
  return InspectionResultSchema.parse({
    ok: true,
    detectedMime: mime,
    metadata,
    notes,
  });
}

let result: InspectionResult;
try {
  result = await inspect();
} catch (error) {
  if (error instanceof InspectionError) result = { ok: false, code: error.code };
  else if (error instanceof ZodError) result = { ok: false, code: "ASSET_INSPECTION_LIMIT" };
  else result = { ok: false, code: "ASSET_INSPECTION_FAILED" };
}
const output = JSON.stringify(result);
process.stdout.write(
  Buffer.byteLength(output) > INSPECTION_LIMITS.outputBytes
    ? '{"ok":false,"code":"ASSET_INSPECTION_LIMIT"}'
    : output,
);

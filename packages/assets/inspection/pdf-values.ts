import {
  PDFArray,
  PDFBool,
  type PDFContext,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFObject,
  PDFRef,
  PDFStream,
  PDFString,
} from "pdf-lib";
import {
  type AdditionalPdfInfo,
  AdditionalPdfInfoSchema,
  INSPECTION_LIMITS,
  InspectionError,
} from "./schema.ts";

const standardInfo = new Set([
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
  "CreationDate",
  "ModDate",
]);

export function resolvePdfValue(
  context: PDFContext,
  initial: PDFObject | undefined,
): PDFObject | undefined {
  let value = initial;
  const seen = new Set<string>();
  for (
    let depth = 0;
    value instanceof PDFRef && depth < INSPECTION_LIMITS.pdfReferenceDepth;
    depth += 1
  ) {
    if (seen.has(value.tag)) return value;
    seen.add(value.tag);
    const next = context.lookup(value);
    if (next === undefined) return value;
    value = next;
  }
  return value;
}

function describeValue(key: string, value: PDFObject | undefined): AdditionalPdfInfo {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return { key, kind: "string", value: value.decodeText() };
  }
  if (value instanceof PDFName) return { key, kind: "name", value: value.decodeText() };
  if (value instanceof PDFNumber) return { key, kind: "number", value: value.asNumber() };
  if (value instanceof PDFBool) return { key, kind: "boolean", value: value.asBoolean() };
  if (value === PDFNull) return { key, kind: "null", value: null };
  const objectType =
    value instanceof PDFRef
      ? "reference"
      : value instanceof PDFArray
        ? "array"
        : value instanceof PDFDict
          ? "dictionary"
          : value instanceof PDFStream
            ? "stream"
            : "unknown";
  return { key, kind: "unsupported", objectType };
}

export function readAdditionalInfo(pdf: PDFDocument): readonly AdditionalPdfInfo[] {
  const info = resolvePdfValue(pdf.context, pdf.context.trailerInfo.Info);
  if (info === undefined || info === PDFNull) return [];
  if (!(info instanceof PDFDict)) throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
  const entries = info.entries();
  if (entries.length > INSPECTION_LIMITS.pdfInfoEntries) {
    throw new InspectionError("ASSET_INSPECTION_LIMIT");
  }
  return entries.flatMap(([name, raw]) => {
    const key = name.decodeText();
    if (standardInfo.has(key)) return [];
    return [AdditionalPdfInfoSchema.parse(describeValue(key, resolvePdfValue(pdf.context, raw)))];
  });
}

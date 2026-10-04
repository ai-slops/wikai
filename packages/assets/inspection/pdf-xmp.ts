import { inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import { resolvePdfValue } from "./pdf-values.ts";
import { INSPECTION_LIMITS, InspectionError, type XmpPacket } from "./schema.ts";

export function readXmp(pdf: PDFDocument): XmpPacket | null {
  const stream = resolvePdfValue(pdf.context, pdf.catalog.get(PDFName.of("Metadata"), true));
  if (stream === undefined || stream === PDFNull) return null;
  if (!(stream instanceof PDFRawStream))
    throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
  for (const name of ["F", "FFilter", "FDecodeParms"]) {
    if (stream.dict.has(PDFName.of(name)))
      throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
  }
  for (const [key, expected] of [
    ["Type", "Metadata"],
    ["Subtype", "XML"],
  ] as const) {
    const value = resolvePdfValue(pdf.context, stream.dict.get(PDFName.of(key)));
    if (!(value instanceof PDFName) || value.decodeText() !== expected) {
      throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
    }
  }
  const contents = stream.getContents();
  if (contents.byteLength > INSPECTION_LIMITS.pdfMetadataBytes) {
    throw new InspectionError("ASSET_INSPECTION_LIMIT");
  }
  let filter = resolvePdfValue(pdf.context, stream.dict.get(PDFName.of("Filter")));
  let parameters = resolvePdfValue(pdf.context, stream.dict.get(PDFName.of("DecodeParms")));
  if (filter instanceof PDFArray) {
    if (filter.size() !== 1) throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
    filter = resolvePdfValue(pdf.context, filter.get(0));
    if (!(filter instanceof PDFName)) throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
    if (parameters instanceof PDFArray) {
      if (parameters.size() !== 1) throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
      parameters = resolvePdfValue(pdf.context, parameters.get(0));
    }
  }
  let bytes: Uint8Array = contents;
  let compression: XmpPacket["compression"] = "none";
  if (filter !== undefined && filter !== PDFNull) {
    if (!(filter instanceof PDFName) || !["FlateDecode", "Fl"].includes(filter.decodeText())) {
      throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
    }
    if (parameters !== undefined && parameters !== PDFNull) {
      if (
        !(parameters instanceof PDFDict) ||
        parameters.keys().some((key) => key.decodeText() !== "Predictor")
      ) {
        throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
      }
      const predictor = resolvePdfValue(pdf.context, parameters.get(PDFName.of("Predictor")));
      if (
        predictor !== undefined &&
        predictor !== PDFNull &&
        (!(predictor instanceof PDFNumber) || predictor.asNumber() !== 1)
      ) {
        throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
      }
    }
    try {
      bytes = inflateSync(contents, { maxOutputLength: INSPECTION_LIMITS.pdfMetadataBytes });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") {
        throw new InspectionError("ASSET_INSPECTION_LIMIT");
      }
      throw error;
    }
    compression = "flate";
  } else if (parameters !== undefined && parameters !== PDFNull) {
    throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
  }
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
  ) {
    throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
  }
  const encoding =
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)
      ? "utf-16le"
      : (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)
        ? "utf-16be"
        : "utf-8";
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (text.includes("\u0000")) throw new InspectionError("ASSET_PDF_METADATA_UNSUPPORTED");
  return { text, bytes: bytes.byteLength, encoding, compression };
}

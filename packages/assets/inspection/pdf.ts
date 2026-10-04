import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import { readAdditionalInfo } from "./pdf-values.ts";
import { readXmp } from "./pdf-xmp.ts";
import { InspectionError, type InspectionMetadata } from "./schema.ts";

export async function inspectPdf(input: Buffer): Promise<InspectionMetadata> {
  if (input.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new InspectionError("ASSET_INSPECTION_FAILED");
  }
  try {
    const pdf = await PDFDocument.load(input, {
      updateMetadata: false,
      ignoreEncryption: false,
      throwOnInvalidObject: true,
    });
    const additionalInfo = readAdditionalInfo(pdf);
    const xmp = readXmp(pdf);
    return {
      kind: "pdf",
      pageCount: pdf.getPageCount(),
      xmpPresent: xmp !== null,
      xmp,
      additionalInfo: [...additionalInfo],
      additionalInfoComplete: additionalInfo.every((entry) => entry.kind !== "unsupported"),
      info: {
        title: pdf.getTitle(),
        author: pdf.getAuthor(),
        subject: pdf.getSubject(),
        keywords: pdf.getKeywords(),
        creator: pdf.getCreator(),
        producer: pdf.getProducer(),
        creationDate: pdf.getCreationDate()?.toISOString(),
        modificationDate: pdf.getModificationDate()?.toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === new EncryptedPDFError().message) {
      throw new InspectionError("ASSET_INSPECTION_ENCRYPTED");
    }
    throw error;
  }
}

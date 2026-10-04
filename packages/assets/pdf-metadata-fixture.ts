import { type PDFDict, PDFDocument, PDFHexString, PDFName, type PDFRawStream } from "pdf-lib";

export const xmpPacket =
  '<?xpacket begin="\ufeff"?><x:xmpmeta xmlns:x="adobe:ns:meta/">PRIVATE_SENTINEL_XMP 한글</x:xmpmeta><?xpacket end="w"?>';

export async function pdfWithMetadata(
  edit: (pdf: PDFDocument, info: PDFDict) => void,
): Promise<Buffer> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage();
  const info = pdf.context.obj({ Title: PDFHexString.fromText("Public title") });
  pdf.context.trailerInfo.Info = pdf.context.register(info);
  edit(pdf, info);
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

export function setXmp(pdf: PDFDocument, bytes: Uint8Array, compressed = false): PDFRawStream {
  const dictionary = { Type: PDFName.of("Metadata"), Subtype: PDFName.of("XML") };
  const stream = compressed
    ? pdf.context.flateStream(bytes, dictionary)
    : pdf.context.stream(bytes, dictionary);
  pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(stream));
  return stream;
}

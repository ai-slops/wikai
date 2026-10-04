import { PDFName, PDFNull, PDFRef, PDFString } from "pdf-lib";
import { expect, it } from "vitest";
import { inspectBytes } from "./inspection/run.ts";
import { pdfWithMetadata, setXmp } from "./pdf-metadata-fixture.ts";

it.each([
  { key: "Type", remove: true },
  { key: "Type", remove: false },
  { key: "Subtype", remove: true },
  { key: "Subtype", remove: false },
])(
  "rejects missing/null metadata declaration $key with remove=$remove",
  async ({ key, remove }) => {
    const bytes = await pdfWithMetadata((pdf) => {
      const stream = setXmp(pdf, Buffer.from("plain metadata bytes"));
      if (remove) stream.dict.delete(PDFName.of(key));
      else stream.dict.set(PDFName.of(key), PDFNull);
    });
    expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
      ok: false,
      code: "ASSET_PDF_METADATA_UNSUPPORTED",
    });
  },
);

it.each([false, true])(
  "bounds XMP raw and inflated bytes with compressed=%s",
  async (compressed) => {
    const bytes = await pdfWithMetadata((pdf) => {
      setXmp(pdf, Buffer.alloc(65537, 0x20), compressed);
    });
    expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
      ok: false,
      code: "ASSET_INSPECTION_LIMIT",
    });
  },
);

it("bounds the total number of Info dictionary entries", async () => {
  const bytes = await pdfWithMetadata((_pdf, info) => {
    for (let index = 0; index < 128; index += 1)
      info.set(PDFName.of(`Key${index}`), PDFString.of("value"));
  });
  expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
    ok: false,
    code: "ASSET_INSPECTION_LIMIT",
  });
});

it("does not truncate an oversized custom value and call the inventory complete", async () => {
  const bytes = await pdfWithMetadata((_pdf, info) => {
    info.set(PDFName.of("Private"), PDFString.of("x".repeat(4097)));
  });
  expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
    ok: false,
    code: "ASSET_INSPECTION_LIMIT",
  });
});

it.each([
  "unsupported-filter",
  "filter-chain",
  "null-filter",
  "predictor",
  "external-file",
  "bad-reference",
  "metadata-cycle",
  "wrong-subtype",
])("refuses unsupported XMP metadata: %s", async (kind) => {
  const bytes = await pdfWithMetadata((pdf) => {
    const stream = setXmp(pdf, Buffer.from("<x/>"), kind !== "null-filter");
    switch (kind) {
      case "unsupported-filter":
        stream.dict.set(PDFName.of("Filter"), PDFName.of("ASCII85Decode"));
        break;
      case "filter-chain":
        stream.dict.set(
          PDFName.of("Filter"),
          pdf.context.obj([PDFName.of("FlateDecode"), PDFName.of("FlateDecode")]),
        );
        break;
      case "null-filter":
        stream.dict.set(PDFName.of("Filter"), pdf.context.obj([PDFNull]));
        break;
      case "predictor":
        stream.dict.set(PDFName.of("DecodeParms"), pdf.context.obj({ Predictor: 12 }));
        break;
      case "external-file":
        stream.dict.set(PDFName.of("F"), PDFString.of("/private/never-read.xml"));
        break;
      case "bad-reference":
        pdf.catalog.set(PDFName.of("Metadata"), PDFRef.of(9999));
        break;
      case "metadata-cycle": {
        const ref = pdf.context.nextRef();
        pdf.context.assign(ref, ref);
        pdf.catalog.set(PDFName.of("Metadata"), ref);
        break;
      }
      case "wrong-subtype":
        stream.dict.set(PDFName.of("Subtype"), PDFName.of("Image"));
        break;
    }
  });
  expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
    ok: false,
    code: "ASSET_PDF_METADATA_UNSUPPORTED",
  });
});

it.each([Buffer.from([0xff, 0xfe, 0, 0, 0x3c, 0, 0, 0]), Buffer.from([0, 0, 0xfe, 0xff])])(
  "refuses UTF-32 rather than mislabeling it as UTF-16",
  async (content) => {
    const bytes = await pdfWithMetadata((pdf) => {
      setXmp(pdf, content);
    });
    expect((await inspectBytes(bytes, ".pdf")).ok).toBe(false);
  },
);

it.each([Buffer.from([0xc3, 0x28]), Buffer.from([0xff, 0xfe, 0x3c])])(
  "rejects malformed text encoding without including input in diagnostics",
  async (content) => {
    const bytes = await pdfWithMetadata((pdf) => {
      setXmp(pdf, content);
    });
    expect((await inspectBytes(bytes, ".pdf")).ok).toBe(false);
  },
);

import {
  PDFBool,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFObject,
  PDFString,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { inspectBytes } from "./inspection/run.ts";
import { pdfWithMetadata, setXmp, xmpPacket } from "./pdf-metadata-fixture.ts";

describe("private PDF extended metadata", () => {
  it.each([false, true])("reads an inert XMP packet with compressed=%s", async (compressed) => {
    const bytes = await pdfWithMetadata((pdf) => {
      setXmp(pdf, Buffer.from(xmpPacket), compressed);
    });
    expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
      ok: true,
      metadata: {
        kind: "pdf",
        xmpPresent: true,
        xmp: {
          encoding: "utf-8",
          compression: compressed ? "flate" : "none",
          bytes: Buffer.byteLength(xmpPacket),
          text: xmpPacket,
        },
        additionalInfo: [],
        additionalInfoComplete: true,
      },
    });
  });

  it.each(["utf-8-bom", "utf-16le", "utf-16be"])(
    "decodes %s without interpreting XML",
    async (encoding) => {
      const content =
        encoding === "utf-8-bom"
          ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xmpPacket)])
          : Buffer.from(`\ufeff${xmpPacket}`, "utf16le");
      if (encoding === "utf-16be") content.swap16();
      const bytes = await pdfWithMetadata((pdf) => {
        setXmp(pdf, content);
      });
      expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
        ok: true,
        metadata: {
          xmp: {
            text: xmpPacket,
            encoding: encoding === "utf-8-bom" ? "utf-8" : encoding,
            bytes: content.length,
          },
        },
      });
    },
  );

  it("supports one indirect FlateDecode filter with an identity predictor", async () => {
    const bytes = await pdfWithMetadata((pdf) => {
      const stream = setXmp(pdf, Buffer.from(xmpPacket), true);
      stream.dict.set(
        PDFName.of("Filter"),
        pdf.context.obj([pdf.context.register(PDFName.of("FlateDecode"))]),
      );
      stream.dict.set(
        PDFName.of("DecodeParms"),
        pdf.context.obj([pdf.context.register(pdf.context.obj({ Predictor: 1 }))]),
      );
    });
    expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
      ok: true,
      metadata: { xmp: { text: xmpPacket, compression: "flate" } },
    });
  });

  it("resolves indirect metadata Type and Subtype names", async () => {
    const bytes = await pdfWithMetadata((pdf) => {
      const stream = setXmp(pdf, Buffer.from(xmpPacket));
      stream.dict.set(PDFName.of("Type"), pdf.context.register(PDFName.of("Metadata")));
      stream.dict.set(PDFName.of("Subtype"), pdf.context.register(PDFName.of("XML")));
    });
    expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
      ok: true,
      metadata: { xmp: { text: xmpPacket } },
    });
  });

  it("distinguishes absent metadata from an empty packet", async () => {
    const absent = await pdfWithMetadata((pdf) => {
      delete pdf.context.trailerInfo.Info;
    });
    expect(await inspectBytes(absent, ".pdf")).toMatchObject({
      ok: true,
      metadata: { xmpPresent: false, xmp: null, additionalInfo: [], additionalInfoComplete: true },
    });
    const empty = await pdfWithMetadata((pdf) => {
      setXmp(pdf, Buffer.alloc(0));
    });
    expect(await inspectBytes(empty, ".pdf")).toMatchObject({
      ok: true,
      metadata: { xmpPresent: true, xmp: { text: "", bytes: 0 } },
    });
  });

  it("reports custom scalar Info fields with types instead of assigning attacker-controlled keys", async () => {
    const bytes = await pdfWithMetadata((pdf, info) => {
      info.set(
        PDFName.of("Internal Project"),
        pdf.context.register(PDFHexString.fromText("PRIVATE_SENTINEL_INFO 한글")),
      );
      info.set(PDFName.of("Department"), PDFString.of("Engineering"));
      info.set(PDFName.of("Revision"), PDFNumber.of(3));
      info.set(PDFName.of("Approved"), PDFBool.False);
      info.set(PDFName.of("Trapped"), PDFName.of("Unknown"));
      info.set(PDFName.of("Empty"), PDFNull);
      info.set(PDFName.of("__proto__"), PDFString.of("inert data"));
    });
    const result = await inspectBytes(bytes, ".pdf");
    expect(result).toMatchObject({
      ok: true,
      metadata: {
        additionalInfoComplete: true,
        additionalInfo: expect.arrayContaining([
          { key: "Internal Project", kind: "string", value: "PRIVATE_SENTINEL_INFO 한글" },
          { key: "Department", kind: "string", value: "Engineering" },
          { key: "Revision", kind: "number", value: 3 },
          { key: "Approved", kind: "boolean", value: false },
          { key: "Trapped", kind: "name", value: "Unknown" },
          { key: "Empty", kind: "null", value: null },
          { key: "__proto__", kind: "string", value: "inert data" },
        ]),
      },
    });
  });

  it("marks complex and cyclic custom values as unsupported rather than dropping them", async () => {
    const bytes = await pdfWithMetadata((pdf, info) => {
      info.set(
        PDFName.of("Nested"),
        pdf.context.obj({ Private: PDFString.of("NESTED_VALUE_NOT_READ") }),
      );
      info.set(PDFName.of("Array"), pdf.context.obj([PDFString.of("ARRAY_VALUE_NOT_READ")]));
      const first = pdf.context.nextRef();
      const second = pdf.context.nextRef();
      pdf.context.assign(first, second);
      pdf.context.assign(second, first);
      info.set(PDFName.of("Cycle"), first);
    });
    const result = await inspectBytes(bytes, ".pdf");
    expect(result).toMatchObject({
      ok: true,
      metadata: {
        additionalInfoComplete: false,
        additionalInfo: expect.arrayContaining([
          { key: "Nested", kind: "unsupported", objectType: "dictionary" },
          { key: "Array", kind: "unsupported", objectType: "array" },
          { key: "Cycle", kind: "unsupported", objectType: "reference" },
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("VALUE_NOT_READ");
  });

  it("keeps external entities and script text inert instead of resolving or executing them", async () => {
    const packet =
      '<!DOCTYPE x [<!ENTITY private SYSTEM "file:///private/not-readable">]><x>&private;<script>process.exit(99)</script></x>';
    const bytes = await pdfWithMetadata((pdf) => {
      setXmp(pdf, Buffer.from(packet), true);
    });
    expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
      ok: true,
      metadata: { xmp: { text: packet } },
    });
  });

  it.each([8, 9])("bounds custom Info reference chains at eight hops: %s", async (depth) => {
    const bytes = await pdfWithMetadata((pdf, info) => {
      let value: PDFObject = PDFString.of("bounded value");
      for (let index = 0; index < depth; index += 1) value = pdf.context.register(value);
      info.set(PDFName.of("Chain"), value);
    });
    const expected =
      depth === 8
        ? { key: "Chain", kind: "string", value: "bounded value" }
        : { key: "Chain", kind: "unsupported", objectType: "reference" };
    expect(await inspectBytes(bytes, ".pdf")).toMatchObject({
      ok: true,
      metadata: { additionalInfo: [expected], additionalInfoComplete: depth === 8 },
    });
  });
});

import { crc32, deflateRawSync } from "node:zlib";
import { PDFDocument, PDFName } from "pdf-lib";
import { pack } from "tar-stream";

export async function pdfBytes(encrypted = false) {
  const document = await PDFDocument.create();
  document.addPage();
  document.setTitle("검토용 PDF");
  document.setAuthor("PRIVATE_SENTINEL_PDF_AUTHOR");
  document.setSubject("Private review only");
  document.setCreator("Fixture creator");
  document.setProducer("Fixture producer");
  document.setCreationDate(new Date("2026-09-01T00:00:00Z"));
  document.addJavaScript("never-run", "throw new Error('attachment code must not run')");
  const xmp = document.context.stream("<metadata>PRIVATE_SENTINEL_XMP</metadata>", {
    Type: PDFName.of("Metadata"),
    Subtype: PDFName.of("XML"),
  });
  document.catalog.set(PDFName.of("Metadata"), document.context.register(xmp));
  if (encrypted)
    document.context.trailerInfo.Encrypt = document.context.obj({ Filter: PDFName.of("Standard") });
  return Buffer.from(await document.save());
}

export function zipBytes(
  entries: readonly {
    readonly name: string;
    readonly body?: string;
    readonly declaredBytes?: number;
    readonly compressed?: boolean;
    readonly symlink?: boolean;
  }[],
  comment = "",
) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = Buffer.from(entry.body ?? "private payload not included in inventory");
    const data = entry.compressed ? deflateRawSync(body) : body;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(entry.compressed ? 8 : 0, 8);
    local.writeUInt32LE(crc32(body), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.declaredBytes ?? body.length, 22);
    local.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE((3 << 8) | 20, 4);
    local.copy(record, 6, 4, 28);
    record.writeUInt32LE(((entry.symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    central.push(record, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(directory.length, 12);
  footer.writeUInt32LE(offset, 16);
  footer.writeUInt16LE(Buffer.byteLength(comment), 20);
  return Buffer.concat([...locals, directory, footer, Buffer.from(comment)]);
}

export async function tarBytes(
  entries: readonly {
    readonly name: string;
    readonly body?: string;
    readonly type?: "file" | "symlink" | "link";
    readonly linkname?: string;
  }[],
) {
  const archive = pack();
  for (const entry of entries) {
    archive.entry(
      {
        name: entry.name,
        type: entry.type ?? "file",
        ...(entry.linkname === undefined ? {} : { linkname: entry.linkname }),
        uname: "PRIVATE_SENTINEL_ARCHIVE_OWNER",
        mtime: new Date("2026-09-01T00:00:00Z"),
      },
      entry.body ?? "private payload",
    );
  }
  archive.finalize();
  const chunks: Buffer[] = [];
  for await (const value of archive) {
    if (!Buffer.isBuffer(value)) throw new TypeError("Expected archive bytes");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

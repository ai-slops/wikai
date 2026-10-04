import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { inspectBytes } from "./inspection/run.ts";
import { pdfBytes, tarBytes, zipBytes } from "./inspection-fixture.ts";

describe("bounded private attachment metadata", () => {
  it("reads PDF Info and inert XMP without rendering or evaluating scripts", async () => {
    const result = await inspectBytes(await pdfBytes(), ".pdf");
    expect(result).toMatchObject({
      ok: true,
      metadata: {
        kind: "pdf",
        pageCount: 1,
        xmpPresent: true,
        xmp: { text: "<metadata>PRIVATE_SENTINEL_XMP</metadata>", encoding: "utf-8" },
        info: {
          title: "검토용 PDF",
          author: "PRIVATE_SENTINEL_PDF_AUTHOR",
          creator: "Fixture creator",
        },
      },
    });
  });

  it("lists ZIP central-directory names, sizes and comments without reading payloads", async () => {
    const result = await inspectBytes(
      zipBytes([{ name: "private/이름.txt", body: "PAYLOAD_SENTINEL" }], "Private archive comment"),
      ".zip",
    );
    expect(result).toMatchObject({
      ok: true,
      metadata: {
        kind: "zip",
        comment: "Private archive comment",
        entries: [{ name: "private/이름.txt", bytes: 16 }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("PAYLOAD_SENTINEL");
  });

  it("does not read compressed ZIP mimetype entries to refine the container MIME", async () => {
    const bytes = zipBytes([{ name: "mimetype", body: "application/epub+zip", compressed: true }]);
    expect(await inspectBytes(bytes, ".zip")).toMatchObject({
      ok: true,
      detectedMime: "application/zip",
    });
  });

  it("does not decode nested ZIP mimetype entries when identifying GZIP payloads", async () => {
    const bytes = zipBytes([{ name: "mimetype", body: "application/epub+zip", compressed: true }]);
    expect(await inspectBytes(gzipSync(bytes), ".gz")).toMatchObject({
      ok: true,
      metadata: { kind: "gzip", payloadMime: "application/zip" },
    });
  });

  it("lists TAR names and owner metadata without extracting any entry", async () => {
    const result = await inspectBytes(
      await tarBytes([{ name: "folder/note.txt", body: "PAYLOAD_SENTINEL" }]),
      ".tar",
    );
    expect(result).toMatchObject({
      ok: true,
      metadata: {
        kind: "tar",
        entries: [{ name: "folder/note.txt", owner: "PRIVATE_SENTINEL_ARCHIVE_OWNER" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("PAYLOAD_SENTINEL");
  });

  it("lists TAR.GZ members through bounded decompression", async () => {
    const bytes = gzipSync(await tarBytes([{ name: "inside.txt" }]));
    const result = await inspectBytes(bytes, ".gz");
    expect(result).toMatchObject({
      ok: true,
      metadata: { kind: "gzip", archive: { kind: "tar", entries: [{ name: "inside.txt" }] } },
    });
  });

  it("reports generic GZIP output size without exposing decompressed text", async () => {
    const result = await inspectBytes(gzipSync(Buffer.from("PRIVATE_GZIP_PAYLOAD")), ".gz");
    expect(result).toMatchObject({
      ok: true,
      metadata: { kind: "gzip", expandedBytes: 20, archive: null },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_GZIP_PAYLOAD");
  });

  it("reports the detected GZIP payload MIME without recursively parsing its contents", async () => {
    const result = await inspectBytes(gzipSync(Buffer.from("%PDF-1.4\n")), ".gz");
    expect(result).toMatchObject({
      ok: true,
      metadata: { kind: "gzip", payloadMime: "application/pdf", archive: null },
    });
  });

  it.each([".pdf", ".zip", ".tar", ".gz"])(
    "rejects malformed %s input without echoing its bytes",
    async (extension) => {
      const result = await inspectBytes(Buffer.from("PRIVATE_SENTINEL_BAD_INPUT"), extension);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL_BAD_INPUT");
    },
  );
});

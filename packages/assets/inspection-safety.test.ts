import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { inspectBytes } from "./inspection/run.ts";
import { pdfBytes, tarBytes, zipBytes } from "./inspection-fixture.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("refuses encryption rather than silently ignoring it", async () => {
  expect(await inspectBytes(await pdfBytes(true), ".pdf")).toMatchObject({
    ok: false,
    code: "ASSET_INSPECTION_ENCRYPTED",
  });
});

it("does not inherit executable NODE_OPTIONS from the parent environment", async () => {
  vi.stubEnv("NODE_OPTIONS", "--require=/private/never-load-this.cjs");
  expect((await inspectBytes(zipBytes([]), ".zip")).ok).toBe(true);
});

it("returns a bounded failure instead of truncating an oversized metadata report", async () => {
  const bytes = zipBytes(
    Array.from({ length: 300 }, (_, index) => ({ name: `${index}-${"a".repeat(4000)}` })),
  );
  expect(await inspectBytes(bytes, ".zip")).toMatchObject({
    ok: false,
    code: "ASSET_INSPECTION_LIMIT",
  });
});

it.each(["../secret.txt", "/absolute.txt", "C:\\private.txt"])(
  "rejects unsafe ZIP entry %s",
  async (name) => {
    expect((await inspectBytes(zipBytes([{ name }]), ".zip")).ok).toBe(false);
  },
);

it.each(["../secret.txt", "/absolute.txt", "C:\\private.txt"])(
  "rejects unsafe TAR entry %s",
  async (name) => {
    expect((await inspectBytes(await tarBytes([{ name }]), ".tar")).ok).toBe(false);
  },
);

it("rejects duplicate ZIP names rather than giving an ambiguous inventory", async () => {
  const bytes = zipBytes([{ name: "same.txt" }, { name: "same.txt" }]);
  expect(await inspectBytes(bytes, ".zip")).toMatchObject({
    ok: false,
    code: "ASSET_ARCHIVE_UNSAFE",
  });
});

it("rejects ZIP symlinks without opening their contents", async () => {
  expect((await inspectBytes(zipBytes([{ name: "link", symlink: true }]), ".zip")).ok).toBe(false);
});

it("rejects TAR link entries without following their target", async () => {
  const bytes = await tarBytes([
    { name: "link", type: "symlink", linkname: "../secret", body: "" },
  ]);
  expect((await inspectBytes(bytes, ".tar")).ok).toBe(false);
});

it("bounds ZIP declared expansion and member count without decompressing entries", async () => {
  const large = zipBytes([
    { name: "bomb.txt", compressed: true, declaredBytes: 600 * 1024 * 1024 },
  ]);
  expect(await inspectBytes(large, ".zip")).toMatchObject({
    ok: false,
    code: "ASSET_INSPECTION_LIMIT",
  });
  const many = zipBytes(Array.from({ length: 1001 }, (_, index) => ({ name: `${index}.txt` })));
  expect(await inspectBytes(many, ".zip")).toMatchObject({
    ok: false,
    code: "ASSET_INSPECTION_LIMIT",
  });
});

it("stops a GZIP expansion exceeding the bounded output budget", async () => {
  const bytes = gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1));
  expect(await inspectBytes(bytes, ".gz")).toMatchObject({
    ok: false,
    code: "ASSET_INSPECTION_LIMIT",
  });
});

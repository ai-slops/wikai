import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWrite, hash, replaceDirectory, safePath, withLock } from "./index.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wikai-fs-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("filesystem boundary", () => {
  it("rejects traversal instead of reading outside the vault", async () => {
    // Given a private root, when an untrusted path traverses, then reject it.
    await expect(safePath(root, "../secret")).rejects.toMatchObject({
      code: "ASSET_PATH_TRAVERSAL",
    });
  });
  it("rejects symlink components even inside the allowed root", async () => {
    // Given a symlink, when resolving it, then reject it.
    await mkdir(join(root, "real"));
    await symlink(join(root, "real"), join(root, "alias"));
    await expect(safePath(root, "alias/file")).rejects.toMatchObject({ code: "ASSET_SYMLINK" });
  });
  it("retains a concurrently edited file when its expected hash is stale", async () => {
    // Given newer content, when a stale write is attempted, then preserve it.
    const path = join(root, "note.md");
    await writeFile(path, "newer");
    await expect(atomicWrite(path, "replacement", hash("older"))).rejects.toMatchObject({
      code: "CONCURRENT_SOURCE_MODIFICATION",
    });
    expect(await readFile(path, "utf8")).toBe("newer");
  });
  it("rejects concurrent state mutation while the lock is held", async () => {
    // Given an acquired lock, when another writer arrives, then reject it.
    await withLock(root, async () => {
      await expect(withLock(root, async () => undefined)).rejects.toMatchObject({
        code: "PUBLICATION_LOCKED",
      });
    });
  });
  it("rejects symlink staging rather than promoting it", async () => {
    await mkdir(join(root, "vault"));
    await symlink(join(root, "vault"), join(root, "staging"));
    await expect(replaceDirectory(join(root, "staging"), join(root, "dist"))).rejects.toMatchObject(
      { code: "ASSET_SYMLINK" },
    );
  });
  it("does not create directories through a symlink before rejecting a write", async () => {
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(root, "alias"));
    await expect(atomicWrite(join(root, "alias", "new", "file"), "secret")).rejects.toMatchObject({
      code: "ASSET_SYMLINK",
    });
    await expect(readFile(join(root, "outside", "new", "file"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

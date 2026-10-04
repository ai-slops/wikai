import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { INSPECTION_LIMITS, InspectionError, type InspectionMetadata } from "./schema.ts";
import { inspectTar } from "./tar.ts";

export async function inspectGzip(input: Buffer, expectTar: boolean): Promise<InspectionMetadata> {
  if (input.length < 18 || input[0] !== 0x1f || input[1] !== 0x8b || input[2] !== 8) {
    throw new InspectionError("ASSET_INSPECTION_FAILED");
  }
  const flags = input[3] ?? 0;
  if (flags & 0xe0) throw new InspectionError("ASSET_INSPECTION_FAILED");
  let cursor = 10;
  if (flags & 4) {
    cursor += 2 + input.readUInt16LE(cursor);
    if (cursor > input.length - 8) throw new InspectionError("ASSET_INSPECTION_FAILED");
  }
  const readText = (): string => {
    const end = input.indexOf(0, cursor);
    if (end < 0 || end > input.length - 8) throw new InspectionError("ASSET_INSPECTION_FAILED");
    if (end - cursor > INSPECTION_LIMITS.textCharacters)
      throw new InspectionError("ASSET_INSPECTION_LIMIT");
    const value = input.subarray(cursor, end).toString("latin1");
    cursor = end + 1;
    return value;
  };
  const originalName = flags & 8 ? readText() : undefined;
  const comment = flags & 16 ? readText() : undefined;
  const timestamp = input.readUInt32LE(4);
  const chunks: Buffer[] = [];
  let expandedBytes = 0;
  await pipeline(Readable.from([input]), createGunzip(), async (source) => {
    for await (const chunk of source) {
      if (!Buffer.isBuffer(chunk)) throw new InspectionError("ASSET_INSPECTION_FAILED");
      expandedBytes += chunk.length;
      if (expandedBytes > INSPECTION_LIMITS.expandedBytes)
        throw new InspectionError("ASSET_INSPECTION_LIMIT");
      chunks.push(chunk);
    }
  });
  const expanded = Buffer.concat(chunks);
  const tar =
    expectTar ||
    originalName?.toLowerCase().endsWith(".tar") ||
    expanded.subarray(257, 262).toString("ascii") === "ustar";
  const archive = tar ? await inspectTar(expanded) : null;
  const signatures = [
    ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ["application/zip", [0x50, 0x4b, 0x03, 0x04]],
    ["application/zip", [0x50, 0x4b, 0x05, 0x06]],
    ["application/zip", [0x50, 0x4b, 0x07, 0x08]],
    ["application/gzip", [0x1f, 0x8b, 0x08]],
  ] as const;
  const payloadMime =
    archive !== null
      ? "application/x-tar"
      : (signatures.find(([, signature]) =>
          signature.every((byte, index) => expanded[index] === byte),
        )?.[0] ?? null);
  return {
    kind: "gzip",
    firstMember: {
      originalName,
      comment,
      modifiedAt: timestamp === 0 ? undefined : new Date(timestamp * 1000).toISOString(),
    },
    expandedBytes,
    payloadMime,
    archive,
  };
}

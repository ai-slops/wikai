import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWrite, hash } from "../fs/index.ts";
import type { PublicRedirect } from "../model/index.ts";
import { PublisherError } from "../model/index.ts";

const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const ReleaseIdentitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  revisions: z.record(z.string().regex(/^pub_[A-Za-z0-9_-]+$/u), HashSchema),
  redirectsHash: HashSchema,
  stagingPolicyHash: HashSchema,
});
export const ReleaseReceiptSchema = ReleaseIdentitySchema.extend({
  distFingerprintHash: HashSchema,
});
const POLICY_FILES = ["content-index.json", "publication-manifest.json", "redirects.json"] as const;

export type ReleaseIdentity = Readonly<z.infer<typeof ReleaseIdentitySchema>>;
export type ReleaseReceipt = Readonly<z.infer<typeof ReleaseReceiptSchema>>;

const decode = <T>(schema: z.ZodType<T>, raw: string, code: string): T => {
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error) {
      throw new PublisherError(code, "Private release identity is missing or invalid");
    }
    throw error;
  }
};

export function revisionsForRelease(
  revisions: readonly { readonly publicId: string; readonly revisionHash: string }[],
): Record<string, string> {
  return Object.fromEntries(
    [...revisions]
      .sort((left, right) => left.publicId.localeCompare(right.publicId))
      .map((revision) => [revision.publicId, revision.revisionHash]),
  );
}

export function redirectsPolicyHash(redirects: readonly PublicRedirect[]): string {
  return hash(`${JSON.stringify({ schemaVersion: 1, redirects })}\n`);
}

export function directoryFingerprintHash(fingerprint: readonly object[]): string {
  return hash(JSON.stringify(fingerprint));
}

export async function releasePolicyHash(root: string): Promise<string> {
  return hash(
    JSON.stringify(
      await Promise.all(
        POLICY_FILES.map(async (name) => ({
          name,
          digest: hash(await readFile(join(root, name))),
        })),
      ),
    ),
  );
}

export async function writeReleaseIdentity(
  stateDir: string,
  identity: ReleaseIdentity,
): Promise<void> {
  await atomicWrite(
    join(stateDir, "release-input.json"),
    `${JSON.stringify(ReleaseIdentitySchema.parse(identity), null, 2)}\n`,
  );
}

export async function readReleaseIdentity(stateDir: string): Promise<ReleaseIdentity> {
  try {
    return decode(
      ReleaseIdentitySchema,
      await readFile(join(stateDir, "release-input.json"), "utf8"),
      "RELEASE_IDENTITY_INVALID",
    );
  } catch (error) {
    if (error instanceof PublisherError) throw error;
    if (error instanceof Error) {
      throw new PublisherError(
        "RELEASE_IDENTITY_INVALID",
        "Private release identity cannot be read",
      );
    }
    throw error;
  }
}

export async function writeReleaseReceipt(
  stateDir: string,
  receipt: ReleaseReceipt,
): Promise<void> {
  await atomicWrite(
    join(stateDir, "release-receipt.json"),
    `${JSON.stringify(ReleaseReceiptSchema.parse(receipt), null, 2)}\n`,
  );
}

export async function readReleaseReceipt(stateDir: string): Promise<ReleaseReceipt> {
  try {
    return decode(
      ReleaseReceiptSchema,
      await readFile(join(stateDir, "release-receipt.json"), "utf8"),
      "RELEASE_RECEIPT_INVALID",
    );
  } catch (error) {
    if (error instanceof PublisherError) throw error;
    if (error instanceof Error) {
      throw new PublisherError("RELEASE_RECEIPT_INVALID", "Private release receipt cannot be read");
    }
    throw error;
  }
}

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { hash } from "../fs/index.ts";
import { Publisher } from "../service/index.ts";
import { createServiceFixture } from "../service/test-fixture.ts";
import { mediaFixture } from "./media-fixture.ts";

let root: string;
let vault: string;
let publisher: Publisher;

beforeEach(async () => {
  const fixture = await createServiceFixture();
  ({ root, vault } = fixture);
  await mkdir(join(vault, "public-assets"));
  publisher = await Publisher.open(fixture.configPath);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("returns typed media metadata without changing bytes or granting hash review", async () => {
  const bytes = await mediaFixture("tone.mp3");
  await writeFile(join(vault, "public-assets/tone.mp3"), bytes);

  const report = await publisher.inspectAsset("public-assets/tone.mp3");

  expect(report).toMatchObject({
    sha256: hash(bytes),
    detectedMime: "audio/mpeg",
    hashReviewed: false,
    reviewBlockers: ["ASSET_REVIEW_REQUIRED"],
    inspection: {
      ok: true,
      metadata: {
        kind: "media",
        tags: { title: "PRIVATE_SENTINEL_MEDIA_TITLE" },
        streams: [{ type: "audio", codec: "mp3" }],
      },
    },
  });
  expect(await readFile(join(vault, "public-assets/tone.mp3"))).toEqual(bytes);
  expect(publisher.config.assets.reviewedHashes).toEqual([]);
});

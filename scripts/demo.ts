import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stringify } from "yaml";
import { atomicWrite, isFsError } from "../packages/fs/index.ts";
import { PublisherError } from "../packages/model/index.ts";
import { demoNotes } from "./demo-notes.ts";

const root = resolve(".local");
const configPath = resolve(root, "publisher.config.yaml");
try {
  await access(configPath);
  throw new PublisherError(
    "DEMO_ALREADY_EXISTS",
    "Demo already exists. Existing private data will not be overwritten.",
  );
} catch (error) {
  if (!isFsError(error, "ENOENT")) throw error;
}
await mkdir(resolve(root, "vault"), { recursive: true, mode: 0o700 });
for (const note of demoNotes) {
  const path = resolve(root, "vault", note.path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await atomicWrite(path, `---\n${stringify(note.frontmatter)}---\n\n${note.body}`);
}
await atomicWrite(
  configPath,
  stringify({
    schemaVersion: 1,
    vault: { root: "vault" },
    publisher: {
      stateDir: "vault/.publisher",
      previewStagingDir: "preview",
      releaseStagingDir: "release",
    },
    site: {
      sourceDir: "../site",
      distDir: "public-dist",
      url: "https://example.invalid",
      isolatedBuild: true,
      network: "disabled",
      image: "wikai-site:local",
    },
  }),
);
const { Publisher } = await import("../packages/service/index.ts");
const publisher = await Publisher.open(configPath);
for (const id of [
  "pub_demo_boundary",
  "pub_demo_work",
  "pub_demo_about",
  "pub_demo_now",
  "pub_demo_contact",
]) {
  const plan = await publisher.plan();
  const working = plan.publications.find((publication) => publication.publicId === id);
  if (!working)
    throw new PublisherError("DEMO_PUBLICATION_MISSING", "A demo publication was not discovered.");
  await publisher.approve(id, working.exposureHash);
}
console.log(
  "Demo created in ignored .local/. Five snapshots approved; candidates and one blocked example are ready to review. Run npm start.",
);

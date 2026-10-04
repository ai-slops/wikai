import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createServiceFixture(): Promise<{
  readonly root: string;
  readonly vault: string;
  readonly configPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "wikai-service-"));
  const vault = join(root, "vault");
  await Promise.all([mkdir(vault), mkdir(join(root, "site"))]);
  await mkdir(join(vault, "public-views"));
  const configPath = join(root, "publisher.config.yaml");
  await writeFile(
    configPath,
    `schemaVersion: 1
vault:
  root: ./vault
publisher:
  stateDir: ./state
  previewStagingDir: ./preview
  releaseStagingDir: ./release
publicViews:
  roots: [public-views]
site:
  sourceDir: ./site
  distDir: ./dist
`,
  );
  return { root, vault, configPath };
}

export function knowledgeSource(input: {
  readonly privateId: string;
  readonly publicId: string;
  readonly title: string;
  readonly slug?: string;
  readonly body: string;
  readonly comment?: string;
}): string {
  return `---\n${input.comment === undefined ? "" : `# ${input.comment}\n`}id: ${input.privateId}\ntitle: ${input.title}\npublic:\n  id: ${input.publicId}\n  status: review\n  mode: mirror\n  kind: knowledge\n  summary: ${JSON.stringify(`${input.title} summary`)}\n  contentState: stable\n  knowledge:\n    documentType: topic\n${input.slug === undefined ? "" : `  slug: ${input.slug}\n`}---\n${input.body}`;
}

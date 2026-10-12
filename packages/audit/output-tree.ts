import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { Diagnostic } from "../model/index.ts";

export type ValidatedOutputTree = Readonly<{
  root: string;
  files: readonly string[];
  relativeFiles: ReadonlySet<string>;
}>;

export type OutputTreeInspection =
  | Readonly<{ valid: true; tree: ValidatedOutputTree }>
  | Readonly<{ valid: false; diagnostics: readonly Diagnostic[] }>;

const diagnostic = (code: string, message: string, sourcePath: string): Diagnostic => ({
  code,
  severity: "error",
  message,
  sourcePath,
});

export async function inspectOutputTree(root: string): Promise<OutputTreeInspection> {
  const absoluteRoot = resolve(root);
  const files: string[] = [];
  const diagnostics: Diagnostic[] = [];
  const inspect = async (path: string): Promise<void> => {
    const info = await lstat(path);
    const relativePath =
      path === absoluteRoot ? "." : relative(absoluteRoot, path).split(sep).join("/");
    if (info.isSymbolicLink()) {
      diagnostics.push(
        diagnostic("AUDIT_SYMLINK", "Distribution contains a symbolic link", relativePath),
      );
      return;
    }
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) await inspect(resolve(path, entry));
      return;
    }
    if (info.isFile()) {
      files.push(relativePath);
      return;
    }
    diagnostics.push(
      diagnostic(
        "AUDIT_NONREGULAR_FILE",
        "Distribution contains a non-regular filesystem entry",
        relativePath,
      ),
    );
  };
  await inspect(absoluteRoot);
  return diagnostics.length === 0
    ? { valid: true, tree: { root: absoluteRoot, files, relativeFiles: new Set(files) } }
    : { valid: false, diagnostics };
}

export async function readOutputFile(
  tree: ValidatedOutputTree,
  relativePath: string,
): Promise<Buffer> {
  const target = resolve(tree.root, relativePath);
  if (!target.startsWith(`${tree.root}${sep}`)) {
    throw new RangeError("Output path escapes the validated distribution root");
  }
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new TypeError("Output path is not a regular file");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function readOutputText(
  tree: ValidatedOutputTree,
  relativePath: string,
): Promise<string> {
  return (await readOutputFile(tree, relativePath)).toString("utf8");
}

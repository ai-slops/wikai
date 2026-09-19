import { resolve, sep } from "node:path";
import type { Diagnostic, PublisherConfig, VaultSnapshot } from "../model/index.ts";

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/,
  /\b(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"']{12,}["']/i,
] as const;

type PrivateMarkers = Readonly<{ ids: readonly string[]; paths: readonly string[] }>;

const diagnostic = (code: string, message: string, sourcePath?: string): Diagnostic => ({
  code,
  severity: "error",
  message,
  ...(sourcePath === undefined ? {} : { sourcePath }),
});

const pathVariants = (path: string): readonly string[] => [
  path,
  path.replaceAll("/", "\\"),
  path.split(sep).join("/"),
];

export const privateMarkers = (config: PublisherConfig, vault?: VaultSnapshot): PrivateMarkers => {
  const roots = [resolve(config.vault.root)];
  if ("local" in config.vault && typeof config.vault.local === "string")
    roots.push(resolve(config.vault.local));
  const ids =
    vault?.documents.flatMap((document) =>
      document.frontmatter.id === undefined ? [] : [document.frontmatter.id],
    ) ?? [];
  const sourcePaths =
    vault?.documents.flatMap((document) => [
      document.sourcePath,
      ...roots.map((root) => resolve(root, document.sourcePath)),
    ]) ?? [];
  return { ids, paths: [...new Set([...roots, ...sourcePaths].flatMap(pathVariants))] };
};

export const scanText = (
  text: string,
  path: string,
  config: PublisherConfig,
  markers: PrivateMarkers,
  approvedIds: ReadonlySet<string>,
): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
  }
  const searchable = `${text}\n${decoded}`;
  if (
    config.security.scanPrivateIdsInDist &&
    (/\bprv_[A-Za-z0-9_-]+\b/.test(searchable) || markers.ids.some((id) => searchable.includes(id)))
  ) {
    diagnostics.push(
      diagnostic("AUDIT_PRIVATE_ID", "Rendered output contains a private identifier", path),
    );
  }
  if (
    config.security.scanPrivatePathsInDist &&
    markers.paths.some((privatePath) => searchable.includes(privatePath))
  ) {
    diagnostics.push(
      diagnostic("AUDIT_PRIVATE_PATH", "Rendered output contains a private source path", path),
    );
  }
  const publicIds = searchable.match(/\bpub_[A-Za-z0-9_-]+\b/g) ?? [];
  if (publicIds.some((id) => !approvedIds.has(id)))
    diagnostics.push(
      diagnostic(
        "AUDIT_UNAPPROVED_PUBLIC_ID",
        "Rendered output contains an unapproved public identifier",
        path,
      ),
    );
  for (const pattern of config.security.denyPatterns) {
    let denied = false;
    try {
      denied = new RegExp(pattern, "u").test(searchable);
    } catch (error) {
      if (error instanceof SyntaxError)
        diagnostics.push(
          diagnostic("AUDIT_INVALID_DENY_PATTERN", "A configured deny pattern is invalid"),
        );
      else throw error;
    }
    if (denied)
      diagnostics.push(
        diagnostic(
          "AUDIT_DENY_PATTERN",
          "Rendered output matches a configured private-data pattern",
          path,
        ),
      );
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(searchable)))
    diagnostics.push(
      diagnostic("AUDIT_SECRET", "Rendered output contains material resembling a credential", path),
    );
  return diagnostics;
};

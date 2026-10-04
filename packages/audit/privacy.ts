import { resolve, sep } from "node:path";
import type { Diagnostic, PublisherConfig, VaultSnapshot } from "../model/index.ts";

export const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/,
  /\b(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"']{12,}["']/i,
] as const;

type PrivateMarkers = Readonly<{
  ids: readonly string[];
  paths: readonly string[];
  titles: readonly string[];
}>;

export type SensitiveTextContext = Readonly<{
  config: PublisherConfig["security"];
  sourcePath?: string;
  publicId?: string;
}>;

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

const warning = (code: string, message: string, context: SensitiveTextContext): Diagnostic => ({
  code,
  severity: "warning",
  message,
  ...(context.sourcePath === undefined ? {} : { sourcePath: context.sourcePath }),
  ...(context.publicId === undefined ? {} : { publicId: context.publicId }),
});

const entropy = (value: string): number => {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0);
};

const withoutExpectedIdentifiers = (text: string): string =>
  text
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/giu, " ")
    .replace(/\b(?:sha(?:256|384|512)|md5):[0-9a-f]+\b/giu, " ")
    .replace(/\b[0-9a-f]{32,}\b/giu, " ");

const entropyCandidates = (text: string): readonly string[] =>
  withoutExpectedIdentifiers(text).match(/[A-Za-z0-9_+/=-]{24,}/gu) ?? [];

const containsPhoneNumber = (text: string): boolean =>
  [
    ...withoutExpectedIdentifiers(text).matchAll(
      /(?<![A-Za-z0-9])\+?\d[\d .()-]{6,}\d(?![A-Za-z0-9])/gu,
    ),
  ].some((match) => {
    const digitCount = (match[0].match(/\d/gu) ?? []).length;
    return digitCount >= 8 && digitCount <= 15;
  });

export const scanSensitiveText = (
  text: string,
  context: SensitiveTextContext,
): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  if ((context.config.scanPii ?? true) && /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(text))
    diagnostics.push(warning("PRIVACY_EMAIL", "Public text may contain an email address", context));
  if ((context.config.scanPii ?? true) && containsPhoneNumber(text))
    diagnostics.push(warning("PRIVACY_PHONE", "Public text may contain a phone number", context));
  if (
    (context.config.scanHighEntropy ?? true) &&
    entropyCandidates(text).some(
      (candidate) =>
        !CREDENTIAL_PATTERNS.some((pattern) => pattern.test(candidate)) && entropy(candidate) >= 4,
    )
  )
    diagnostics.push(
      warning("PRIVACY_HIGH_ENTROPY", "Public text may contain an opaque sensitive value", context),
    );
  return diagnostics;
};

export const privateMarkers = (
  config: PublisherConfig,
  vault?: VaultSnapshot,
  approvedTitles: ReadonlySet<string> = new Set(),
): PrivateMarkers => {
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
  const normalizedApprovedTitles = new Set(
    [...approvedTitles].map((title) => title.normalize("NFC").toLocaleLowerCase("en-US")),
  );
  const titles =
    vault?.documents.flatMap((document) => {
      const title = document.frontmatter.title?.trim();
      if (
        title === undefined ||
        normalizedApprovedTitles.has(title.normalize("NFC").toLocaleLowerCase("en-US"))
      )
        return [];
      return [title];
    }) ?? [];
  return { ids, paths: [...new Set([...roots, ...sourcePaths].flatMap(pathVariants))], titles };
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
  diagnostics.push(...scanSensitiveText(searchable, { config: config.security, sourcePath: path }));
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
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(searchable)))
    diagnostics.push(
      diagnostic("AUDIT_SECRET", "Rendered output contains material resembling a credential", path),
    );
  if (
    (config.security.warnPrivateTitles ?? true) &&
    markers.titles.some((title) =>
      searchable
        .normalize("NFC")
        .toLocaleLowerCase("en-US")
        .includes(title.normalize("NFC").toLocaleLowerCase("en-US")),
    )
  )
    diagnostics.push(
      warning("PRIVACY_PRIVATE_TITLE", "Public output may contain a private document title", {
        config: config.security,
        sourcePath: path,
      }),
    );
  return diagnostics;
};

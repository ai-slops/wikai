import { hash } from "../fs/index.ts";
import type {
  ApprovedRevision,
  MaterializedAsset,
  PublicLink,
  WorkingPublication,
} from "../model/index.ts";

type PublicVersion = WorkingPublication | ApprovedRevision;
type AssetDescriptor = Readonly<Pick<MaterializedAsset, "publicPath" | "hash" | "mime" | "bytes">>;

export type PublicationDifferences = {
  readonly metadata: { readonly changed: boolean; readonly fields: readonly string[] };
  readonly body: {
    readonly changed: boolean;
    readonly markdownChanged: boolean;
    readonly htmlChanged: boolean;
    readonly beforeHash: string | null;
    readonly afterHash: string | null;
  };
  readonly links: {
    readonly added: readonly PublicLink[];
    readonly removed: readonly PublicLink[];
    readonly updated: readonly {
      readonly key: string;
      readonly before: PublicLink;
      readonly after: PublicLink;
    }[];
  };
  readonly assets: {
    readonly added: readonly AssetDescriptor[];
    readonly removed: readonly AssetDescriptor[];
    readonly updated: readonly {
      readonly publicPath: string;
      readonly beforeHash: string;
      readonly afterHash: string;
      readonly before: AssetDescriptor;
      readonly after: AssetDescriptor;
    }[];
  };
  readonly urls: {
    readonly canonical: { readonly before: string | null; readonly after: string | null };
    readonly aliases: { readonly added: readonly string[]; readonly removed: readonly string[] };
  };
};

const managedMetadata = new Set(["publishedAt", "updatedAt", "lastReviewedAt", "lastVerifiedAt"]);
const ordered = <T>(values: readonly T[], key: (value: T) => string): readonly T[] =>
  [...values].sort((left, right) => key(left).localeCompare(key(right)));
const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
const metadataValue = (publication: PublicVersion | null): Readonly<Record<string, unknown>> =>
  publication === null
    ? {}
    : Object.fromEntries(
        Object.entries(publication.metadata).filter(([key]) => !managedMetadata.has(key)),
      );
const assetDescriptor = (asset: MaterializedAsset): AssetDescriptor => ({
  publicPath: asset.publicPath,
  hash: asset.hash,
  mime: asset.mime,
  bytes: asset.bytes,
});
const linkKey = (link: PublicLink): string => `${link.publicId}#${link.anchor ?? ""}`;

function keyedChanges<T>(
  before: readonly T[],
  after: readonly T[],
  key: (value: T) => string,
): {
  readonly added: readonly T[];
  readonly removed: readonly T[];
  readonly pairs: readonly [T, T][];
} {
  const beforeMap = new Map(before.map((value) => [key(value), value]));
  const afterMap = new Map(after.map((value) => [key(value), value]));
  return {
    added: ordered(
      after.filter((value) => !beforeMap.has(key(value))),
      key,
    ),
    removed: ordered(
      before.filter((value) => !afterMap.has(key(value))),
      key,
    ),
    pairs: ordered(
      before.flatMap((value): readonly [T, T][] => {
        const next = afterMap.get(key(value));
        return next === undefined || same(value, next) ? [] : [[value, next]];
      }),
      ([value]) => key(value),
    ),
  };
}

export function publicationDifferences(
  before: PublicVersion | null,
  after: PublicVersion | null,
): PublicationDifferences {
  const beforeMetadata = metadataValue(before);
  const afterMetadata = metadataValue(after);
  const fields = [...new Set([...Object.keys(beforeMetadata), ...Object.keys(afterMetadata)])]
    .filter((field) => !same(beforeMetadata[field], afterMetadata[field]))
    .sort((left, right) => left.localeCompare(right));
  const links = keyedChanges(before?.outgoingLinks ?? [], after?.outgoingLinks ?? [], linkKey);
  const assets = keyedChanges(
    (before?.assets ?? []).map(assetDescriptor),
    (after?.assets ?? []).map(assetDescriptor),
    (asset) => asset.publicPath,
  );
  const beforeAliases = before?.metadata.aliases ?? [];
  const afterAliases = after?.metadata.aliases ?? [];
  return {
    metadata: { changed: fields.length > 0, fields },
    body: {
      changed: before?.markdown !== after?.markdown || before?.html !== after?.html,
      markdownChanged: before?.markdown !== after?.markdown,
      htmlChanged: before?.html !== after?.html,
      beforeHash:
        before === null
          ? null
          : hash(JSON.stringify({ markdown: before.markdown, html: before.html })),
      afterHash:
        after === null
          ? null
          : hash(JSON.stringify({ markdown: after.markdown, html: after.html })),
    },
    links: {
      added: links.added,
      removed: links.removed,
      updated: links.pairs.map(([previous, next]) => ({
        key: linkKey(previous),
        before: previous,
        after: next,
      })),
    },
    assets: {
      added: assets.added,
      removed: assets.removed,
      updated: assets.pairs.map(([previous, next]) => ({
        publicPath: previous.publicPath,
        beforeHash: previous.hash,
        afterHash: next.hash,
        before: previous,
        after: next,
      })),
    },
    urls: {
      canonical: { before: before?.metadata.slug ?? null, after: after?.metadata.slug ?? null },
      aliases: {
        added: afterAliases.filter((alias) => !beforeAliases.includes(alias)).sort(),
        removed: beforeAliases.filter((alias) => !afterAliases.includes(alias)).sort(),
      },
    },
  };
}

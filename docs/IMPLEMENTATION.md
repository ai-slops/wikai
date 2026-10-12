# Wikai implementation contract

The original v0.1 requirements and numbered phase roadmap are recorded in
[`wikai.md`](../wikai.md). This contract describes current interfaces and safety boundaries,
not a completion checklist or a session-specific verification record.

All authored documentation is English. Preserve `.dim` byte-for-byte. Node 24 executes native TypeScript (erasable syntax only); `app/server.mjs` remains the DIM entrypoint. The dashboard binds to loopback by default, with explicit authenticated remote operation for DIM. Do not commit runtime vaults, state, credentials, generated staging, or dist.

## Security boundary

The vault is private by default. Authoring status never constitutes approval. Only immutable approved revisions enter release staging. Source edits and deletion never change an active revision. Withdraw is explicit. Public metadata is reconstructed from an allowlist; source IDs, paths, references, private tags and aliases are never public. Markdown rejects MDX syntax; opted-in `.mdx` uses the isolated MDX compiler contract below. Reject private/unresolved/ambiguous/withdrawn links, note transclusion, raw HTML (strip comments), remote images, symlinks and traversal. Code blocks are not link syntax. Raster images are decoded/re-encoded without metadata and content-addressed. Other attachments require explicit content-hash review under public-assets; executable formats and SVG are forbidden.

Approval binds the exact public Markdown or MDX artifacts, metadata, links and asset hashes, not timestamps or private paths. Expected hashes prevent stale approvals. All state mutations lock, immutable revisions are verified on read, source mutations compare expected file hashes, and state writes use temp-file fsync/rename. Slugs are NFC, case-insensitive collision checked and reserved after withdrawal/move. Release regenerates clean staging, public-only backlinks/search/redirects and audits it before switching. The selected prebuilt renderer profile, either built-in Astro or a custom Docker adapter, runs network-disabled without vault, home, credentials or publisher state mounts. Failed builds/audits never replace existing dist.

## Module ownership and shared contracts

- `packages/model/index.ts`: shared schemas/types, owned by lead.
- `packages/fs`, `packages/config`: filesystem and configuration, owned by lead.
- `packages/compiler`, `packages/markdown`, `packages/vault`, `packages/assets`: compiler owner.
- `packages/state`, `packages/service`, `apps/cli`: service owner.
- `apps/dashboard`, `DESIGN.md`: dashboard owner.
- `site`, `packages/release`, `packages/audit`: site owner.
- `scripts`, integration fixtures, root documentation: lead.

Imports use explicit `.ts` extensions and named exports. Read the shared model before implementing. Never change another owner's files without coordination. No `any`, non-null assertions or type-suppression directives. Keep modules under 250 nonblank source lines. Unit/integration tests use Vitest. Do not commit from worker sessions.

## Compiler API

`loadVault(config): Promise<VaultSnapshot>`; `compile(vault, config, approvedTargets = []): Promise<PublicationPlan>` exported from `packages/compiler/index.ts`. `approvedTargets` are `ApprovedRevision[]`. Plan has working publications and diagnostics. Every working publication includes source path/hash for local conflict checks, safe metadata, Markdown, safe rendered HTML, outgoing links, assets (with base64 sanitized bytes), source references, diagnostics and exposure hash. A private target cannot be approved merely because it has published frontmatter.

## Service API

`Publisher.open(configPath?): Promise<Publisher>` from `packages/service/index.ts`. Methods `plan()`, `status()`, `detail(publicId)`, `approve(publicId, expectedHash)`, `withdraw(publicId, expectedHash, redirect?)`, `candidate(input)`, `project(input)`, `extract(input)`, `sourceUpdate(publicId,input)`, `applySourceUpdate(publicId,input)`, `preview(mode, publicId?)`, `build()`, `audit(path)`, `inspectAsset(path)`, `restore(publicId, revisionHash, expectedHash)`. Read methods return JSON-safe objects. `detail` returns working/approved/history/drift information plus private source references. `plan` extends compiler output with approved revisions, redirects and review-age diagnostics. Candidate input is `{path,kind,mode,expectedHash?}`. Project input is `{path,to,kind,expectedHash?}`. Extract adds one optional `{heading,block,lines}` selector. `status()` returns `{publications, diagnostics}`; publication rows include nullable hashes and independent source drift. Status names include private, candidate, review, published, update-available, blocked, withdrawn, orphaned and source-drift.

Current public-authoring metadata blocks, configuration objects and source-update inputs are strict:
unknown public/config/operation fields and kind-mismatched metadata are rejected. Authored dates
require ISO dates or offset-bearing ISO timestamps as appropriate, and public routes must be
canonical and match their publication kind/layout. Persisted approved revisions intentionally
retain permissive string date fields so immutable legacy revisions remain readable, auditable and
renderable.

## Private attachment inspection

`Publisher.inspectAsset(vaultRelativePath)` returns a private, read-only metadata report
independently of successful working compilation. `assets inspect <path> --json` exposes it.
Current coverage is PDF Info/XMP, ZIP/TAR/GZIP inventories, and MP3/WAV/MP4/WebM metadata, with bounded subprocess parsing
and a shared handle-based asset reader. Reports preserve raw-byte hash review authority;
`reviewBlockers` describes only hash/location requirements, not the complete publication
policy. Referring documents are collected from current public-marked source ASTs; incomplete
inventories are flagged. Report data never enters approved revisions or staging.
See [attachment review](ASSET-REVIEW.md) for resource, platform and coverage boundaries.

PDF reports include typed `additionalInfo`, `additionalInfoComplete`, and nullable `xmp`
packet data. XMP is inert text, not interpreted XML. Catalog streams must declare Metadata/XML;
only raw or one bounded Flate filter with identity parameters is supported. Both encoded and
decoded XMP are capped at 64 KiB, Info dictionaries at 128 entries, and indirect reference
resolution at eight hops. Unsupported complex Info values are represented explicitly;
unsupported or oversized XMP fails safely. The original file and approval hash are unchanged.
Media inspection uses `/usr/local/bin/ffprobe` behind `prlimit`, accepts bytes only through a pipe,
restricts protocols and demuxers, and reports common container tags and stream headers. It does not
return frames, samples, cover art or codec payloads.

## Source-reference contract

New extractions store optional `public.sources[].selection` with version 1 and a heading/block
value or canonical line count. With this field, `capturedHash` hashes only normalized fragment
content; without it, the existing full-file hash contract remains unchanged, regardless of
`anchor`. Candidate drift uses working references, including parsed references for blocked
previews; approved drift uses stored approved references. Approval retains whole-file
concurrency checks, recaptures resolvable heading/block baselines and preserves unresolved
baselines. Revision restoration preserves historical selections. These fields remain private.
See [source tracking](SOURCE-TRACKING.md) for the complete semantics and downgrade warning.

## Public tag contract

Newly authored `public.tags` and metadata tag patches are canonical NFC, case-sensitive path
strings separated by `/`. Plain one-segment tags remain valid. Empty segments, `.` and `..`
segments, control characters and backslash separators are rejected. No core segment is reserved;
category conventions belong to optional UI policy. Parent paths are inferred for listing and tree
responses and are never stored in a registry or written into source metadata.

`Publisher.tagList()`, `tagTree()` and `filterByTags({tags,mode})` read only explicit current
`public.tags`; private frontmatter tags are not a fallback. Multi-tag filtering requires every
query to match. `mode: "exact"` matches only the complete tag, while `mode: "subtree"` also matches
descendants at a segment boundary. `planTagRename({from,to,mode})` returns a read-only plan whose
changes include each source path and hash. `applyTagRename({...input,expectedHash})` regenerates the
plan under the publication lock and updates only current public tag arrays through
`MetadataPatchSchema`. It does not approve, withdraw, restore or modify active revisions, and it
retains unrelated tags and source content.

The CLI exposes `tags list`, `tags tree`, `tags filter`, and `tags rename plan/apply`; `--subtree`
selects descendant semantics and exact matching is the default. Rename apply requires the reviewed
plan hash and confirmation. `PersistedMetadataSchema` intentionally continues accepting historical
tag strings without current authoring validation or normalization, so existing revision bytes and
hashes require no migration and are never rewritten by tag management.

## MDX contract

MDX is disabled unless `mdx.enabled` is true. `compileMdx()` resolves the configured image to its
immutable Docker image ID before checking the private cache, snapshots every allowed file under the
configured component and data roots, and binds the source body/path, roots, dependency hashes,
image reference and image ID into the snapshot identity. Docker is therefore required for image
identity resolution even when a matching compiled artifact is cached.

Dependency snapshots accept `.css`, `.js`, `.json`, `.jsx`, `.mjs`, `.ts` and `.tsx`, reject
symlinks, and enforce `maxProfileBytes`. The runtime receives only the selected MDX source and the
snapshotted roots. Imports may use React/React DOM/JSX runtime packages or files that resolve inside
those roots; other bare package imports and files outside those roots fail. Root dependencies are
not a general package allowlist. The compiler container has no network, a read-only root,
capability and process/resource limits, and only a temporary output volume.

The immutable result contains fallback HTML, a React 19 hydration module and optional stylesheet.
Private dependency source is retained only in private snapshots/revisions; release staging exposes
only verified artifacts and their public descriptors. Artifact hashes identify reviewed bytes but
do not establish safe browser behavior. See [MDX and hierarchical tags](MDX-AND-TAGS.md) and the
[renderer protocol](RENDERERS.md).

`planComponentUpdateApproval()` returns eligible profile-only MDX updates, skipped publications
with explicit reasons, and `planHash`. Eligibility requires an already approved, currently
published MDX publication with an explicit slug, no blocking or source drift, unchanged authored
MDX/content input, metadata, tags, body, links and assets, and a changed profile digest. Apply
recomputes the whole plan under the publication lock and checks the reviewed hash plus active,
source, content and profile identities. It approves the entire eligible list atomically while
leaving skipped active revisions unchanged. First-time MDX approval remains a separate ordinary
approval.

`sourceUpdate(publicId,input)` is a read-only projection merge plan. Input identifies a tracked
`sourceId`, an optional zero-based `referenceIndex`, and at most one replacement selector. The
plan includes both bodies, line changes, diagnostics, `canApply`, source/projection hashes and an
`expectedHash`. `applySourceUpdate` accepts the same selection, the complete reviewed body and that
hash, then atomically updates the private projection and captured source reference. It rejects
blocked selections and any changed source, projection or plan. Approval remains a separate action.

## Release API

`buildReleaseStaging(approved, config, redirects = []): Promise<ReleaseManifest>`; `buildSite(config): Promise<{distPath:string}>`; `auditDist(path, config, vault?): Promise<Diagnostic[]>`, exported from `packages/release/index.ts` and `packages/audit/index.ts`. Staging content-index JSON is `{schemaVersion:1,pages:[{metadata,markdown,html,outgoingLinks,backlinks,assets}]}`. Public manifest contains only page metadata. Staging assets use their public path. Site must consume ONLY this contract and never import publisher or vault modules.

A successful isolated build writes private `release-input.json` and `release-receipt.json` evidence
under `publisher.stateDir`. The receipt binds revision hashes, redirects, staging policy files and
the complete dist fingerprint. Local directory deployment revalidates that receipt, current state,
dist bytes and the privacy audit before atomically replacing the configured destination. It retains
one `.previous` generation and matching immutable private deployment evidence per environment.
Rollback audits and swaps that exact previous generation and evidence, then records its revisions.

## State maintenance

Private state writes use schema 2; supported v1 reads are migrated in memory without writes.
Historical source hashes/reference arrays and restored active references may be null when
recovery cannot establish them. Unknown active capture metadata reports drift. State writes
use the baseline hash from `readStateSnapshot`, not a later reread, and expected-absence
creation is no-clobber. An initialization marker and retained revision entries distinguish
missing state from a new store.

`planStateMaintenance(input)` and `applyStateMaintenance(input, expectedHash)` are exported by
`packages/state/maintenance.ts`. Input contains `mode: "recover" | "migrate"`, `stateDir` and
optional recovery-only `backupPath`/`bindingsPath`. Plans are read-only private reports.
Recovery checks snapshot integrity and source ownership inputs, reserves known URLs and
reconstructs inactive history only; migration preserves existing activation. Applying locks,
regenerates/hash-checks the plan and preserves exact original bytes before state replacement.
See [the operational recovery contract](STATE-RECOVERY.md) for limits and review steps.

## Interfaces and acceptance

CLI commands: status, validate (`--strict`), plan, candidate, project, extract (heading/block/lines), source-update plan/apply, tags list/tree/filter/rename plan/rename apply, components plan/approve, preview (`--working`/`--approved`), diff, approve (`--expected-hash`), withdraw (`--expected-hash`/`--redirect`), build `--release`, audit, restore, state recover/migrate/release-slug/gc, assets inspect, and deploy directory/rollback. Reading commands accept `--json`; ordinary mutations require confirmation/`--yes`. Plan/apply operations require their documented apply flag or mutation command, the reviewed `--expected-hash`, and confirmation. Secrets and excerpts never appear in default errors. Attachment inspection and operation reports are private artifacts.

Dashboard: publication queue with search/state/kind filters, review page with working/approved rendered previews and four-part diff, metadata editing, source drift and history, bounded attachment inspection, manual source-update comparison/repair, hierarchical tag query/rename tools, component-only plan/approval, assets and diagnostics, approve exact hash, withdraw confirmation, candidate/project/extract forms and build. Local API validates typed request schemas and uses a CSRF token, same-origin checks, loopback default, sandboxed previews and no arbitrary file-read endpoint.

Astro: Work/Knowledge/Log/Page detail and collection routes, landing home, About/Now/Contact, nested category routes derived only from `category/...` tags, search defaults to Work+Knowledge with opt-in Log, feeds all/work/knowledge/log, sitemap only index=true, noindex per document, canonical, redirects, public-only backlinks and React 19 MDX hydration. No source maps. English accessible responsive UI.

Tests must prove default-private, published without approval stays private, public/private link policy, exposure hash stability for private-only changes, asset mutation changes hash, stale approval failure, lock contention, source edits/deletion preserve approved release, withdrawal removes stale files, redirects/reservations, source drift, extraction excludes surrounding private text, traversal/symlink rejection, raw HTML and MDX-in-Markdown rejection, opted-in MDX isolation and artifact integrity, sentinel absence, and actual isolated builds cannot access private data or network.

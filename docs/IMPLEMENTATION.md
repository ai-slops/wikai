# Wikai implementation contract

All authored documentation is English. Preserve `.dim` byte-for-byte. Node 24 executes native TypeScript (erasable syntax only); `app/server.mjs` remains the DIM entrypoint. The dashboard binds to loopback by default, with explicit authenticated remote operation for DIM. Do not commit runtime vaults, state, credentials, generated staging, or dist.

## Security boundary

The vault is private by default. Authoring status never constitutes approval. Only immutable approved revisions enter release staging. Source edits and deletion never change an active revision. Withdraw is explicit. Public metadata is reconstructed from an allowlist; source IDs, paths, references, private tags and aliases are never public. Reject private/unresolved/ambiguous/withdrawn links, note transclusion, MDX, raw HTML (strip comments), remote images, symlinks and traversal. Code blocks are not link syntax. Raster images are decoded/re-encoded without metadata and content-addressed. Other attachments require explicit content-hash review under public-assets; executable formats and SVG are forbidden.

Approval binds the exact public Markdown, metadata, links and asset hashes, not timestamps or private paths. Expected hashes prevent stale approvals. All state mutations lock, immutable revisions are verified on read, source mutations compare expected file hashes, and state writes use temp-file fsync/rename. Slugs are NFC, case-insensitive collision checked and reserved after withdrawal/move. Release regenerates clean staging, public-only backlinks/search/redirects and audits it before switching. A separate prebuilt network-disabled Docker image renders Astro without vault, home, credentials or publisher state mounts. Failed builds/audits never replace existing dist.

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

`Publisher.open(configPath?): Promise<Publisher>` from `packages/service/index.ts`. Methods `plan()`, `status()`, `detail(publicId)`, `approve(publicId, expectedHash)`, `withdraw(publicId, expectedHash, redirect?)`, `candidate(input)`, `project(input)`, `extract(input)`, `preview(mode, publicId?)`, `build()`, `audit(path)`, `restore(publicId, revisionHash, expectedHash)`. Read methods return JSON-safe objects. `detail` returns `{working, approved, history, sourceDrift}`. `plan` extends compiler plan with `approved` and `redirects`. Candidate input `{path,kind,mode,expectedHash?}`. Project input `{path,to,kind,expectedHash?}`. Extract adds optional `{heading,block,lines}`. `status()` returns `{publications, diagnostics}`; publication row `{publicId,title,slug,kind,status,exposureHash,approvedHash,sourcePath,diagnostics,sourceDrift}` with nullable absent hashes. Status names: private, candidate, review, published, update-available, blocked, withdrawn, orphaned, source-drift.

## Release API

`buildReleaseStaging(approved, config, redirects = []): Promise<ReleaseManifest>`; `buildSite(config): Promise<{distPath:string}>`; `auditDist(path, config, vault?): Promise<Diagnostic[]>`, exported from `packages/release/index.ts` and `packages/audit/index.ts`. Staging content-index JSON is `{schemaVersion:1,pages:[{metadata,markdown,html,outgoingLinks,backlinks,assets}]}`. Public manifest contains only page metadata. Staging assets use their public path. Site must consume ONLY this contract and never import publisher or vault modules.

## Interfaces and acceptance

CLI commands: status, validate (--strict), plan, candidate, project, extract (heading/block/lines), preview (--working/--approved), diff, approve (--expected-hash), withdraw (--expected-hash/--redirect), build --release, audit, restore. Reading commands accept --json; mutations require explicit confirmation/--yes and support expected hashes. Secrets and excerpts never appear in default errors.

Dashboard: publication queue with search/state/kind filters, review page with working/approved rendered previews and four-part diff, metadata editing, source drift and history, assets and diagnostics, approve exact hash, withdraw confirmation, candidate/project/extract forms and build. Local API uses CSRF token, same-origin checks, loopback default, safe previews, no arbitrary file read endpoint.

Astro: Work/Knowledge/Log/Page detail and collection routes, landing home, About/Now/Contact, search defaults to Work+Knowledge with opt-in Log, feeds all/work/knowledge/log, sitemap only index=true, noindex per document, canonical, redirects and public-only backlinks. No source maps. English accessible responsive UI.

Tests must prove default-private, published without approval stays private, public/private link policy, exposure hash stability for private-only changes, asset mutation changes hash, stale approval failure, lock contention, source edits/deletion preserve approved release, withdrawal removes stale files, redirects/reservations, source drift, extraction excludes surrounding private text, traversal/symlink rejection, raw HTML/MDX rejection, sentinel absence, and actual isolated build cannot access private data or network.

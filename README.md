# Wikai

**Write privately. Publish deliberately.**

Wikai turns a private Markdown vault into a selectively published static site. It separates writing, review, approval, and rendering so editing a note never silently changes an existing public page.

```text
Private Markdown vault
  → public-safe compiler preview
  → explicit hash-bound approval
  → immutable private revision store
  → clean public staging
  → isolated, network-disabled static renderer
  → privacy audit
  → public dist
```

## Requirements

- Node.js 24 or newer and npm.
- Docker access for isolated release builds and for opted-in MDX compilation. Markdown-only
  dashboard, CLI, compiler and approval workflows do not require Docker.
- A private vault outside the public site's source directory.
- Linux, util-linux `/usr/bin/prlimit`, and `/usr/local/bin/ffprobe` for bounded PDF,
  archive, MP3, WAV, MP4, and WebM inspection.

The DIM lifecycle files in `.dim` are preserved. Its entrypoint remains `node app/server.mjs`. The application does not require changes to DIM's images or service definitions.

## Try the local demo

```bash
npm ci
npm run demo
npm start
```

Open `http://127.0.0.1:3000`. The demo creates an ignored `.local/` vault with illustrative projects, knowledge, field notes, approved snapshots and a deliberately blocked private-link example. It refuses to overwrite existing demo data. Nothing is deployed automatically.

The dashboard is a private administrative interface. It listens on loopback by default. Remote access requires explicit authenticated configuration; see [security and operations](docs/SECURITY.md). Never expose the studio as your public website.

## Connect a real vault

Copy `publisher.config.example.yaml` to an ignored `publisher.config.yaml`. Resolve relative paths from the configuration file's location. Keep preview, release staging and dist outside the vault and public site source.

```bash
WIKAI_CONFIG=publisher.config.yaml npm start
npm run wiki-pub -- --config publisher.config.yaml status --json
```

An ordinary note needs no frontmatter and remains private. A whole-note publication uses a mirror:

```yaml
---
id: prv_my_design
title: A deliberate publication boundary
public:
  id: pub_my_design
  status: review
  mode: mirror
  kind: knowledge
  slug: /knowledge/publication-boundary
  summary: Separate private writing from reviewed public snapshots.
  contentState: stable
  knowledge:
    documentType: design
---
```

Use a projection when the source contains private context. A projection is a separate Markdown document in the vault; its optional `public.sources` entries are private tracking data, never public output. Extracting a heading, block or line range copies the selected text without live transclusion.

New extractions track changes to the selected fragment and report source drift even before
approval. Unrelated source edits do not trigger fragment drift, and existing references retain
their whole-file hash semantics. See [extraction and source tracking](docs/SOURCE-TRACKING.md)
for selector rules, approval baselines and version compatibility.

Tracked projections can be repaired without automatic overwrite. `source-update plan` produces
a read-only comparison and hash; the operator supplies the complete reviewed merged body to
`source-update apply`. The dashboard exposes the same comparison, editable merge body, blocked
diagnostics, and stale-plan refusal.

## Publication workflow

```bash
npm run wiki-pub -- --help
npm run wiki-pub -- status --json
npm run wiki-pub -- validate --json
npm run wiki-pub -- plan --json
npm run wiki-pub -- candidate topics/design.md --kind knowledge --mode mirror --yes
npm run wiki-pub -- project projects/example.md --kind work --to public-views/work/example.md --yes
npm run wiki-pub -- extract journal/today.md --heading "Public idea" --kind log --to public-views/log/idea.md --yes
npm run wiki-pub -- preview --working --json
npm run wiki-pub -- diff pub_my_design --format json
npm run wiki-pub -- approve pub_my_design --expected-hash sha256:REPLACE_WITH_REVIEWED_HASH --yes
npm run wiki-pub -- preview --approved --json
npm run wiki-pub -- withdraw pub_my_design --expected-hash sha256:REPLACE_WITH_APPROVED_HASH --yes
```

Read the current command help for argument details. Source-writing commands support expected source hashes; approval and withdrawal support expected exposure hashes. JSON reports are private review artifacts and must not be uploaded with the public site.

`public.status: published` alone does not publish a note. Approvals freeze content, metadata, public links and attachment bytes. Later source edits appear as updates; source deletion appears as orphaned rather than withdrawn. Revision history remains private and is retained after withdrawal.

## Hierarchical tags and MDX

`public.tags` supports case-sensitive, slash-separated paths. Parent paths are inferred; they are
not added to source metadata. Query or rename current public tags with exact matching by default,
or include descendants with `--subtree`:

```bash
npm run wiki-pub -- tags list --json
npm run wiki-pub -- tags tree --json
npm run wiki-pub -- tags filter topic/design status/stable --json
npm run wiki-pub -- tags rename plan topic/design topic/product-design --subtree --json
npm run wiki-pub -- tags rename apply topic/design topic/product-design --subtree --expected-hash sha256:REPLACE_WITH_PLAN_HASH --yes
```

The core tag namespace has no reserved root. Only the Astro renderer interprets the exact
`category/...` root as nested `/categories/...` pages. Other tags and custom renderers remain
namespace-agnostic.

MDX is disabled by default. Before enabling the existing `mdx` block in
`publisher.config.example.yaml`, build its compiler image from the repository root:

```bash
docker build -t wikai-mdx:local -f packages/mdx/image/Dockerfile .
```

Opted-in `.mdx` can import React and files under the configured `componentRoots` and `dataRoots`.
Arbitrary package imports are not available just because a package is a root dependency. Shared
dependency changes can be reviewed as a strictly component-only batch:

```bash
npm run wiki-pub -- components plan --json
npm run wiki-pub -- components approve --expected-hash sha256:REPLACE_WITH_PLAN_HASH --yes
```

The plan lists both eligible and skipped publications. A first approval, authored MDX change, or
any metadata, tag, link, asset, source-drift, workflow or diagnostic reason is skipped and uses the
ordinary per-publication review flow; applying the batch leaves skipped active revisions intact.
See [MDX and hierarchical tags](docs/MDX-AND-TAGS.md) for the complete operator boundary.

## State maintenance

Missing state in an initialized store now blocks normal operation rather than appearing empty.
State v1 remains readable; writes use v2, which can represent unknown recovery captures honestly.

```bash
npm run wiki-pub -- state migrate --json
npm run wiki-pub -- state recover --backup /private/backups/state.json --json
```

These commands are read-only by default. Applying requires `--apply`, a reviewed plan's
`--expected-hash` and confirmation. Recovery preserves original bytes, verifies revisions and
keeps every publication inactive. Read [state migration and recovery](docs/STATE-RECOVERY.md)
before applying, supplying source bindings or restoring a revision.

## Inspect an attachment before approval

```bash
npm run wiki-pub -- assets inspect public-assets/report.pdf --json
npm run wiki-pub -- assets inspect public-assets/bundle.zip --json
```

This private, read-only report shows the byte hash, container MIME, original/prospective names,
referring candidate documents, bounded PDF Info/XMP or ZIP/TAR/GZIP metadata, and bounded
`ffprobe` container/tag/stream metadata for MP3, WAV, MP4, and WebM. Custom PDF Info scalars and
inert XMP packet text are supported; complex values are explicitly marked. It does not mark a hash
reviewed or publish anything. Read [attachment review](docs/ASSET-REVIEW.md) for supported fields,
Linux resource limits and the metadata/content that still needs manual review.

## Build the public site

Prepare the pinned renderer image first. Prepare the MDX image too when MDX is enabled:

```bash
docker build -t wikai-mdx:local -f packages/mdx/image/Dockerfile .
docker build -t wikai-site:local site
npm run wiki-pub -- build --release --yes
npm run wiki-pub -- audit .local/public-dist --json
```

Image preparation uses the network. Actual release rendering does not. The build container receives only approved staging and site code, with no vault, publisher state, home, SSH keys or Git credentials. Build or audit failure preserves the previous dist. A successful build records a private receipt binding the exact approved revisions, redirect policy, staging policy, and dist fingerprint.

Configured local directory deployment and rollback are available, but are disabled until a
`deployments` environment is added to the private configuration. Both are read-only plans by
default and require the reviewed `planHash`, `--apply`, and confirmation. Remote hosting providers,
cache purge, health-check switching, and 410 responses are not implemented. See the
[operations runbook](docs/OPERATIONS.md).

The default Astro adapter provides Work, Knowledge, Log and fixed pages, public-only backlinks, search, per-kind feeds, sitemap and redirects. Custom prebuilt Docker adapters use the same versioned, audited release protocol. See [static renderer protocol](docs/RENDERERS.md). Search lists only `listed: true` pages and defaults to Work and Knowledge. Logs are `noindex` by default. Feed, listing and indexing are independent policies.

## Safety rules

- Public metadata is reconstructed from an allowlist, including nested objects.
- Private, unresolved, ambiguous and unapproved internal links block approval.
- Raw HTML in Markdown, note transclusion, remote images and SVG are rejected; HTML comments are removed.
- MDX is disabled by default. Opted-in `.mdx` runs only in the pinned offline compiler image with
  dependencies copied from configured `public-components` and `public-data` roots. Its approved
  client module is trusted browser code, not sanitized prose.
- Raster images are re-encoded without metadata; only referenced attachments are copied.
- Source and attachment symlinks and path traversal are rejected.
- Slugs and aliases are collision-checked and reserved across withdrawals.
- Mutations use explicit hash checks, locks and durable file replacement.
- Source maps, private identifiers, private paths, secret patterns and sentinel markers are checked before release.
- Private-title, email, phone-number and high-entropy heuristics produce configurable warnings;
  per-kind review-age warnings are configurable and have conservative defaults.

No scanner can decide whether ordinary prose or an image is confidential. Human review remains essential. Public content can be copied, and withdrawal cannot guarantee complete recall.

## Development

Install both dependency sets before running the complete test suite. The root suite also
loads site tests, whose TypeScript configuration extends Astro's configuration.
Keep platform-specific optional dependencies enabled for Vitest and Biome.
The inspection tests require Linux `prlimit`. `npm test` caps worker concurrency at four
because several test files launch bounded parser or CLI subprocesses; test timeouts are unchanged.

```bash
npm ci --include=optional
npm --prefix site ci --include=optional
npm run typecheck
npm test
npm run lint
npm --prefix site run check
```

Core modules live under `packages/`. CLI and dashboard share the application service under `packages/service`; the Astro renderer is intentionally independent under `site/`. Tests use temporary isolated vaults, never real private data.

- [Original design requirements and phase roadmap](wikai.md)
- [Implementation contracts](docs/IMPLEMENTATION.md)
- [Security and operations](docs/SECURITY.md)
- [Operations runbook](docs/OPERATIONS.md)
- [Static renderer protocol](docs/RENDERERS.md)
- [MDX and hierarchical tags](docs/MDX-AND-TAGS.md)
- [Dashboard design system](DESIGN.md)
- [Public site design system](site/DESIGN.md)

This is a single-user local publishing system, not a multi-user private wiki server or a cloud synchronization service.

If DIM's original sample process still occupies port 3000, use `WIKAI_PORT=4186 npm start` until the workspace is restarted. Do not expose the private studio through an anonymous development ingress.

# Private wiki selective-publication design

- Baseline: user-supplied design v0.1, dated 2026-09-01.
- Recorded in this repository: 2026-09-22.
- Format: English requirements digest of the original Korean 47-section design, not a verbatim archival copy. Section numbers are retained for traceability; repeated examples and draft type declarations are condensed.
- This document describes the **target**, not a declaration that everything is implemented.
- Current executable API contracts: [implementation contract](docs/IMPLEMENTATION.md).

## 1. Purpose

The primary product is a private personal wiki, not a blog. A publication compiler selects, transforms, validates and explicitly approves content before a separate renderer can consume it.

```text
Private Vault → review/approval → immutable approved snapshots
             → public-only staging → static site → audit → deployment
```

## 2. System components

1. **Private Vault:** ordinary Markdown notes and attachments; private by default; editor-independent.
2. **Publication Compiler:** candidate discovery, materialization, link/asset checks, risk diagnostics, approval snapshots and staging.
3. **Publication Dashboard:** CLI first, then a local web UI using the same application service; compare, approve, update and withdraw.
4. **Public Site:** Work, Knowledge, Log and fixed pages; no access to private sources or state.

## 3. Problems addressed

Avoid duplicate authoring, pressure to make unfinished notes public, mixed personal/professional presentation, accidental metadata/graph/asset leaks, and automatic deployment of unreviewed edits. Whole-note publication and separately authored projections share a private source of truth without sharing the renderer's inputs.

## 4. Core decisions

- The vault is the authoring source of truth. Public Markdown, staging and HTML are disposable generated artifacts; approved snapshots are retained privately for reproducibility.
- Publication is opt-in through `public` metadata, never inferred from paths, tags or link counts.
- The site generator receives site code, approved staging and public configuration only.
- Every publication is an immutable approved snapshot. Source edits require another approval.
- Partial publication copies content into a projection; no live transclusion.
- Public metadata is constructed from an allowlist, including nested objects.

## 5. Goals

Support unrestricted private writing, whole/partial publication, separate public presentation, actual rendered previews, working/approved diffs, link and asset review, explicit approval/withdrawal, historical reproduction, stable URLs/redirects, CLI automation and future editor integrations.

Protect private bodies, titles, paths, IDs, tags and relationships. Copy only reachable assets. Build search, feeds, sitemap and backlinks solely from approved public data. Keep private data out of public Git history, build logs and renderer dependencies.

## 6. Non-goals

No multi-user ACL server, collaborative editor, comments/social features, WYSIWYG, cloud vault synchronization, automatic publication based on AI/redaction, complete recall of Internet copies, executable MDX/JS/HTML, inline private-block stripping, or public-site access to the vault.

## 7. Terms

| Term | Meaning |
| --- | --- |
| Mirror | Whole source-note body used as the working public representation |
| Projection | Separately authored public body based on one or more private notes |
| Candidate | Unapproved publication proposal |
| Approval / approved revision | Explicit review of an immutable public exposure unit |
| Publication state | Private lifecycle, active revision, source mapping and URL reservations |
| Staging / dist | Approved renderer input / final public output |
| Exposure hash | Hash of normalized externally exposed content, metadata, links and assets |
| Source drift | Referenced private source changed since extraction or approval |
| Listed / index / feed | Internal discovery / external indexing / feed inclusion, independently controlled |

## 8. Invariants

1. No `public` metadata means private.
2. `public.status: published` without approval never publishes.
3. Release consumes approved revisions only.
4. Source edits never replace an active revision.
5. Staging is rebuilt in a fresh temporary directory.
6. Staging contains no private source paths.
7. Public HTML/JSON contains no private IDs.
8. The public graph is recalculated from public documents only.
9. Incoming private backlinks are never exposed, even as counts.
10. Private links/transclusion block approval.
11. Only referenced assets are copied.
12. Symlinks cannot escape permitted roots; initially reject all source/asset symlinks.
13. The renderer cannot read or mount the vault.
14. Production output has no source maps or debug manifests.
15. Withdrawal is explicit.
16. Source deletion does not withdraw a publication.
17. Unapproved edits preserve the last approved version.
18. AI warnings never replace human approval.
19. Failed builds/audits never replace deployed output.
20. Private Git history never enters a public repository.

## 9. Storage and repository boundaries

Keep separate private-vault, publisher and public-site repositories where applicable. A shared local workspace is acceptable; shared private/public Git history is not.

Vault folders may include inbox, journal, topics, projects, research, decisions, sources, public-views, assets, public-assets and archive. Private `.publisher/` stores `state.json`, `approved/`, cache, deployment records and a lock.

Staging contains only `content/{work,knowledge,log,pages}`, `assets`, redirects, content index and public publication manifest. The public manifest is not private state.

## 10. Public information architecture

Kinds: `work | knowledge | log | page`. Routes include `/work`, `/knowledge`, `/log`, `/about`, `/now`, `/contact`, `/search` and `/feeds`.

Home is a professional landing page with positioning, current focus, featured projects, knowledge areas, important updates, contact and selected recent logs. Search defaults to Work + Knowledge, with opt-in Log, and excludes `listed: false`.

## 11. Metadata model

Private notes need no frontmatter. Allocate stable private IDs only for candidates or source references. Public configuration lives under `public`.

- Private ID: `prv_…`; public ID: `pub_…`; use UUIDv7 or equivalent collision-resistant IDs. Moves/title changes do not change IDs. Never reuse retired public IDs for another document.
- Workflow: `candidate | review | published | withdrawn`.
- Source mode: `mirror | projection`; snapshots are approval storage, not a third source mode.
- Public fields: ID, workflow, mode, kind, slug, title, summary, tags, aliases, visibility flags, featured, content state, canonical, private source references and kind-specific metadata.
- Source reference: private ID, optional anchor, captured hash and private review note. Never publish it.
- Content states: draft, active, stable, needs-review, deprecated, archived.
- Work: role, project status, dates and labeled repository/demo/documentation/article/other links.
- Knowledge: topic/guide/design/research/decision/reference type and last verified date.
- Log: occurred-at timestamp.
- Page: home/about/now/contact/generic layout and optional order.

Approval requires an explicit slug. Temporary path-derived suggestions are preview-only. Normalize Unicode to NFC; reject traversal, empty segments, controls, query and fragment. Detect case-insensitive and Unicode collisions; enforce one trailing-slash policy. Reserve moved/withdrawn slugs; reuse needs an explicit administrative operation.

| Kind | listed | index | feed |
| --- | --- | --- | --- |
| work | true | true | true |
| knowledge | true | true | true |
| log | true | false | true |
| page | false | true | false |

Mirror body and title fallback (public title → private title → first H1) may be inherited. Private IDs, paths, tags, aliases, relations, authors, timestamps, references and backlinks must not be inherited. Public tags, aliases and summary must be explicit.

## 12. Authoring examples

A note without `public` remains private. A mirror candidate can use:

```yaml
id: prv_example
title: Private authoring title
public:
  id: pub_example
  status: candidate
  mode: mirror
  kind: knowledge
  slug: /knowledge/example
  title: Public title
  summary: Reviewed explanation for external readers.
  contentState: stable
  knowledge:
    documentType: guide
```

A projection changes `mode` to `projection`, maintains its own body and optionally records `sources: [{ id: prv_source, anchor: section, capturedHash: 'sha256:…' }]`. A Log adds `log.occurredAt`; a fixed Page adds `page.layout`. These references remain private even when the projection is published.

## 13. Mirror and Projection

Mirror suits independently publishable whole notes. It does not support private sections inside an otherwise public body. Projection suits mixed-sensitive sources, case studies, combined research and excerpts needing new reader context. Projection file location alone grants no publication rights. Both modes are sanitized and saved as immutable snapshots on approval.

## 14. Authoring versus publication lifecycle

```text
private → candidate → review → explicit approve → published snapshot
                                            → edits / update available
                                            → approve new snapshot
                                            → explicit withdraw
```

Frontmatter status is authoring intent, not deployment authority. State and approved revision select release content. Missing sources become orphaned; withdrawn IDs/slugs stay reserved; older approved revisions remain available.

## 15. Partial log publication

Extract a block ID, heading or line range, in that priority order, into a new candidate projection. Copy only the selection, never neighboring text or original frontmatter. Record source ID/anchor and captured content hash, generate public ID/temporary slug and let the user edit the presentation.

Line ranges are extraction-time selections, not live tracking. Source drift never overwrites a projection. Users can keep it, compare, selectively merge, re-extract or discard it.

## 16. Markdown scope

Support CommonMark, GFM tables/task lists, footnotes, fenced code, ordinary links, wikilinks, heading anchors, local image embeds and relative public links, with source positions.

Reject MDX, JSX, executable directives, arbitrary HTML/script/style/iframe/attributes, document transclusion, private embeds and execution-capable diagram plugins. Remove HTML comments instead of forwarding potentially private text. Raw HTML otherwise blocks approval.

## 17. Links and graph

Support `[[Note]]`, path links, `[[Note#Heading]]`, `[[Note|label]]` and Markdown `.md` links. Resolve by explicit ID, exact relative path, vault-relative path, alias, then title. Ambiguity, unresolved targets, private/withdrawn/unapproved targets and missing public headings are blocking errors.

Rewrite approved targets to public slug and public heading anchor. Unlabeled links use the approved public title, never a private override. Do not silently remove a private link or turn it into text. Ignore link syntax in code blocks. Recompute backlinks only from approved outgoing links.

## 18. Attachments

Collect reachable assets only; validate normalized and real paths under permitted roots; reject symlinks and traversal. Public filenames must not expose private filenames/paths.

- PNG/JPEG/WebP: verify actual type, decode, remove metadata, re-encode, hash sanitized bytes, assign content-addressed public path and rewrite references.
- PDF/ZIP/TAR/GZ/MP3/WAV/MP4/WebM/GIF/JSON/CSV/TXT: require `public-assets/` placement and explicit exact-byte review. Show size, MIME, SHA-256, original/public names, referring pages and available embedded metadata, including PDF information and archive entry names.
- Initially forbid SVG, HTML, JS and executables/installers. Reject remote images; download and review locally instead.
- Include asset hash and public MIME in the exposure hash. Asset changes require renewed approval.

## 19. Compiler and release pipeline

Read config → discover vault → parse YAML/Markdown AST → index private documents → discover candidates → materialize → allowlist metadata → sanitize → resolve/validate links → collect/sanitize assets → canonical exposure hash → diff → approve or preview → approved-only staging → public graph/search → isolated render → dist audit → atomic deployment.

Exclude `.git`, all publication internals, caches, generated/build/dist, node_modules, hidden temporary and editor swap files from ordinary discovery. Preserve positions and heading/asset/link indexes.

Public metadata includes only public presentation fields and public approval/review timestamps. Never output source IDs/paths/references, captured hashes, private aliases/tags/backlinks, approval actor, private Git commit or local machine path.

Hash canonical public metadata, normalized public AST, resolved outgoing public links and asset hashes. Exclude build timestamps, derived backlinks/search placement, theme and private mappings/positions.

Approval: re-materialize, validate, preview, hash, save immutable document/metadata/assets, atomically update active state, preserve history and mark authoring status published. Reuse equivalent exposure content instead of duplicating it. Use state references, not a symlink named `current`.

Release staging is assembled from approved revisions, not working bodies. Generate in a fresh directory, validate and atomically promote; never incrementally copy into an old staging tree.

## 20. Private state

Store schema version, public ID, source mapping/mode, lifecycle, active revision, first/last approval times, approved slug, aliases, reserved URLs, drift hashes and last deployed revision. Back up with the private vault.

Lock writes, fsync temporary files and atomic-rename. Provide explicit schema migration and partial recovery from approved revision storage after state damage. Retain all revisions until explicit GC. Content-addressed asset deduplication is optional.

## 21. Manifests

Private reports may contain source IDs/paths, working/approved hashes, drift, links, assets and diagnostics. Never copy those reports to staging or public CI.

Public manifest includes schema version and approved page ID, kind, slug, title, summary, tags, listed/index/feed flags and public publication/update timestamps only. Derived manifests must remain public-safe.

## 22. Astro renderer

Astro is the reference renderer, not a compiler dependency. It reads public staging and site code only. Render in a prebuilt sandbox with network disabled, site/staging read-only and output writable. No vault, home, SSH, Git credentials, private state or unapproved input.

Work presents role, period, status, problem, constraints, decisions, results and links. Knowledge presents summary, state, verification date, TOC, related public pages and backlinks. Log presents occurred-at, related pages, default noindex and optional promotion canonical. Page supports Home/About/Now/Contact.

Search uses listed pages; sitemap uses indexable pages; feeds use feed-enabled pages. Provide all/work/knowledge/log feeds. Derived backlinks do not require reapproval. Reject production maps, debug routes/manifests and local input paths.

## 23. Configuration target

YAML configuration has versioned vault paths/include/exclude, state/preview/release locations, public-view roots, asset roots/limits/type policy, Markdown restrictions, link error policy, per-kind visibility defaults, review ages, security scans/deny patterns and isolated site settings.

Secure defaults: clean builds; symlinks, remote images, raw HTML, MDX and transclusion rejected; private/unresolved/ambiguous links and missing headings are errors; raster metadata stripped; 50 MiB asset limit; required release approval; private ID/path/sentinel/definite-secret errors; private title and uncertain-secret warnings. Review-age defaults: Work/Knowledge 180 days, Page 365, Log disabled.

Never embed machine-specific credentials in checked-in config. The target example is not a claim that every proposed key is implemented; consult `packages/model/config.ts` and `publisher.config.example.yaml` for supported keys.

## 24. CLI target

`wiki-pub` provides:

- `status`, `validate [--strict]`, `plan`: categorized status, diagnostics and publication/URL/asset/redirect plans.
- `candidate <path> --kind … --mode …`: allocate missing IDs, defaults and candidate metadata.
- `project <path> --kind … --to …`: separate projection template and private reference.
- `extract <path> --heading … | --block … | --lines start:end --kind … --to …`.
- `preview [--working | --approved] [--public-id …]`.
- `diff <publicId> [--format markdown | json]`: content, metadata, links, assets and source drift.
- `approve <publicId> [--expected-hash …]`: explicit current exposure approval; reject stale hashes and blocking diagnostics.
- `withdraw <publicId> [--redirect …]`: preserve history, reserve slug, remove from subsequent release.
- `build --release`: approved-only staging, isolated build and privacy audit; deployment is separate.
- `audit <dist>`.
- `deploy <environment>` only with a configured adapter; update deployed state only after successful deployment.
- `gc --dry-run | --keep-revisions N`: optional after the initial version.

All principal reads support JSON. Mutations support explicit confirmation/`--yes` and expected-hash checks for automation. Never silently approve a stale preview.

## 25. Machine-readable diagnostics

Diagnostics contain code, info/warning/error severity, safe message, optional source path/public ID/range, related IDs and hint. Default logs omit private body excerpts. Explicit local interactive review may reveal excerpts. Diagnostic JSON is a private artifact, not public site input.

## 26. Diagnostic categories

- Schema/identity: invalid frontmatter/public schema/date/kind, missing IDs/slug, duplicate IDs/slug, reserved slug.
- Links: unresolved, ambiguous, private, withdrawn, missing heading, transclusion, URL scheme.
- Assets: missing/outside root/symlink/traversal/type mismatch/denied extension/review required/too large/remote image.
- Security: raw HTML/MDX, private ID/path, forbidden pattern, map/absolute path, unapproved revision, exposure mismatch.
- State: orphaned publication, missing/corrupted revision, schema mismatch, locked state, concurrent source change.

The original names are a target vocabulary. Track compatibility explicitly when implementation codes differ; do not claim draft names are current API output.

## 27. Local dashboard

Bind to `127.0.0.1` by default. Protect mutation APIs with CSRF and expected hashes. Remote use requires explicit authenticated tunneling/configuration; never host it as the public site.

Queue groups: candidate, review, published, updates, drift, blocking errors, withdrawn and orphaned. Review includes private location, public ID/slug, statuses, approved/working hashes, rendered preview, four-part diff, external/public/private links, assets, warnings and history.

Actions: candidate/project/extract, metadata and workflow edits, approval, withdrawal/redirect and revision restoration. Show exposure counts (pages/assets/external/internal/private links/warnings) plus hash beside approval.

API target: publication list/detail/diff/preview; candidate/projection/extract creation; approve/withdraw; build and diagnostics. All mutation requests carry the relevant file/exposure hash and reuse core services.

## 28. Modules

Separate model, Markdown, vault/index/resolution, assets, policy, compiler, state, audit and filesystem concerns. Model has no filesystem access; Markdown syntax does not own publication policy; adapters do not duplicate application logic. CLI and dashboard share a service. Fixture categories: valid, private-link, asset and adversarial vaults plus expected outputs.

## 29. Core API responsibilities

- Load/index a vault with source positions, document identity/title/path lookup and asset references.
- Materialize a working publication with safe metadata/AST, public links, diagnostics, assets, exposure hash and private dependency tracking.
- Build a publication plan from working sources and approved state.
- Approve a working publication against an expected exposure hash and revision store.
- Build staging from approved revisions/state, not working content.
- Audit dist against trusted public policy and a private leak index.

These are conceptual contracts. Current names/shapes are recorded separately in `docs/IMPLEMENTATION.md`; adapters must not depend on obsolete draft signatures.

## 30. Filesystem safety

Parse/normalize separators and Unicode, remove `.`, reject traversal, resolve real paths, enforce allowed roots and reject symlinks. A normalized string alone is not a filesystem sandbox.

Source writes read/check hash, write/fsync a temporary file, recheck expected content and atomic-rename; observed concurrent modification fails without retry. State mutations, migration, GC and deployment updates use the private publication lock. Read-only preview/validation need not lock.

## 31. Frontmatter editing

Use YAML CST-preserving edits where possible: retain ordering, comments, quoting, body, line endings and final newline. Generated publication fields are IDs, workflow, mode, kind, slug and private source references. Avoid wholesale YAML reserialization or unrelated edits.

## 32. Approval UX

The approval unit includes body, metadata, outgoing links and labels/titles, images/alt text, attachment bytes, external URLs and canonical URL. Separate content/metadata/link/asset diff sections. Provide compiler-safe data preview and actual renderer preview with final route, robots, canonical and feed policy.

Warn that deployed content can be copied by others and cannot be completely recalled.

## 33. Threat model

Protect against accidental whole-note publication, unreviewed Mirror edits, private target titles/backlinks/counts, bulk asset copying, EXIF/document metadata, public Git history, malicious renderer or publisher dependencies, body-bearing logs, private search/feed data, hidden HTML/comments/maps and external AI disclosure.

Use default-private, explicit snapshot approval, allowlists, graph rebuilding, reachable sanitized assets, separate repositories, sandboxed offline rendering, pinned reviewed dependencies and safe diagnostics. Publisher dependencies remain trusted with vault access; renderer dependencies must not receive it. AI sees only explicitly selected inputs and cannot approve.

## 34. Privacy audit

Staging checks private IDs/paths, forbidden metadata/references, unsafe links/assets/HTML, local absolute paths, candidates and unapproved revisions.

Dist checks HTML/CSS/JS/JSON/XML/TXT, output paths and filenames, private IDs/paths/vault root, deny patterns, secrets, source maps/debug manifests, unapproved public IDs, unexpected routes/assets and robots/sitemap consistency. Filename/chunk-name leaks are in scope even when file contents are harmless.

Private titles can overlap ordinary prose, so default to warnings. Private IDs, paths, definite credentials and sentinel markers block. Fixtures include body/title/tag/asset/comment sentinels; none may survive in final output.

## 35. Secret scanning

Scan prose, code blocks, URLs/query strings, metadata, text attachments, filenames and available PDF metadata. Known credential prefixes/private keys/connections are errors; suspected PII and high entropy are warnings; allow custom patterns. This supplements human review and is not a confidentiality proof.

## 36. Kind requirements

| Kind | Required | Recommended |
| --- | --- | --- |
| Work | title, summary, slug, role/contribution, project status, body | problem, constraints, decisions, results, limitations, repository/demo, Knowledge links |
| Knowledge | title, summary, slug, document type, content state | scope, non-goals, last verification, evidence, related/replacement pages |
| Log | occurred-at, body, slug | optional title/summary; suggest first sentence or date+public ID |
| Page | title, slug, layout | exactly one home layout |

## 37. URL moves and redirects

Add old slugs to public aliases when moving. Produce 301 redirects. Sensitive withdrawals omit redirects; use 410 if hosting supports it, otherwise remove the route. Reserve old slugs against unrelated automatic reuse. Explicit management is required to release a reservation.

## 38. Deployment

Local/private CI: approve → stage → isolated render → audit → upload. Public CI must never check out the private vault and receives only safe staging/dist. Upload to a temporary version, health-check and atomically switch. Keep last-deployed state accurate; do not mark failed deployments successful.

## 39. Test strategy

- Unit: schemas, IDs/slugs, paths, Markdown/wikilinks, resolution, allowlists, exposure hash, migrations, assets, redirects and diagnostics.
- Integration: Mirror/Projection/extract, link blocking/rewrites, asset sanitization, approval, staging, withdrawal, graph/search/feed.
- Golden: deterministic safe staging, excluding build timestamps.
- E2E: fixture vault → candidate → approve → staging → isolated Astro → dist audit.
- Adversarial: comments, code-block links, link titles, alt text, token queries, traversal/symlinks, MIME mismatch, SVG/PDF, duplicate titles/aliases, case/Unicode/encoded-slash collisions, candidate/withdrawn links, maps/private filenames in chunks, stale assets, deleted sources, corrupt state, concurrent saves and stale exposure hashes.
- Isolation: vault/home/credential reads, source writes and outbound network fail inside the renderer.

## 40. MVP acceptance gates

These are target gates, not checked completion boxes:

- Ordinary private Markdown, opt-in candidates, Mirror/Projection, separate IDs and four authoring states.
- Private/unresolved/ambiguous links, duplicate slugs, raw HTML/MDX and private staging data blocked.
- Working materialization, canonical exposure hash, immutable revisions, drift-resistant existing publication and working/approved diff.
- Reachable assets only, traversal/symlink/forbidden-type protection, raster metadata removal and hash changes on asset edits.
- Clean approved-only staging, withdrawal cleanup, public graph/backlinks/search/manifest.
- Work/Knowledge/Log/Page, Home/About/Now/Contact, independent visibility flags, search/feed/redirects.
- Renderer isolation, no maps/sentinels, dist audit and previous-dist preservation on failure.
- CLI status, validate, candidate, project, extract, preview, diff, approve, withdraw, release build and audit, with JSON reads.

## 41. Phase roadmap

| Phase | Work | Exit condition |
| --- | --- | --- |
| 0 Foundation | TypeScript/tooling, config/frontmatter/diagnostics, fixtures/sentinels, sandbox paths, atomic writes/locks | CLI loads config; schema/traversal tests pass |
| 1 Markdown and vault | AST/YAML/wikilinks/headings/assets/positions; ID/title/alias/path indexes | fixture links resolve; code ignored; ambiguity has positions |
| 2 Working compiler | candidates, schema/allowlist, Mirror/Projection, sanitize, links, canonical serialization/hash, working preview | safe working output; private links block; no private metadata |
| 3 Assets | roots, symlinks/MIME, raster re-encoding, metadata removal, hash paths, review policy/manifest | only reachable assets; changed bytes change exposure; unsafe input blocked |
| 4 Approval/state | versioned state/migration, immutable revisions, expected hashes, diff/times, withdrawal/reservations, orphan detection | source changes preserve approved snapshot; new approval and history restoration work |
| 5 Release staging | fresh staging, approved pages, graph/backlinks/tags/search/redirects/feed inputs/manifest, audit/atomic swap | working bodies not released; no stale withdrawn files or private IDs/paths |
| 6 Public site | Astro loader, pages/collections/search/feeds/sitemap/robots/canonical/redirects/backlinks, no maps | staging-only build without vault; routes/feeds validated |
| 7 Isolation/audit | offline read-only sandbox, clean dist, allowlists and private ID/path/map/pattern/route/asset audit | vault/network inaccessible; no sentinel; audit failure blocks replacement |
| 8 Authoring | block/heading/line extraction, templates/references/hashes/drift/re-extraction diff | selection only; drift visible; no automatic overwrite |
| 9 Dashboard | local API/queue, working/approved renderer/diff, approval/withdrawal, drift/diagnostics/exposure summary | browser workflow; stale hash blocked; shared core |

## 42. Initial implementation order

Workspace → config/types → parser/wikilinks → vault index → candidates/allowlist/private-link checks → Mirror/Projection → canonical serialization/exposure → validate/status/preview → fixtures/golden tests → state/revisions → approve/diff → release staging → minimal Astro → audit → extract. Prioritize compiler and privacy fixtures before presentation.

## 43. First implementation unit

The first PR scope was intentionally smaller than MVP: config loading, vault discovery/frontmatter, identity checks, candidate discovery, Mirror materialization, public allowlist, private-link detection, exposure hash, JSON plan and basic fixtures. Excluded assets, approvals, Astro/UI, deployment/search/feed. This is a historical sequencing constraint, not a reason to remove later functionality.

## 44. First public release checklist

- Separate private/public Git histories and back up approved revisions/state.
- Clean staging; renderer has no vault mount or network.
- Sentinel fixtures and private ID/path checks pass.
- HTML/MDX blocked; no bulk asset copies or maps.
- Review public URLs/redirects and Log noindex default.
- Manifest omits private references; working/approved diff is available.
- Exercise withdrawal and failed-release preservation on the actual host.
- Deploy only audited dist, never its private parent or backup directories.

## 45. Later extensions

Review-age warnings and needs-review state; replacement/change history; multilingual projections; revision comparison; Obsidian/VS Code actions; selected-text publication; inline approval diffs; opt-in AI title/summary/PII/draft assistance; Quartz/other renderers/JSON/PDF exports; multi-environment deployment/rollback/cache purge/410. AI stops at candidate/review. GC and adapters can follow MVP.

## 46. Fixed defaults

Markdown+YAML in private filesystem/Git; TypeScript and Node-compatible execution; AST processing; versioned JSON state without a database; Mirror/Projection with immutable approvals; default-private and fail-closed policies; PNG/JPEG/WebP sanitization and explicit other-asset review; Astro Work/Knowledge/Log/Page with default-noindex Log; public-only graph/search/feeds; expected hashes; CLI first, local dashboard later; JSON read interfaces.

## 47. Intended operation

Write privately → mark a whole note as candidate or extract a projection → edit public metadata/body → inspect working rendered preview and links/assets → approve reviewed exposure → isolated release and audit → deploy. Later private edits leave the public snapshot unchanged until another explicit diff review and approval.

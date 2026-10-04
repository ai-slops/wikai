# Implementation status against the original design

Initial assessment: 2026-09-22. Latest follow-up: 2026-10-03. Baseline: [v0.1 requirements digest](../wikai.md), retaining the original 47 section numbers. This is a source-and-test-backed progress report, not a full security certification or a claim that every original acceptance item is complete.

## Summary

The repository is beyond the first-PR/compiler-only scope. It contains the compiler, assets, immutable approval/state lifecycle, release staging, Astro renderer, isolated Docker build, CLI, extraction, manual source-update repair, a local dashboard, private release receipts, local directory deployment/rollback, slug release and revision GC. The principal local publication path works end to end. All ten roadmap phases have implementation, but remote-provider operations and several exhaustive inspection requirements remain absent.

Before this assessment, the repository had a short implementation contract and historical verification notes, but no standalone original-phase roadmap. `wikai.md` now records the target requirements separately from implementation facts. It is an English digest, not the full original Korean text or its complete example/type listings.

## Phase coverage

| Original phase | Current evidence | Assessment / qualification |
| --- | --- | --- |
| 0: Foundation | `packages/model`, `packages/config`, `packages/fs`; schema/filesystem tests | Implemented core, strict TypeScript and fixture-driven tests. Fixtures are largely generated in tests rather than the original proposed fixture directory tree. |
| 1: Markdown/vault | `packages/markdown`, `packages/vault`, compiler edge/security tests | Parsing, discovery, identity and link resolution exist. Not every adversarial syntax case in the design is independently re-certified here. |
| 2: Working compiler | `packages/compiler`, `Publisher.plan`, CLI preview/diff | Mirror/Projection materialization, allowlisting, link policy and exposure hashes implemented. |
| 3: Assets | `packages/assets`, service/CLI/dashboard inspection tests | Reachability, path/type checks, raster sanitization and exact-hash review implemented. PDF Info/custom scalars/catalog XMP text, ZIP/TAR/GZIP inventories, and bounded MP3/WAV/MP4/WebM `ffprobe` metadata are implemented; complex/unsupported metadata and payload contents remain manual. |
| 4: Approval/state | `packages/state`, state recovery/migration and CLI tests | Immutable revisions, lifecycle and reservations implemented. V1-to-v2 migration and explicit inactive reconstruction from verified revisions plus backup/bindings are implemented. Facts absent from all evidence cannot be recovered. |
| 5: Release staging | `packages/release/index.ts`, release/lifecycle tests | Approved-only content, clean staging, public backlinks, search input and redirects implemented. Service-level build still loads the vault for audit markers; this is distinct from the renderer's isolation. |
| 6: Public site | `site/src`, Astro check, actual isolated release | Work/Knowledge/Log/Page, search/feed/sitemap/robots/canonical and redirects exist. About/Now/Contact must have approved page content; they are not automatically generated placeholder routes. |
| 7: Isolation/audit | `packages/release/site-build.ts`, `packages/audit`, real Docker build | Offline renderer and audit-before-promotion implemented. Filename-only leaks were missing and are fixed in this assessment. Other proposed scan/reporting features remain below. |
| 8: Extraction | `packages/markdown/selection.ts`, `packages/service/source-update.ts`, service/CLI tests | AST-aware heading/block extraction, content-based line tracking, pre-approval drift and explicit hash-bound manual projection merge are implemented. Legacy whole-file references remain readable. No automatic overwrite or synthesized three-way merge is attempted. |
| 9: Dashboard | `apps/dashboard`, API/security/preview tests | Queue, preview, metadata edits, approval/withdrawal/history, authoring forms, bounded attachment inspection and blocked/stale source-repair UI exist. Current browser verification is recorded in `VERIFICATION.md`. |

## Current implementation follow-up: operations and policy

The current source adds bounded MP3/WAV/MP4/WebM inspection through `/usr/local/bin/ffprobe`,
generic private-title/email/phone/high-entropy warning policy, per-kind review-age policy, explicit
projection source-update plan/apply, administrative slug release, immutable revision GC, and
configured local directory deploy/rollback. Configuration, public-authoring metadata and public
route policy are strict. Persisted revision date strings remain compatible so existing immutable legacy
evidence can still be read, staged and audited.

Release builds now create a private receipt binding exact revision hashes, redirect/staging policy
and dist bytes. Local deployment and rollback retain matching immutable evidence and re-audit the
generation they promote. GC protects revisions referenced by all current/previous deployment
evidence as well as active and last-deployed revisions.

Verification on 2026-10-03:

- Docker 29.1.3 completed an isolated CLI release containing five approved pages; the resulting
  dist audit returned `[]` and exited 0.
- Two local directory deployments and one rollback succeeded. An unknown environment failed closed.
- Browser checks at 1280 and 390 pixels exercised source merge, stale-plan refusal, blocked repair,
  attachment inspection and inert XMP display with zero console errors.
- The final full suite passed 449 tests across 63 files, including the CLI resolver regression.
  TypeScript passed and Astro checked
  26 files cleanly. Biome exited 0 with four existing CSS warnings and ten informational messages.
- TypeScript LSP is installed, although diagnostics occasionally time out. Compiler and focused
  test commands remain the authoritative verification evidence.

## Work completed in this assessment

### Output filename privacy audit

Original sections 34, 35 and 39 require detecting private filenames in generated chunks and scanning output names for sensitive data. The existing auditor scanned textual file contents but did not scan the output filename itself. A harmless `_assets/prv_secret.js` or sentinel-named PNG could therefore pass.

`packages/audit/index.ts` now applies the existing privacy scanner to **dist-relative file paths before extension filtering**, including image/font names and percent-encoded paths. Existing private-ID/path, deny-pattern, credential and unapproved-public-ID policies are reused. The non-public absolute output parent is deliberately not scanned as a public filename.

`packages/audit/filenames.test.ts` adds eight cases: a safe baseline, six filename-only leak variants, and a safe filename under a private-looking local parent. All six attack cases returned no diagnostics before the fix; they now produce blocking diagnostics. Existing content scanning and release failure handling remain unchanged.

### Reproducible development setup

The initial workspace lacked platform-specific optional binaries for Vitest/Biome and had no `site/node_modules`. Restoring optional root dependencies and installing the separately locked site dependencies allowed the full suite and Astro checks to run. `README.md` now documents both dependency installations. No dependency version or lockfile was changed.

### Follow-up: selection-aware source tracking

The next recommended task is now implemented. New heading/block/line extractions carry a private versioned selector and fragment hash. Heading/block selection is AST-based, rejects duplicate/literal-code matches and supports setext headings and standalone block markers. Line ranges are extraction-time coordinates only; subsequent drift uses unique content-hash matching, so inserting unrelated lines does not break tracking. Leading indentation is preserved; empty/out-of-bounds/ambiguous line selections and empty block IDs fail.

Candidates, including those with blocked previews and valid metadata, now report dependency drift before approval. Unrelated edits outside a new selection do not trigger drift. Old references are not reinterpreted. Approval preserves full-file concurrency checks and records or retains the appropriate fragment baseline; historical selectors survive restoration and never enter public staging. Full behavior, baseline semantics and the unsupported downgrade-write case are documented in [source tracking](SOURCE-TRACKING.md).

Follow-up verification on 2026-09-22:

- **223 tests passed across 29 files**, including 58 new extraction/drift/history/CLI cases.
- TypeScript check passed. Biome exits 0 with the same four existing CSS warnings and eight informational suggestions.
- A read-only Oracle review identified the bare-caret block-selector edge case; it was reproduced with a failing regression and corrected before final validation.
- Actual CLI extraction, status, diff, preview and approval were driven against fresh temporary vaults for heading and line selections. Unrelated edits/movement stayed clean; selected changes showed candidate drift; copied and approved public text stayed unchanged. Resolvable heading approval reset its baseline, while unresolved line drift remained visible. Invalid block selectors exited 1.
- Temporary QA data was removed. Existing private data was not modified. No browser visual pass, Docker release rebuild or hosting deployment was repeated for this follow-up; the renderer is unchanged, and release-staging privacy/history behavior is covered by integration tests. LSP remains unavailable; compiler checks were used instead.

### Follow-up: state recovery and schema migration

Implemented `state migrate` and `state recover` as read-only plan commands with explicit
hash-bound, confirmed apply. Valid v1 reads remain nonmutating; writes use v2 with nullable
lost-capture metadata. Lost state in an initialized store is an error, not a new empty store.
Recovery checks all revision evidence, requires backed-up or explicitly supplied source
ownership, retains known reservations and leaves all reconstructed history inactive.
Missing or conflicting evidence blocks apply; valid and unknown-version state cannot be
overwritten by recovery. Exact corrupt bytes are backed up before replacement.

State writes now compare against their original read baseline. Expected-absence writes use
exclusive hard-link publication, preserving concurrent file creation. Restoring a recovered
revision with unknown source captures reports drift instead of falsely claiming no changes.
The operational contract and partial-recovery limitations are in [state recovery](STATE-RECOVERY.md).

Verification on 2026-09-22:

- **263 tests passed across 34 files**, adding 40 state/filesystem/CLI cases to the prior run.
- TypeScript passed. Biome exits 0 with the same four pre-existing CSS warnings and eight informational suggestions.
- An Oracle review reproduced a malformed `revisions` root causing raw `ENOTDIR`; new regressions now verify a blocking structured report for file/symlink roots and the normal missing-state guard.
- Real CLI use against temporary fixtures verified help, read-only migration planning, activation-preserving v1-to-v2 apply, missing-state rejection, stale-plan refusal, inactive reconstruction, separate explicit restore and unknown-capture drift, exact invalid-UTF-8 backup, and malformed-root reporting.
- Existing vaults, state, `.dim` files and deployments were not modified. Temporary QA data was deleted. Browser and isolated site builds were not repeated for this state/CLI-only change. TypeScript LSP is unavailable, so compiler checks were used instead.

### Follow-up: private attachment review inventory

Implemented `assets inspect <vault-relative-path> --json` and `Publisher.inspectAsset`.
It reports exact input hash/size, original/prospective names, container MIME, hash/location
review requirements, referring candidate documents and PDF Info/ZIP/TAR/GZIP metadata.
The inspector does not require successful publication compilation, execute content, extract
entries to disk, change review state or add report metadata to public artifacts.

Parsing uses a bounded Linux child process with pinned `pdf-lib`, `yauzl` and `tar-stream`.
Shared asset reads now check regular-file size before reading and bound the bytes read.
ZIP inventory never opens payload streams or uses a subtype sniffer that decompresses MIME
entries; GZIP nested payload MIME uses limited signatures. Missing dependencies/platform
support, malformed input, encryption and policy/resource limits fail rather than falling
back to an unrestricted parser. See [the supported coverage and limits](ASSET-REVIEW.md).

Verification on 2026-09-22:

- **300 tests passed across 38 files**, adding 37 PDF/archive/service/CLI cases.
- TypeScript and Biome passed; the four existing CSS warnings and eight informational suggestions remain.
- Oracle findings about incomplete wiki-reference inventories, GZIP payload MIME and misleading publication-blocker naming were reproduced and corrected. A further dependency check found ZIP subtype detection opening compressed MIME entries; regressions now keep both ZIP and nested GZIP/ZIP MIME detection payload-free.
- Full-suite process contention initially exceeded an existing CLI test's five-second limit. Capping Vitest concurrency at four fixed the infrastructure issue without changing assertions, skipping tests or extending timeouts.
- Actual CLI use inspected PDF, ZIP, TAR and TAR.GZ, verified byte/hash/file preservation and continued review blocking, then separately reviewed/approved a synthetic ZIP and generated staging without inspection metadata. Unsafe archive names and vault traversal were rejected.
- Existing `.local` data, `.dim` and deployments were not modified; temporary QA data was removed. Browser visuals and Docker rendering were not rerun for this core/CLI-only change. LSP is unavailable; compiler checks were used instead. Node permissions are not claimed as a hostile-code or network sandbox.

### Follow-up: PDF XMP and additional Info metadata

Extended the existing private inspection report with bounded, inert catalog XMP packet text
and typed additional Info entries. Raw/single-Flate metadata, UTF-8/UTF-16 and indirect metadata
names are supported. Complex or unresolved custom values remain visible with
`additionalInfoComplete: false`. No XML parser, entity resolution, URL fetching, script
execution, redaction, new dependency or approval action was introduced.

Both encoded/decoded XMP are capped at 64 KiB, Info dictionaries at 128 entries, and reference
resolution at eight hops. Malformed stream declarations, external-file metadata, unsupported
filters/predictors and oversized values fail safely. Existing worker/resource and public-output
boundaries are unchanged. Details and remaining coverage are in [attachment review](ASSET-REVIEW.md).

Verification on 2026-10-03:

- **335 tests passed across 40 files**, adding 35 metadata, resource-bound and CLI regression cases.
- TypeScript passed. Biome exits 0 with the same four existing CSS warnings and eight informational suggestions.
- Oracle identified acceptance of missing/null metadata Type/Subtype identifiers. Four failing regressions now prove those streams are rejected; indirect valid identifiers remain supported.
- Actual CLI use read compressed UTF-16BE XMP and Unicode custom Info, preserved entity/script text literally, marked a complex value incomplete, and verified unchanged file bytes, hash, configuration and review status. Missing metadata declarations and oversized inflated XMP exited nonzero without private excerpts.
- Tests cover raw/Flate streams, BOM handling, null and missing metadata, typed scalar fields, cyclic/deep references, unsafe key names as data, unsupported filters, external-stream declarations and size/count limits. XMP intentionally appears only in the private report; it is no longer an omitted metadata class.
- Existing private data and deployments were untouched; temporary QA fixtures were removed. Browser visuals, Docker rendering and deployment were not repeated for this private metadata-only change. LSP remains unavailable; compiler validation was used instead.

## Current limitations

1. **Attachment semantics remain human work.** Automated coverage includes bounded container/header
   metadata, not arbitrary PDF embedded/page metadata, semantic XML/RDF validation, archive
   payloads, media frames/samples/cover art/codec payloads, visual confidentiality or general text
   classification. Inspection never grants approval.
2. **Privacy heuristics are warnings, not decisions.** Private-title, email, phone and high-entropy
   detection is configurable and necessarily incomplete. Human metadata/content review remains
   required.
3. **Deployment is local-directory only.** Remote-provider deployment/upload, cache purge, provider
   health-check switching and 410 responses are not implemented. Rollback retains one previous
   local generation per environment.
4. **Source repair is deliberately manual.** The tool provides a diff, selector repair and
   hash-bound complete-body write; it does not synthesize or auto-accept a merge.

The original draft module layout and API signatures are not identical to this repository. Use `docs/IMPLEMENTATION.md` and the actual exported schemas for integration. Do not infer completion from phase numbers or silently treat ignored draft configuration keys as supported behavior.

## Initial assessment verification on 2026-09-22

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 165 tests passed, 25 files |
| `npm run lint` | Exit 0; no errors, four existing CSS warnings and eight informational suggestions |
| `npm --prefix site run check` | 26 files, zero errors/warnings/hints |
| `docker build -t wikai-site:local site` | Passed using the pinned base image and site lockfile |
| Actual CLI `--help` / invalid command | Success / nonzero exit as expected |
| Temporary-vault plan and explicit hash-bound approval | Passed for one Knowledge and three fixed Pages |
| Change original body after approval, then actual CLI isolated release | Release preserved approved content and excluded unapproved sentinel text |
| Actual CLI audit of generated dist | Empty diagnostics, exit 0 |
| Add harmless JS with private ID in filename, then actual CLI audit | `AUDIT_PRIVATE_ID`, exit 1 |

The temporary QA vault/output were deleted; existing `.local` data and deployment were not modified. No real hosting deployment was attempted. Missing About/Now/Contact in the first minimal QA fixture caused the existing required-route gate to reject the release; adding explicitly approved fixed pages satisfied it without weakening the audit.

TypeScript LSP was unavailable, so compiler and Astro diagnostics were used instead. Markdown has no configured LSP. Browser visuals and explicit sandbox escape/network probes were not rerun; see the separately dated historical verification record for those earlier checks. Passing tests do not prove confidentiality of arbitrary prose or images.

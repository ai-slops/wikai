# Verification record

For follow-up implementation checks through 3 October 2026, including media inspection, privacy
and review policy, source-update repair, state operations and local deployment/rollback, see
[current status](STATUS.md). The dated records below preserve their original scopes; test counts
are historical snapshots, not a current final total.

## Current operating verification, 3 October 2026

| Check | Observed result |
| --- | --- |
| Docker 29.1.3 isolated CLI release | Passed with five approved pages |
| Final dist privacy audit | `[]`, exit 0 |
| Local directory deployment | Two successive generations applied successfully |
| Local rollback | Previous exact generation and evidence restored successfully |
| Unknown deployment environment | Failed closed as expected |
| Browser at 1280 and 390 pixels | Merge, stale refusal, blocked repair and inspection passed; zero console errors |
| Inert XMP presentation | Displayed as text, not interpreted markup |
| Root TypeScript check | Passed |
| Astro check | 26 files, zero errors, warnings or hints |
| Biome | Exit 0; four existing CSS warnings and ten informational messages |
| Final full Vitest suite | 449 tests passed across 63 files |
| TypeScript LSP | Zero errors in apps and checked package directories |

The final suite includes the configured deployment CLI resolver regression. TypeScript LSP is
installed; earlier intermittent timeouts were followed by successful directory diagnostics.
The lead also repeated attachment inspection and manual source merging in the live browser:
XMP produced no executable nodes, the merged body rendered in the sandboxed preview, approval
remained absent, and the 390-pixel viewport had no horizontal overflow or console warnings.
Temporary fixtures were separate from `.local`; no real external host was deployed.

## Historical baseline, 19 September 2026

Verified in the supplied DIM workspace.

## Automated checks

| Check | Result |
| --- | --- |
| Root TypeScript build/check | Passed |
| Vitest | 153 tests passed across 23 files |
| Biome error gate | Passed, no errors |
| Astro language-aware check | Passed, no errors or warnings |
| Isolated Docker release build | Passed |
| Final dist privacy audit | Empty diagnostic list |

The TypeScript language server was not installed in this environment. TypeScript and Astro checks were used instead; no LSP success is claimed. Non-blocking CSS style suggestions remain for accessibility overrides and selector ordering.

## Actual application use

- CLI help exits successfully without loading a vault; invalid commands fail.
- The real CLI reads JSON plans/status, creates a heading extraction through `--to`, rejects stale approval hashes, and produces a four-part Markdown diff.
- Browser use confirmed that blocked candidates appear in the queue and cannot be approved.
- A generated PNG was sanitized by the compiler and decoded at its expected width inside the sandboxed review iframe.
- The browser completed approval, withdrawal, and activation of an earlier approved Log revision.
- Deferred Working preview responses, including late rejection, cannot replace a selected Approved preview. Unit tests and a browser-intercepted delayed-response scenario cover this boundary.
- The final public build contained six approved demo pages. Unapproved notes and the deliberately blocked example were absent.

## Public site checks

All 11 HTML routes were opened at 375, 768 and 1280 pixels, producing 33 screenshots. No horizontal overflow or browser page errors were observed.

Verified behavior:

- Work and Knowledge appear in default search.
- Searching for the Log title produces zero results before enabling Include Log and one afterward.
- The Log page has `noindex,follow` and is absent from the sitemap.
- `/feeds/all.xml`, `/feeds/work.xml`, `/feeds/knowledge.xml` and `/feeds/log.xml` return XML.
- Article metadata, public backlinks, approved URL paths and Knowledge heading anchors use public data only.

Two independent final visual reviews passed. The functional reviewer initially identified a same-publication preview race; its correction was independently verified before completion.

## Isolation and failure behavior

An actual renderer container was run with network disabled, read-only root, dropped capabilities and no-new-privileges. Access to `/private-vault`, the workspace vault, the agent home, SSH and Git-credential paths failed. Writing to the site source failed. An outbound TCP connection was denied.

The renderer now terminates normally and its exit status is checked. A bounded, read-only helper keeps the output volume mounted during export. Earlier failures exposed an exporter tmpfs-lifetime bug; the corrected full build and audit succeeded. Failure regressions confirm that previous dist remains intact.

## Historical operating limits at that baseline

- Real vaults must remain in a separate private repository. The checked-in demo generator creates only illustrative data under ignored `.local/`.
- At that baseline, PDF/archive/media metadata examination was entirely manual. Current inspection
  extracts bounded PDF/archive and MP3/WAV/MP4/WebM container/header metadata, but not every
  embedded field or payload; exact-hash review remains authoritative.
- The dashboard is local by default. Remote use requires an authenticated proxy/tunnel and the configured bearer token and origin; no public anonymous studio is exposed.
- At that baseline, deployment adapters and revision GC were unavailable. Current local directory
  deploy/rollback and revision GC are explicit plan/apply operations; remote hosting adapters,
  cache purge, 410 responses and collaborative editing remain unavailable.
- File hash checks are not a kernel-level compare-and-swap against unrelated editors. Avoid simultaneous saves during mutation, as detailed in `SECURITY.md`.

## Repository delivery

`.dim` was preserved. Implementation milestones were committed locally. Push attempts failed because the configured Git host `dim-gitea` could not be resolved from the agent container. A reachable origin or restored DIM Git network is required to publish those commits; no remote-delivery success is claimed.

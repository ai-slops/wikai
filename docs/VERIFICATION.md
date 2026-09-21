# Verification record

Verified on 19 September 2026 in the supplied DIM workspace.

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

## Operating limits

- Real vaults must remain in a separate private repository. The checked-in demo generator creates only illustrative data under ignored `.local/`.
- Non-image attachment review is an explicit hash allowlist. PDF/archive/media metadata examination is a manual review responsibility; this version does not automatically extract every format's embedded metadata.
- The dashboard is local by default. Remote use requires an authenticated proxy/tunnel and the configured bearer token and origin; no public anonymous studio is exposed.
- Hosting adapters, automatic deployment, revision garbage collection and collaborative editing are not configured.
- File hash checks are not a kernel-level compare-and-swap against unrelated editors. Avoid simultaneous saves during mutation, as detailed in `SECURITY.md`.

## Repository delivery

`.dim` was preserved. Implementation milestones were committed locally. Push attempts failed because the configured Git host `dim-gitea` could not be resolved from the agent container. A reachable origin or restored DIM Git network is required to publish those commits; no remote-delivery success is claimed.

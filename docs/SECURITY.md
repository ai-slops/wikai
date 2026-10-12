# Security and operations

## Trust model

Wikai is a single-user local publishing tool, not an online private wiki server. The compiler is trusted with the vault; the public renderer is not. Do not install untrusted publisher dependencies or run a private vault in an untrusted workspace. Treat the dashboard as a private administrative interface.

All notes start private. Adding `public.status: published` does not approve or release a note. Only explicit approval activates an immutable revision. Changes to the source and its assets require a new approval. Deleting the source does not withdraw an approved publication.

The system cannot determine whether ordinary prose is confidential. Credential/custom deny-pattern
errors and configurable private-title, email, phone-number and high-entropy warnings are
supplementary checks, not a guarantee. Review text, captions, alt text, URLs, query parameters,
link titles, metadata, and all referenced attachments. Content copied by third parties cannot be
fully recalled after publication.

## Storage and Git

Keep the real vault in a separate private repository. Do not move a private Git history into a public repository or create a public branch from it. Back up the entire vault, including `.publisher`, using encrypted storage. Approval history can contain withdrawn sensitive information and remains private.

The provided `.gitignore` excludes local demo data and build outputs. This is an accident-prevention measure, not an access-control boundary. Inspect staged changes before pushing. Never commit `.env` files, API tokens, credentials, private plans, private state, or build logs containing private diagnostics.

## Dashboard access

The default server listens on loopback. Non-loopback access must be explicit and authenticated. Do not expose the studio as the public site. Use an authenticated tunnel or DIM's controlled development gateway. Preserve CSRF and origin checks; never disable them to make a proxy work. Configure the exact external origin when operating behind a reverse proxy.

The public site's files are produced independently from the dashboard. Public readers never need dashboard access or vault credentials.

## Approval and recovery

Review the current exposure hash and submit that hash with approval. A stale hash is rejected. The hash covers public content, public metadata, resolved links, and sanitized asset hashes. Private-only metadata and source-file moves should not require publication changes.

`components plan` is a narrow convenience for already approved MDX publications whose only
effective change is the snapshotted component/data profile. Its plan hash covers both eligible and
skipped entries. `components approve --expected-hash ... --yes` recomputes the plan under lock and
approves the whole eligible list; skipped publications keep their active revisions. First-time MDX
and any authored content, metadata, tag, link, asset, drift, workflow or diagnostic change require
the normal per-publication review path.

Public hierarchical tags do not inherit private note tags. Tag rename apply is source-hash-bound,
edits current `public.tags` only, and never rewrites approved history. Existing tag strings are not
automatically normalized, reinterpreted or removed during upgrade.

State writes are guarded by an exclusive lock and durable temporary-file replacement. A process crash may leave a lock file. Before removing a stale lock, stop all publisher processes and confirm no operation is active. Back up the state directory first. Never remove an active lock to force simultaneous mutation.

File hash checks detect edits observed before replacement, but ordinary filesystem rename is not a compare-and-swap against an unrelated editor. Avoid saving the same note from another process during an approval. Directory promotion retains a `.previous` sibling for crash recovery; deploy only the exact configured dist directory, never its parent or backup siblings.

Immutable revision integrity is checked on read. Do not hand-edit revision files or state. Preserve corrupt files for investigation and restore the state directory from a known-good backup if necessary. A missing or corrupt state is an error, not permission to publish current source files.

Use the [read-only state recovery report](STATE-RECOVERY.md) before attempting repairs.
Recovery requires a validated backup or explicit reviewed source bindings and leaves all
reconstructed publications inactive. Applying requires a matching plan hash, confirmation
and the publication lock. Exact existing state bytes are backed up before replacement;
missing-state creation cannot overwrite a concurrently created file. Unsupported schema
versions and invalid revision evidence are never bypassed. Private state v1 is readable;
new writes use v2. Back up before upgrading and do not hand-edit the version to downgrade.

## Attachments

Only referenced files are included. Raster images are decoded and re-encoded, removing embedded metadata. This does not remove sensitive visual information, such as screenshots of credentials or personal details.

SVG, HTML, executable code and remote images are rejected. Non-raster files require an explicit content-hash review and must live under `public-assets`. Review PDF metadata, archive entry names, audio/video metadata and text contents independently. A review is specific to the exact file bytes; editing the attachment invalidates it.

`assets inspect` provides [bounded private PDF/archive metadata](ASSET-REVIEW.md), not an
approval or confidentiality certificate. It never adds reviewed hashes, executes attachment
scripts or writes extracted archive entries. Linux resource limits and Node permission
allowlists constrain the parser process, but this is not a malicious-code or network sandbox.
Catalog XMP packets and scalar custom Info values can be displayed as bounded private data.
XML entities and scripts are never interpreted, and the inspector does not redact the PDF.
Complex fields, page-level/embedded metadata, unsupported filters, media frames/samples/cover art,
codec payloads and archive contents still require separate inspection. MP3/WAV/MP4/WebM inspection
reports only bounded common tags and stream headers through a protocol-restricted `ffprobe` child.
Do not publish reports or render XMP as HTML/XML;
their packet text, filenames, authors and comments may be private even when the attachment is
being prepared for publication. Approving the original PDF also approves its unmodified bytes.

## Renderer isolation

Prepare the renderer image before a release. Dependency acquisition needs network access; rendering does not. Release rendering runs in a separate container with network disabled, dropped capabilities, a read-only root filesystem and no private mounts. Never add the vault, home directory, Docker socket, SSH keys, Git credentials or publisher state to that container.

Do not substitute an unsandboxed `astro build` for a release. Failure to prepare or launch the isolated renderer must fail the release rather than weaken isolation. Staging and dist are regenerated in temporary locations and promoted only after validation. A failed build does not replace an existing dist.

## MDX code boundary

MDX is disabled by default. When enabled, its compiler image must be prepared separately. The
compiler resolves that image to an immutable ID before cache lookup, so Docker remains required
even when a matching private artifact cache exists. Only the selected MDX source and snapshots of
the configured public component/data roots enter the compiler container. Symlinks, unsupported
file types, profiles over the configured byte limit, imports outside those roots and bare packages
other than the React runtime set are rejected. Root application dependencies are not implicitly
available to authored MDX.

The compiler container is network-disabled, read-only, capability-free and resource-limited. These
controls constrain compilation; they do not make the resulting client module inert. Approved MDX
artifacts are real React 19 browser code. Their hashes establish the reviewed bytes, not harmless
behavior or complete analysis of generated URLs, DOM changes or navigation.

Dashboard MDX preview runs verified artifacts in an opaque `srcdoc` iframe with only
`allow-scripts`. Its CSP denies connections, forms, frames, workers and objects, while allowing
data-backed scripts/styles and inline style attributes. The sandbox omits same-origin permission,
but this should not be described as a proof that script cannot navigate its own frame. On the
published Astro site, the module runs with the public page's origin; CSP denies `connect-src` and
non-self scripts but permits self-hosted approved modules and inline styles. Review MDX and public
components as trusted browser code. Private component/data source is retained in private revision
evidence and is not copied into web output; only verified compiled artifacts are released.

## Local directory deployment

No deployment happens by default. A local environment must be explicitly configured as
`deployments.<name>.type: directory` with its own root. `deploy directory` and `deploy rollback`
are read-only plans unless `--apply`, the exact reviewed plan hash and confirmation are supplied.
The deploy path rechecks the private build receipt, active revisions, redirect/staging policies,
dist fingerprint and privacy audit. It copies and audits a temporary generation before promotion,
keeps one `.previous` generation, promotes matching private evidence, and records deployed
revisions only after success. Rollback accepts only the retained generation whose destination,
fingerprint and policy evidence match, audits it again, and swaps both generation and evidence.

Private deployment evidence under `publisher.stateDir/deployments` is part of the security record.
Do not edit or selectively delete it. Revision GC reads current and `.previous` evidence for every
configured environment and preserves every referenced revision. See [operations](OPERATIONS.md).

## Before first deployment

- Replace all illustrative demo content and the `example.invalid` site URL.
- Inspect every approved page and its attachment inventory.
- Verify index, listed, feed and canonical policies.
- Confirm the vault and public site have separate Git histories.
- Prepare and inspect the renderer image and dependency lockfile.
- Run a release and audit its final dist.
- Confirm no source maps, private IDs, source paths, sentinel markers or credentials occur.
- Test withdrawal and ensure the hosting provider removes stale routes and assets.
- Configure a dedicated local directory destination, review the deployment plan, and apply its exact hash.

Remote deployment-provider credentials and adapters, cache purge, hosting health checks/atomic
provider switching, and 410 responses are not implemented. The built-in deployment target is a
local directory only. Custom Docker renderers are implemented separately through the versioned
static-renderer protocol and are not deployment-provider adapters.

# Security and operations

## Trust model

Wikai is a single-user local publishing tool, not an online private wiki server. The compiler is trusted with the vault; the public renderer is not. Do not install untrusted publisher dependencies or run a private vault in an untrusted workspace. Treat the dashboard as a private administrative interface.

All notes start private. Adding `public.status: published` does not approve or release a note. Only explicit approval activates an immutable revision. Changes to the source and its assets require a new approval. Deleting the source does not withdraw an approved publication.

The system cannot determine whether ordinary prose is confidential. Pattern scans are supplementary checks, not a guarantee. Review text, captions, alt text, URLs, query parameters, link titles, metadata, and all referenced attachments. Content copied by third parties cannot be fully recalled after publication.

## Storage and Git

Keep the real vault in a separate private repository. Do not move a private Git history into a public repository or create a public branch from it. Back up the entire vault, including `.publisher`, using encrypted storage. Approval history can contain withdrawn sensitive information and remains private.

The provided `.gitignore` excludes local demo data and build outputs. This is an accident-prevention measure, not an access-control boundary. Inspect staged changes before pushing. Never commit `.env` files, API tokens, credentials, private plans, private state, or build logs containing private diagnostics.

## Dashboard access

The default server listens on loopback. Non-loopback access must be explicit and authenticated. Do not expose the studio as the public site. Use an authenticated tunnel or DIM's controlled development gateway. Preserve CSRF and origin checks; never disable them to make a proxy work. Configure the exact external origin when operating behind a reverse proxy.

The public site's files are produced independently from the dashboard. Public readers never need dashboard access or vault credentials.

## Approval and recovery

Review the current exposure hash and submit that hash with approval. A stale hash is rejected. The hash covers public content, public metadata, resolved links, and sanitized asset hashes. Private-only metadata and source-file moves should not require publication changes.

State writes are guarded by an exclusive lock and durable temporary-file replacement. A process crash may leave a lock file. Before removing a stale lock, stop all publisher processes and confirm no operation is active. Back up the state directory first. Never remove an active lock to force simultaneous mutation.

File hash checks detect edits observed before replacement, but ordinary filesystem rename is not a compare-and-swap against an unrelated editor. Avoid saving the same note from another process during an approval. Directory promotion retains a `.previous` sibling for crash recovery; deploy only the exact configured dist directory, never its parent or backup siblings.

Immutable revision integrity is checked on read. Do not hand-edit revision files or state. Preserve corrupt files for investigation and restore the state directory from a known-good backup if necessary. A missing or corrupt state is an error, not permission to publish current source files.

## Attachments

Only referenced files are included. Raster images are decoded and re-encoded, removing embedded metadata. This does not remove sensitive visual information, such as screenshots of credentials or personal details.

SVG, HTML, executable code and remote images are rejected. Non-raster files require an explicit content-hash review and must live under `public-assets`. Review PDF metadata, archive entry names, audio/video metadata and text contents independently. A review is specific to the exact file bytes; editing the attachment invalidates it.

## Renderer isolation

Prepare the renderer image before a release. Dependency acquisition needs network access; rendering does not. Release rendering runs in a separate container with network disabled, dropped capabilities, a read-only root filesystem and no private mounts. Never add the vault, home directory, Docker socket, SSH keys, Git credentials or publisher state to that container.

Do not substitute an unsandboxed `astro build` for a release. Failure to prepare or launch the isolated renderer must fail the release rather than weaken isolation. Staging and dist are regenerated in temporary locations and promoted only after validation. A failed build does not replace an existing dist.

## Before first deployment

- Replace all illustrative demo content and the `example.invalid` site URL.
- Inspect every approved page and its attachment inventory.
- Verify index, listed, feed and canonical policies.
- Confirm the vault and public site have separate Git histories.
- Prepare and inspect the renderer image and dependency lockfile.
- Run a release and audit its final dist.
- Confirm no source maps, private IDs, source paths, sentinel markers or credentials occur.
- Test withdrawal and ensure the hosting provider removes stale routes and assets.
- Upload only the audited dist using a versioned deployment and atomic hosting switch.

Hosting credentials and automatic deployment are intentionally outside the default application. A deployment adapter must never mark a revision deployed before the hosting operation succeeds.

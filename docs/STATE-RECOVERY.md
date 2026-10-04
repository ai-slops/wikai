# State migration and fail-closed recovery

`state migrate` upgrades supported state without changing which revision is active.
`state recover` reconstructs **inactive** history after state loss or corruption.
Neither command builds or deploys the site. Recovery does not remove an already deployed page from its host.

Stop other publisher processes and back up the entire private state directory before maintenance. Keep reports, bindings and backups private: they contain private source identities and paths. Do not delete revisions, edit their contents or remove an active publication lock to bypass a failed check.

## Schema compatibility

The current private state schema is **version 2**. Public staging and public manifest formats are unchanged.

- Valid v1 state is parsed and migrated to v2 in memory without writing anything during reads.
- A subsequent normal state mutation writes v2. To review and back up the format upgrade separately, use the explicit migration command below before other mutations.
- Supported fields, active revisions, source mappings, history, reservations and withdrawal redirects are preserved by migration.
- V2 can represent lost historical source hashes and source-reference arrays as `null`. An empty array means known-empty, not unknown.
- Unsupported schema versions are rejected. Recovery never downgrades a valid newer-version file.
- Older binaries cannot read v2 state. Restore a complete pre-upgrade backup before intentionally rolling back software; do not change the version number by hand.

```bash
npm run wiki-pub -- --config publisher.config.yaml state migrate --json
npm run wiki-pub -- --config publisher.config.yaml state migrate \
  --apply --expected-hash sha256:REPLACE_WITH_REVIEWED_PLAN_HASH --yes
```

Use the actual `planHash` from the first command, not the placeholder. Migration is read-only by default; `--dry-run` is an explicit synonym. V2 state reports `STATE_ALREADY_CURRENT` with `canApply: false`; no upgrade needs applying.

## Distinguishing a new store from state loss

A missing `state.json` is considered a new empty store only when no initialization marker or revision entries remain.

Once a state mutation records `.publisher/initialized`, deleting `state.json` causes `STATE_RECOVERY_REQUIRED`, even if revision files were also removed. Legacy stores without the marker are protected when revision entries remain. A non-directory or symlinked `revisions` root also signals damaged storage rather than a new store.

If every trace of an old store was removed, no local program can distinguish that from a genuinely new directory. Backups remain essential. A marker alone is evidence of loss, not enough information to reconstruct historical IDs or reservations.

Normal CLI and dashboard startup fail closed when state is damaged. Maintenance commands load configuration directly rather than requiring `Publisher.open()` to succeed.

## Inspect recovery evidence

```bash
npm run wiki-pub -- --config publisher.config.yaml state recover --json
```

The report lists intact revision coordinates, public titles/slugs, diagnostics, proposed private state, and a `planHash`. It does not include revision bodies or encoded attachment bytes. The command makes no files or directories. A blocking report still appears on stdout as JSON and exits nonzero; unsafe configured filesystem paths can fail before a report is assembled.

Recovery verifies every discovered canonical `revisions/<publicId>/<revisionHash>.json` file against its coordinates and integrity/content hashes. It rejects unexpected entries, symlinks and corrupt revisions instead of silently skipping them. Invalid revision-root types produce a blocking `STATE_REVISION_ENTRY_INVALID` report.

Revision existence proves available snapshot content, **not** that its activation committed or that it was ever deployed. A failed approval can leave a valid revision file before state is written. Reconstructed history is therefore an operator-adopted inventory of restorable artifacts, sorted by approval timestamp and hash, not a reconstructed activation audit trail.

## Supply private ownership explicitly

Public snapshots do not contain the original private source ID/path/mode. Recovery will not infer ownership from filenames or the current vault. Supply one or both of:

### A known-good private state backup

```bash
npm run wiki-pub -- --config publisher.config.yaml state recover \
  --backup /private/backups/state.json --json
```

The backup must be valid v1/v2 state. Every referenced revision and exposure coordinate must agree with available intact evidence. It supplies source mappings, captured hashes/references and additional retained URL reservations. Backup activation and withdrawal redirects are **not** reactivated by recovery.

### Reviewed source bindings

If no complete state backup remains, prepare a private JSON mapping for every discovered public ID that is not covered by a validated backup:

```json
{
  "pub_example": {
    "sourceId": "prv_original_note",
    "sourcePath": "topics/original-note.md",
    "sourceMode": "mirror"
  }
}
```

```bash
npm run wiki-pub -- --config publisher.config.yaml state recover \
  --bindings /private/reviewed-bindings.json --json
```

Paths are vault-relative, normalized slash-separated paths without traversal. They may identify deleted/orphaned notes; the binding is an operator assertion, not automatic verification against current source contents. Preserve the original stable identity. Do not fabricate private IDs or reassign a public ID to an unrelated document. If you cannot establish ownership, stop and restore a complete private backup instead.

Missing, invalid, conflicting or unused bindings block apply. A binding cannot silently override a different identity in a supplied backup. URLs are reserved from the union of all accepted revision slugs/aliases and backup reservations; normalized cross-publication collisions block recovery.

## Review and apply

Repeat the same input options used for the reviewed plan:

```bash
npm run wiki-pub -- --config publisher.config.yaml state recover \
  --bindings /private/reviewed-bindings.json \
  --apply --expected-hash sha256:REPLACE_WITH_REVIEWED_PLAN_HASH --yes
```

Applying requires both an expected plan hash and confirmation. `--apply` and `--dry-run` are mutually exclusive. `--yes` without `--apply` does not perform a mutation.

Under the publication lock, the operation regenerates the plan. The hash binds the target location, current state bytes/absence, marker, revision inventory, auxiliary input paths and bytes, diagnostics and proposed state. Changed evidence produces `STALE_STATE_PLAN`; inspect a new report rather than retrying the old hash.

Before replacing an existing file, exact original bytes are preserved in `recovery-backups/<SHA-256-hex>.json`, including invalid UTF-8. Existing matching backups are reused; mismatching files are never overwritten. Immutable revisions are not rewritten or deleted.

All restored publication entries have no active revision, active source capture or withdrawal redirect. The existing queue presents retained inactive history as `withdrawn`; this does not assert that a historical withdrawal was recovered.

Recovery refuses to replace currently valid state or unsupported-version state. Use migration for valid v1 state, normal revision restoration for valid state, or the software version appropriate to a newer state format.

## Activate a reviewed revision separately

After recovery, inspect retained history and the desired public content. Then deliberately restore one revision or approve a reviewed working publication:

```bash
npm run wiki-pub -- --config publisher.config.yaml restore pub_example \
  sha256:REPLACE_WITH_CHOSEN_REVISION_HASH \
  --expected-hash sha256:REPLACE_WITH_CURRENT_RESTORE_TOKEN --yes
```

The restore token is that publication's `latestExposureHash` in the applied proposed state. It is an operational concurrency token selected from available evidence, not a recovered statement about which revision was last live. It differs from the maintenance plan hash.

If original capture metadata was lost, explicit restoration retains `null` captures and reports source drift/unknown provenance rather than claiming the source is unchanged. A fresh approval can establish a new baseline. No source text is copied into an existing projection by recovery.

## Safety limits

- Reservations and private captures absent from both revision evidence and backup cannot be reconstructed. Recovery is partial, not a substitute for a full vault/state backup.
- Missing or corrupt revisions block apply. Repair storage from trustworthy backups; do not delete failing evidence merely to make recovery pass.
- Existing-file compare-and-swap uses the exact bytes observed when the mutation was computed, checked again before rename. It is not a kernel-level compare-and-swap against hostile external writers.
- Expected-absence creation publishes a synced temporary file through an exclusive hard link, so a concurrently created destination is never overwritten. The filesystem must support hard links.
- The lock coordinates publisher processes, not unrelated editors or filesystem tools. Stop those writers during maintenance. Crashes may leave a lock; follow the stale-lock procedure in [security operations](SECURITY.md).
- Recovery only changes private state. It does not deploy, erase hosted content, or modify the current public dist.

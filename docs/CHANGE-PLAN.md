# Publication change plan

`Publisher.plan()` and `wiki-pub plan --json` are read-only review surfaces. They retain the
existing top-level keys `publications`, `diagnostics`, `approved`, and `redirects`, and add a
top-level `changes` object. Reading a plan does not approve, withdraw, build, deploy, or write
publisher state.

## Baselines

`changes.proposals.baseline` is always `active-approved`. Proposal records compare current
working compiler output with active immutable approved snapshots. They describe what an approval
could change; they are not the next release until approval succeeds.

`changes.release.baseline` is always `last-successful-build`. Release records compare active
approved snapshots, which are the inputs to the next release build, with the exact revision map
and redirect policy in the last successful build receipt. The receipt is accepted only while its
retained release-staging policy still matches. This baseline is a build baseline, not proof that a
particular deployment environment received it.

When trustworthy build evidence is unavailable, `changes.release.available` is `false` and
`reason` is one of:

- `missing-receipt`: no successful-build receipt is present.
- `invalid-receipt`: the receipt cannot be parsed or validated.
- `stale-staging-policy`: retained staging or its redirects no longer match the receipt.
- `missing-revision`: a receipt revision is not available in immutable state history.

An unavailable baseline has no fabricated summary, publication records, or redirect changes.

## JSON contract

`changes.proposals` has these fields:

- `baseline`: `active-approved`.
- `summary`: counts named `added`, `updated`, `unchanged`, `blocked`, and `orphaned`.
- `publications`: records sorted by `publicId`.

Proposal statuses mean:

- `added`: working public output has no active approval.
- `updated`: working `exposureHash` differs from the active approval.
- `unchanged`: working `exposureHash` equals the active approval.
- `blocked`: an error diagnostic applies to the proposal. A blocked compiler result may have no
  working publication, and is never inferred to be removed.
- `orphaned`: an active approval has no working compiler result and no blocking diagnostic. Source
  deletion therefore preserves the approval and appears as orphaned, not withdrawn.

When `changes.release.available` is `true`, it has these fields:

- `baseline`: `last-successful-build`.
- `available`: `true`.
- `summary`: counts named `added`, `updated`, `unchanged`, and `withdrawn`.
- `publications`: records sorted by `publicId`.
- `redirects`: `added`, `removed`, and `updated` redirect records, each sorted by `from`.

Release statuses mean:

- `added`: active approval was not in the last successful build.
- `updated`: active `revisionHash` differs from the built revision.
- `unchanged`: active `revisionHash` equals the built revision.
- `withdrawn`: the built revision is absent from active approvals. Only this explicit built-versus-
  active comparison reports withdrawal.

Every publication record contains `publicId`, `status`, `beforeExposureHash`,
`afterExposureHash`, `differences`, and `diagnostics`. `differences` is `null` only when no working
proposal exists; otherwise it has:

- `metadata.changed` and sorted top-level `metadata.fields`. Approval-managed timestamps
  `publishedAt`, `updatedAt`, `lastReviewedAt`, and `lastVerifiedAt` are excluded.
- `body.changed`, `body.markdownChanged`, `body.htmlChanged`, `body.beforeHash`, and
  `body.afterHash`. Body hashes bind both Markdown and rendered HTML.
- `links.added`, `links.removed`, and `links.updated`. Link identity is `publicId` plus `anchor`;
  changed slug or title values are `updated` under the same identity.
- `assets.added`, `assets.removed`, and `assets.updated`. Asset identity is `publicPath`; a changed
  hash, MIME, or byte count at the same path is `updated`, with `beforeHash` and `afterHash`.
- `urls.canonical.before`, `urls.canonical.after`, and sorted `urls.aliases.added` and
  `urls.aliases.removed`.

Redirect identity is `from`. A changed target or status at the same source is reported in
`redirects.updated` with complete `before` and `after` records.

## CLI rendering

`wiki-pub plan --json` emits the complete contract. `wiki-pub plan` prints proposal and release
baselines, summary counts, sorted publication statuses, changed public facets, blocking diagnostic
codes, and redirect counts. JSON remains the authoritative machine interface.

## Limitations

- The plan does not approve proposals or predict whether a reviewer will approve them.
- The release comparison is not an automatic deployment plan and has no apply operation.
- A successful-build receipt does not identify a hosting environment. Environment-specific
  deployment and rollback evidence remains owned by the deployment commands.
- No append-only build or deployment history is invented. If retained evidence is absent or stale,
  the release comparison is unavailable.
- Link changes describe each publication's outgoing links. Backlinks are derived during release
  staging and are not separate authored changes.
- Asset bytes are not repeated in change records; hashes, MIME types, byte counts, and paths carry
  the comparison.

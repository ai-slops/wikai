# Extraction and source drift

New `extract` operations track the selected fragment, rather than unrelated edits elsewhere in its source note. `project` and existing references without selection metadata retain whole-file tracking. Neither mechanism automatically synchronizes projection text or changes approved output.

## Selecting content

- **Heading:** match a unique root-level Markdown heading by its plain-text label, case-insensitively. ATX, setext and formatted labels are supported. Copy through the next heading of equal or higher level, including subsections. Code-block and raw-HTML lookalikes are not headings. Duplicate labels fail instead of silently choosing the first.
- **Block:** match a unique literal terminal `^block-id` on a top-level Markdown block. A marker in its own paragraph attaches to the preceding non-code/non-HTML block, allowing a list to be selected as a unit. Fenced/inline-code markers and escaped carets are not IDs. `--block id` and `--block ^id` are equivalent; a bare `^` is invalid. The terminal marker is removed from the copied fragment.
- **Lines:** select a 1-based inclusive range in the Markdown **body**, excluding YAML frontmatter. Out-of-bounds, empty and immediately ambiguous snapshots fail. Leading indentation is preserved.

Exactly one selector is required when creating an extraction. An existing projection destination is
never overwritten by `extract`; use the source-update workflow below for an explicit reviewed merge.

```bash
npm run wiki-pub -- extract journal/today.md --heading "Public idea" \
  --kind log --to public-views/log/public-idea.md --yes
npm run wiki-pub -- status --json
npm run wiki-pub -- diff pub_REPLACE_WITH_GENERATED_ID --format json
```

## Private reference format and compatibility

New extractions retain `id`, `anchor` and `capturedHash`, adding a versioned `selection`:

```yaml
public:
  sources:
    - id: prv_source
      anchor: heading:Public idea
      capturedHash: sha256:REPLACE_WITH_GENERATED_64_HEX_DIGEST
      selection:
        version: 1
        kind: heading
        value: Public idea
```

`selection.kind` is `heading`, `block` or `lines`. Heading/block use `value`; lines use a positive `lineCount` for the canonical captured content, excluding trimmed trailing blank lines. Versioned selections require a valid SHA-256 digest. Unknown versions and invalid selector shapes fail schema validation.

The hash canonicalization converts CRLF to LF and trims only the fragment's trailing whitespace. Internal whitespace, leading indentation and Unicode text are not rewritten by hashing.

**No `selection` means the old full-file hash contract, even when an `anchor` is present.** Existing references and schema-v1 state remain readable through in-memory migration; state mutations now persist schema v2. No existing source or revision is rewritten merely by reading it. Compatibility is forward-read, not downgrade-write: older binaries may reject v2 or strip selection metadata from older-shaped state. Back up the complete private state before switching versions. See [state migration and recovery](STATE-RECOVERY.md).

These fields are private bookkeeping. They are omitted from exposure hashes, approved public documents and release staging. They do not grant publication rights to the referenced note.

## Drift behavior

| Situation | Result |
| --- | --- |
| Edit outside a new heading/block selection | No dependency drift |
| Change selected content | Drift |
| Remove or duplicate a heading/block anchor | Drift; never choose an arbitrary match |
| Move unchanged selected line content | No drift if it remains uniquely identifiable |
| Remove/change/duplicate selected line content | Drift |
| Change private metadata or source CRLF/LF representation | No selection drift |
| Change any bytes in a legacy whole-file reference | Whole-file drift as before |
| Delete a referenced source | Drift |

Line tracking never reapplies the original coordinates. It scans windows of the captured canonical line count for the recorded content hash and requires exactly one match. This is content-presence tracking, not positional provenance; identical copies cannot be distinguished, and no live source text is copied into the projection. Prefer stable block IDs for frequently reorganized notes.

Before approval, status/detail/diff compare working references against the current source. This also works for a candidate whose rendered preview is blocked, provided its frontmatter parsed successfully. The queue keeps `candidate`, `review` or `blocked` as the primary status and exposes the independent `sourceDrift` boolean. A legacy candidate with no captured hash has no baseline to compare until approval; a missing source still reports drift.

After approval, comparisons use the privately stored approved references. Changes to the publication's own source file still trigger its existing source-hash check. Existing status priority remains: blocking errors, changed public exposure, then dependency drift. Historical revision restoration restores that revision's selectors and baselines as well as its approved public content.

When recovery cannot reconstruct historical capture metadata, it records `null`, not an
invented empty baseline. Explicitly restoring such a revision reports drift/unknown source
provenance until a fresh reviewed approval establishes a baseline.

## Approval is an explicit baseline decision

`capturedHash` is a **drift baseline**, not proof that the independently edited projection body equals its source fragment.

- Approval of a resolvable heading/block records its current fragment hash, even when the human intentionally keeps older or rewritten projection text.
- Approval of a legacy reference records its current full-file hash.
- Missing/ambiguous heading/block selections and changed/ambiguous line snapshots retain the previous captured hash. Approval does not invent a new location or silently clear unresolved drift. Re-extract to a new projection or explicitly revise the source reference after reviewing it.
- A missing source document still blocks approval.
- The existing full-file disk-versus-vault hash checks remain in force for concurrency detection, including changes outside a selected fragment.

Approving unchanged copied text is not synchronization. Release continues to use immutable approved snapshots, and source drift alone never changes the public website.

## Review and apply a source update

`source-update plan` reads one tracked source reference and the current projection without writing.
If a source ID appears more than once, pass its zero-based `--reference-index`. With no replacement
selector, the stored selector is reused; pass at most one of `--heading`, `--block` or `--lines` to
repair or deliberately change it.

```bash
npm run wiki-pub -- --config publisher.config.yaml source-update plan pub_example \
  --source-id prv_source --reference-index 0 --json
```

Review `projectionBody`, `sourceBody`, `changes`, diagnostics, source/projection hashes and
`canApply`. Prepare a private UTF-8 file containing the **entire desired projection body**, including
any deliberate manual edits. The command does not synthesize a three-way merge.

```bash
npm run wiki-pub -- --config publisher.config.yaml source-update apply pub_example \
  --source-id prv_source --reference-index 0 \
  --body-file /private/reviewed-merge.md \
  --expected-hash sha256:REPLACE_WITH_REVIEWED_PLAN_HASH --yes --json
```

Apply normalizes line endings to the projection's existing style, updates the selected reference
baseline/selector and atomically replaces the private projection. It rejects an unresolved/blocked
selection, changed source, changed projection or stale plan. The dashboard offers the same flow
with an editable body; blocked comparisons remain non-applicable, and stale apply leaves the merge
for a new comparison. Applying a source update does not approve or deploy the publication.

# MDX and hierarchical tags

MDX and hierarchical public tags are opt-in authoring features. They do not change the default:
ordinary notes stay private, and editing source never replaces an approved revision.

## Hierarchical public tags

Only `public.tags` participates. Private frontmatter tags are never used as a fallback. A tag is a
case-sensitive NFC path such as `topic/design/systems`; one-segment tags remain valid. Empty, `.`,
`..`, control-character and backslash-separated segments are rejected. Parent paths are inferred
for counts and trees and are not written into source.

```bash
npm run wiki-pub -- tags list --json
npm run wiki-pub -- tags tree --json
npm run wiki-pub -- tags filter topic/design status/stable --json
npm run wiki-pub -- tags filter topic/design --subtree --json
npm run wiki-pub -- tags rename plan topic/design topic/product-design --subtree --json
npm run wiki-pub -- tags rename apply topic/design topic/product-design --subtree --expected-hash sha256:REPLACE_WITH_PLAN_HASH --yes
```

Filtering requires every query to match. Exact mode is the default; `--subtree` also matches
descendants at a segment boundary. Rename planning is read-only. Apply regenerates the plan under
the publication lock, rejects changed source hashes, and edits only current public tag arrays. It
does not approve content or rewrite immutable revisions. Existing historical tag bytes remain
readable without migration or automatic reinterpretation.

Core treats every first segment as ordinary data. The built-in Astro adapter alone maps the exact
`category` root to nested category routes. For example, `category/programming/typescript` supplies
the ancestors used for `/categories/programming` and `/categories/programming/typescript`.
Custom renderers receive the generic tree and may choose their own presentation.

## Opted-in MDX

The supported keys already appear under `mdx` in `publisher.config.example.yaml`: `enabled`,
`componentRoots`, `dataRoots`, `image`, and `maxProfileBytes`. Before setting `enabled: true`, build
the configured compiler image from the repository root:

```bash
docker build -t wikai-mdx:local -f packages/mdx/image/Dockerfile .
```

Docker remains necessary while compiling MDX because Wikai resolves the configured image to an
immutable image ID before cache lookup. The cache is bound to that ID, the image reference, source
body/path, configured roots and all dependency hashes.

The compiler snapshots every supported file under the configured component and data roots, not
only files reached by imports. Supported extensions are `.css`, `.js`, `.json`, `.jsx`, `.mjs`,
`.ts` and `.tsx`; symlinks and profiles over `maxProfileBytes` fail. Only the selected `.mdx` source
and these snapshots enter the isolated compiler container. Private vault dependencies are not
copied to release staging or the public site; only immutable HTML, JavaScript and CSS artifacts are.

MDX may import React, React DOM, JSX runtimes and relative files that resolve inside a configured
public root. It cannot import arbitrary root dependencies or files outside those roots. Do not rely
on this import boundary as a browser-code review: MDX and public components produce a real React 19
client module that can hold state, handle events and run browser JavaScript.

The dashboard preview verifies artifact hashes, then runs the module in an opaque `srcdoc` iframe
with `sandbox="allow-scripts"`. Its CSP blocks network connections, forms, frames, workers and
objects while allowing data-backed modules/styles and inline style attributes. The public Astro
page instead loads the approved module from its self-hosted immutable path under a CSP that blocks
`connect-src` but permits self-hosted scripts and inline styles. Neither static compilation nor the
audit promises complete analysis of runtime-generated URLs, DOM changes or navigation behavior.
Treat MDX modules as trusted browser code and review their compiled behavior before approval.

## Shared-component-only approval

After changing a snapshotted component or data file, review the hash-bound batch:

```bash
npm run wiki-pub -- components plan --json
npm run wiki-pub -- components approve --expected-hash sha256:REPLACE_WITH_PLAN_HASH --yes
```

Only already approved, currently published MDX whose authored input and all other public exposure
are unchanged is eligible. The plan skips non-MDX, first-time or newly converted MDX, unchanged
profiles, missing explicit slugs, blocked/orphaned/unpublished publications, source drift, and any
authored MDX, body, metadata, tags, links or asset change. One publication can have multiple skip
reasons. The approved eligible batch and skipped list are both part of the plan hash.

Apply recomputes the plan under lock. A stale plan fails; it is never partially reinterpreted.
Eligible items are approved as one batch, while skipped publications retain their prior active
revision. Review and approve first-time or mixed changes separately through the normal workflow.

For release behavior and custom adapters, read the [static renderer protocol](RENDERERS.md). For
the broader threat model, read [security and operations](SECURITY.md).

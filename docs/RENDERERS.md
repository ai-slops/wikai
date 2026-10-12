# Static renderer protocol

Wikai release staging and static rendering are separate trust boundaries. Core writes approved,
public-only protocol input. A configured prebuilt Docker image turns that input into static files
without network access. Core then validates the output manifest, approved route graph, file hashes,
privacy policy and release identity before replacing the live distribution.

## Profiles

Omitting `renderer` preserves the existing Astro renderer. The equivalent explicit configuration is:

```yaml
renderer:
  profile: astro
  protocolVersion: 1
site:
  sourceDir: ./site
  distDir: ../build/public-dist
  url: https://example.invalid
  isolatedBuild: true
  network: disabled
  image: wikai-site:local
```

The built-in Astro profile supports `html`, `markdown`, `mdx-react-19`, and `sitemap`. It retains
the current fixed pages, category indexes, search, feeds, sitemap, robots, policy files and
`_assets/` compatibility. `site.image` remains its prebuilt image setting.

A custom profile is declarative. It cannot load host code or an in-process plugin:

```yaml
renderer:
  profile: docker
  protocolVersion: 1
  image: example/static-renderer@sha256:REPLACE_WITH_IMAGE_DIGEST
  capabilities: [html, markdown, mdx-react-19]
  reservedRoutes: [/browse]
  requiredRoutes: [/browse]
  assetPrefixes: [assets/]
```

There is no renderer CLI code-loading flag. Select the profile only in the private publisher
configuration, then use the existing `wiki-pub build --release --yes` command.

`image` is executed as configured. `reservedRoutes` cannot be used by publications or redirects.
`requiredRoutes` must be announced by the renderer. `assetPrefixes` constrain adapter-owned asset
names; they do not authorize unannounced files for custom profiles. Content kinds remain approved
metadata, but custom routes need only be canonical and collision-free. They are not required to use
`/work`, `/knowledge`, `/log`, or any other category prefix.

Build the selected image before release. For the built-in profile, run
`docker build -t wikai-site:local site`. Prepare or pull a custom profile's `image` separately
before release. The container's `--network=none` constrains renderer execution; it is not a control
over Docker daemon image acquisition. Then run `npm run wiki-pub -- build --release --yes`.

## Container contract

Every release container is read-only, has no network, drops all Linux capabilities, enables
`no-new-privileges`, and receives no vault, publisher state, home directory, SSH key or Git
credential. These environment variables are stable for protocol version 1:

| Variable | Value |
| --- | --- |
| `WIKAI_STAGING_DIR` | `/staging` |
| `WIKAI_RENDERER_INPUT` | `/staging/renderer-input.json` |
| `WIKAI_OUT_DIR` | `/dist` |
| `WIKAI_RENDERER_OUTPUT` | `/dist/renderer-output.json` |
| `WIKAI_SITE_URL` | Configured public site URL |

The renderer image entrypoint must finish and exit zero. `/dist` is the only writable persistent
mount. Core preserves the previous distribution on renderer or audit failure.

A custom renderer image is trusted publishing code and must be reviewed and pinned like any other
release dependency. Container isolation limits what the renderer can read and do while building: it
withholds private inputs and blocks build-time networking. It does not prove that generated browser
code is safe. A renderer can emit scripts that execute with the published site's browser origin,
make browser-time requests, navigate dynamically, or alter rendered content after the static audit.
Operators must review those behaviors and the renderer image independently.

## Input version 1

`renderer-input.json` has `protocol: "wikai-static-renderer"` and `version: 1`. It contains:

- approved page metadata, canonical slugs, Markdown, sanitized HTML, links and backlinks;
- approved public attachment descriptors and hashes;
- redirects and the public hierarchical tag tree;
- for MDX, the `react-19` runtime contract plus immutable HTML, script and style descriptors.

MDX dependency snapshots, package source, compiler image identity, private source IDs and private
paths are not exposed. Artifact bytes are staged under `renderer-artifacts/mdx/`. Executable public
paths use `/_assets/mdx/<sha256>.<ext>`. Core verifies approved base64 bytes before staging and
verifies the same hashes in final output. `.map` files and `sourceMappingURL` directives are
rejected. A renderer without `mdx-react-19` fails before execution when an approved release has MDX.
Approved MDX client modules are likewise trusted browser code. Their immutable hashes prove which
reviewed bytes were published, not that their runtime behavior is harmless. Static compilation and
the output audit do not completely analyze runtime-generated URLs, DOM changes or navigation.

The Zod schemas and inferred TypeScript contracts are exported from
`packages/renderer/index.ts`. `packages/renderer/example/` is a minimal non-Astro implementation.

## Output version 1

The renderer must write `renderer-output.json`:

```json
{
  "protocol": "wikai-static-renderer",
  "version": 1,
  "files": [
    {
      "path": "notes/hello/index.html",
      "hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "type": "route",
      "route": "/notes/hello"
    },
    {
      "path": "assets/app.css",
      "hash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "type": "asset"
    },
    {
      "path": "publication-manifest.json",
      "hash": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      "type": "policy"
    }
  ]
}
```

Every output file except `renderer-output.json` must be announced exactly once. Paths are safe,
relative and case-insensitively unique. Routes are canonical and unique. Content routes must use
their directory output path, such as `/notes/hello` to `notes/hello/index.html`; extension routes
such as `/feed.xml` map directly to `feed.xml`. Renderers may emit only approved content routes,
approved redirects and profile-declared routes. `publication-manifest.json` and `redirects.json`
must be copied byte-for-byte from staging and announced as policy files.

Core recomputes every announced hash, rejects missing and extra files, rejects source maps, checks
approved attachment and MDX hashes independently, scans names and textual bytes for private data,
and applies sitemap/noindex checks only when the selected profile declares `sitemap`.

Protocol v1 uses strict current schemas: unknown input/output fields are rejected. Page metadata
uses `PersistedMetadataSchema`, so legacy kind-specific metadata fields remain readable for
immutable approved revisions. This compatibility does not force custom renderer routes into
Astro's kind prefixes: custom content routes need only be canonical, collision-free, approved and
outside declared reserved routes. New authoring still uses the stricter current metadata schema.

## Astro integration contract

The Astro image implements protocol version 1 directly. It strictly parses `WIKAI_RENDERER_INPUT`,
generates approved page and redirect routes, and retains its profile-owned fixed routes, feeds,
sitemap and robots endpoint. Markdown continues to render from sanitized HTML. MDX renders its
`fallbackHtml` including the compiler-provided `#wikai-mdx-root`, then loads every approved script
as a self-hosted module and every approved stylesheet from its immutable public path. The page CSP
permits self-hosted scripts and styles, permits inline styles including style attributes, denies
connections and does not permit `unsafe-eval` or inline scripts. It constrains resource loading but is not a proof
against script-driven same-page navigation or all dynamic browser behavior.

The Astro profile alone interprets tags whose first segment is exactly `category`. A tag such as
`category/programming/typescript` derives `/categories`, `/categories/programming`, and
`/categories/programming/typescript`. Ancestor counts are unique listed-page counts; multiple
category tags on one page do not duplicate that page. The adapter hides the internal `category`
root in labels, preserves ordinary tags, and ignores similar roots such as `categoryx`. Core's
generic tag tree and custom Docker profiles attach no category meaning. The audit accepts only
these routes when they can be derived from approved renderer-input tags, never arbitrary
renderer-announced host routes.

After Astro completes, its output step copies ordinary assets and MDX scripts/styles from staging
to their public paths byte-for-byte. It then overwrites `publication-manifest.json` and
`redirects.json` with their original staged bytes, inventories every final file, hashes each byte
sequence, and writes `WIKAI_RENDERER_OUTPUT`. The output manifest excludes itself. Astro, Vite and
MDX source maps remain disabled, and undeclared files fail the normal release audit.

Markdown-only Astro releases that predate the output manifest remain auditable through the legacy
Astro inventory fallback. Current Astro builds and every custom Docker profile use
`renderer-output.json`. The fallback cannot flatten or authorize MDX: approved MDX always requires
announced executable artifacts and therefore the strict current output path.

## Verification

Run the protocol and release tests normally. The real alternative-adapter drive is opt-in because
it builds and runs local Docker images:

```bash
npx vitest run packages/renderer/protocol.test.ts packages/release/mdx-artifacts.test.ts
WIKAI_RENDERER_DOCKER_TEST=1 npx vitest run packages/renderer/docker.integration.test.ts
```

The Docker test uses `--network=none`, requires the already built local `wikai-site:local` base,
uses the same `buildReleaseStaging()` and `buildSite()` APIs as production, and requires no external
credentials.

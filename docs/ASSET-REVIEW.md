# Private attachment inspection

`assets inspect` helps a human review a selected attachment **before** its exact hash is approved. It is read-only: it does not edit the attachment, record a reviewed hash, approve a page, create staging, or deploy anything.

```bash
npm run wiki-pub -- --config publisher.config.yaml assets inspect public-assets/report.pdf --json
npm run wiki-pub -- --config publisher.config.yaml assets inspect public-assets/bundle.zip --json
npm run wiki-pub -- --config publisher.config.yaml assets inspect public-assets/bundle.tar.gz --json
npm run wiki-pub -- --config publisher.config.yaml assets inspect public-assets/interview.mp3 --json
npm run wiki-pub -- --config publisher.config.yaml assets inspect public-assets/demo.mp4 --json
```

The path is vault-relative and must be within a configured asset root. Like other ordinary publisher reads, the command requires valid configuration and readable publication state. Use state maintenance separately if the state store needs recovery.

Inspection currently requires **Linux with util-linux `prlimit` at `/usr/bin/prlimit`** and Node.js 24+. MP3/WAV/MP4/WebM additionally require `ffprobe` at `/usr/local/bin/ffprobe`. Missing resource containment/prober or another platform fails closed; there is no unrestricted fallback. Docker is not required for this command.

## What is reported

- `sourcePath`, `originalName`: private original location and filename.
- `sha256`, `bytes`: the exact bytes read, before any transformation.
- `prospectivePublicPath`: the content-addressed path the non-raster materializer would use. It is not an approved route or promise of publication.
- `detectedMime`: the recognized inspected container format. In particular, ZIP remains `application/zip`; EPUB/Office subtypes are deliberately not detected by opening ZIP payload entries.
- `underPublicAssets`, `hashReviewed`: the required location and existing exact-hash allowlist membership, reported independently.
- `reviewBlockers`: missing location/hash-review requirements only. An empty list does **not** mean the full compiler policy passes or the file is safe.
- `inspection`: a typed success result with bounded metadata and coverage notes, or a safe failure code without parser excerpts.
- `referringCandidateDocuments`: current source documents carrying `public` metadata that reference the asset, including documents blocked during compilation.
- `referencesComplete`: false when skipped/invalid documents or malformed reference syntax prevent complete collection.
- `diagnostics`: private inspection errors and reference-inventory warnings.

The reference collector supports ordinary links/images, reference-style links/images, and wiki embeds, while ignoring code blocks, inline code and HTML comments. Notes without `public` metadata are not listed. The inventory describes current authored references, not the historical approved graph or all possible attachments in the vault.

Reports can contain private authors, filenames, comments, source paths and XMP packet text. **Never upload them with the public site or save them into a public repository.** The report object is not part of `MaterializedAsset`, an approved revision, public staging or the release manifest. Raw attachment bytes, base64 payloads and page text are not included; selected metadata text is intentionally included for private review.

## Supported coverage

| Input | Automatically inspected | Still requires manual review |
| --- | --- | --- |
| `.pdf` | Standard Info fields; typed additional scalar Info entries; page count; bounded catalog XMP packet text with encoding/compression details | Complex Info values, unsupported XMP encodings/filters, page-level or embedded-document metadata, attachments, page contents and executable actions. Encrypted PDFs are refused. |
| `.zip` | Central-directory names, declared sizes, comments, timestamps, encryption flags and available Unix mode/type information | Entry contents, CRC validation, actual expanded sizes, opaque extra fields, encrypted payloads, non-Unix link/reparse semantics and application-specific subtypes |
| `.tar` | Standard headers: names, types, sizes, owner/group, mode and time; USTAR/PAX parsing through the library | Payload contents and extended attributes not represented in standard report fields |
| `.gz` | First member's optional original name/comment/time; total expanded bytes; limited payload MIME signatures | Later members' individual headers and non-TAR payload contents |
| `.tar.gz` | Bounded GZIP processing plus the resulting TAR inventory | Same TAR and GZIP limitations |
| `.mp3`, `.wav` | Container, duration/bit rate, common tags, and audio stream codec/profile/rate/channel headers | Samples, attached pictures/cover art, codec payloads, uncommon/private tags and semantic content |
| `.mp4`, `.webm` | Container, duration/bit rate, common tags, and bounded audio/video/subtitle/data/attachment stream headers including dimensions and language/title tags | Frames, samples, attached content, codec payloads, uncommon/private tags and semantic content |

GZIP `payloadMime` recognizes PDF, ZIP and GZIP signatures, or a parsed TAR container; other payloads report `null`. Signature recognition is not payload validation. Nested ZIP payloads are never opened to infer an EPUB/Office type. Nested archives are not recursively enumerated. TAR inside GZIP is the explicitly supported single unwrap for TAR.GZ.

Archive names with absolute paths, traversal, backslashes, colons or control characters are rejected. Duplicate names are compared after normalization, including NFC and case folding. TAR links/devices and identifiable ZIP Unix symlinks/special entries are rejected. This prevents accidental reliance on an unsafe inventory; it is not a promise that an unrelated archive extractor will be safe.

Media probing receives the selected bytes on stdin, permits only the pipe protocol, and restricts
the accepted demuxer for the requested extension. It reports at most 128 streams, rejects malformed
or out-of-policy output, caps probe/output/time/resources, and never opens an external path or URL.
The dashboard displays the same report as inert text/JSON. Semantic XML/RDF validation, media
payload/content analysis, cover-art inspection, and comprehensive attachment secret/PII analysis
remain manual responsibilities. Existing exact-hash publication review is unchanged.

### PDF extended metadata fields

The PDF report retains `info` and `xmpPresent`, adding:

- `xmp`: `null` when catalog metadata is absent; otherwise `{text, bytes, encoding, compression}`. `bytes` is the decoded stream byte count before text decoding. An empty declared packet remains present with `text: ""` and `bytes: 0`.
- `additionalInfo`: an array of `{key, kind, value}` records for strings, PDF names, numbers, booleans and nulls not already exposed by the standard Info getters. This includes custom fields and entries such as `Trapped`. Dictionary keys remain data in an array; they are not assigned as JavaScript object properties.
- `additionalInfoComplete`: false when an additional value is complex or unresolved. Such entries remain visible as `{key, kind: "unsupported", objectType}` rather than being dropped. Arrays, dictionaries and streams are not recursively serialized; missing, cyclic or over-depth indirect references are marked as references.

XMP must be a catalog stream declaring resolved `/Type /Metadata` and `/Subtype /XML`. The reader supports unfiltered bytes or one `FlateDecode`/`Fl` filter, including a singleton filter array. Decode parameters must be absent/null or empty/identity (`Predictor: 1`); chained filters, other predictors and external-stream declarations are rejected. Indirect values are resolved for at most eight hops.

XMP bytes are decoded strictly as UTF-8 or UTF-16LE/BE using BOM/signature detection. Leading BOMs are consumed by the decoder. UTF-32, malformed text, NUL-containing packets, unsupported stream shapes and missing metadata declarations fail rather than producing misleading text. This is **inert packet display, not an XML parser or XML-validity check**. DTDs, entities, URLs, processing instructions and scripts remain literal text and are never resolved, fetched, interpreted or executed. Any consumer displaying the packet must use a plain-text surface, never HTML/XML rendering.

An `ok: true` report can still have `additionalInfoComplete: false`; inspect the unsupported entries and coverage notes. An unreadable/unsupported XMP stream instead returns a failure report, commonly `ASSET_PDF_METADATA_UNSUPPORTED`, without partial packet or Info excerpts.

Inspection does not redact the original PDF. If that PDF is later explicitly approved and published, its original embedded metadata remains in its bytes unless you sanitize it separately and review the new hash.

## Resource controls

Untrusted format parsing runs in a separate child process. The parent passes only the selected file bytes on stdin, not a vault path. Parser stderr is discarded and stdout is bounded, preventing parser exception excerpts from entering normal CLI logs.

| Bound | Value |
| --- | --- |
| Input | Minimum of `assets.maxFileBytes` and 64 MiB; default configuration allows 50 MiB |
| GZIP expanded output | 64 MiB, including concatenated members |
| Archive member count | 1,000 |
| Sum of declared archive sizes | 512 MiB |
| Info keys and ordinary text fields | 4,096 UTF-16 code units each |
| PDF Info dictionary | 128 entries total, including standard entries |
| PDF indirect metadata reference chain | 8 hops |
| Catalog XMP stream | 64 KiB encoded and 64 KiB decoded; packet text is the bounded exception to the ordinary text-field limit |
| Serialized parser result | 1 MiB |
| V8 old-space heap | 128 MiB |
| Linux virtual address space | 2 GiB |
| CPU time / wall time | 5 seconds / 10 seconds |
| Media streams | 128 |
| Media probe allocation/input analysis | 128 MiB maximum allocation; 5,000,000-byte probe and 5,000,000-microsecond analysis windows |

Oversized results fail rather than silently truncating and claiming complete inspection. ZIP payloads are not decompressed. The new XMP bound applies to the catalog metadata stream after `pdf-lib` has loaded the document; native Flate decoding uses an explicit output limit. Neither it nor the GZIP meter is a universal PDF decompression meter: initial parsing and object-stream inflation remain bounded by process resource limits rather than an application-level inflated-byte counter.

The child uses a scrubbed environment, disallows string code generation, and enables Node permissions with read access only to parser code/dependencies/package metadata, without filesystem writes, child processes or native addons. These are defense-in-depth controls for trusted parser dependencies. As [Node's documentation](https://nodejs.org/docs/latest-v24.x/api/permissions.html) explains, its permission model is not a malicious-code sandbox and does not provide OS-level network isolation. No attachment scripts, programs or URLs are executed/opened by the inspector, but do not describe this process as a container-equivalent or network-disabled sandbox.

The shared asset reader checks roots/symlinks, opens a read-only nonblocking handle, verifies a regular file, checks size before reading and bounds reads. It rejects observed changes during reading. It does not eliminate a hostile concurrent directory-swap race; do not allow untrusted processes to rewrite the vault while reviewing or publishing.

## Review and publication remain separate

1. Inspect the selected attachment and read the coverage notes.
2. Review its actual contents and any metadata omitted by automatic inspection with appropriate local tools. Sanitize or replace it if necessary.
3. Inspect again after changes. Add only the reviewed exact `sha256` to the private configuration's `assets.reviewedHashes`; high-risk attachments must live under `public-assets/`.
4. Run `validate`, review the working page and its exposure hash, then approve the page explicitly.
5. Build/audit/deploy through the existing approved-snapshot workflow.

Changing any attachment byte invalidates the previous hash review. A successful inspection never substitutes for page approval or confidentiality review. A reviewed hash can still fail other compiler rules; for example HTML bytes named `.pdf` remain forbidden even if their hash appears in the allowlist.

Successful metadata inspection exits 0 even when hash review is still required. Parser failures and resource-limit failures return a private JSON failure report and exit nonzero. Invalid paths, unsupported extensions or configuration/state errors may fail before a report is available. An incomplete reference inventory is explicitly marked and warned about rather than presented as a complete list.

Pinned parser dependencies are `pdf-lib@1.17.1`, `yauzl@3.4.0` and `tar-stream@3.2.1`; GZIP processing uses Node's built-in zlib. Media inspection uses the installed `/usr/local/bin/ffprobe`. Dependency/tool acquisition is separate from local inspection, which does not make network requests.

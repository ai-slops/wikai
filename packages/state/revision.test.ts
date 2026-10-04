import { expect, it } from "vitest";
import { decodeRevision } from "./revision.ts";

const legacyRevision = `{
  "publicId": "pub_legacy",
  "revisionHash": "sha256:44ed494590ced71210669554666ecd6c9c322482fcb40fbada361fef5b5addad",
  "exposureHash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  "metadata": {
    "id": "pub_legacy",
    "kind": "work",
    "slug": "/work/legacy",
    "title": "Legacy",
    "tags": [],
    "aliases": [],
    "listed": true,
    "index": true,
    "feed": true,
    "featured": false,
    "publishedAt": "first published",
    "updatedAt": "later",
    "lastReviewedAt": "review season",
    "lastVerifiedAt": "verification day",
    "work": {
      "role": "Builder",
      "startedAt": "Spring 2020",
      "endedAt": "ongoing",
      "links": [
        {
          "label": "Archive",
          "url": "https://example.test",
          "legacyPrivate": "strip-link"
        }
      ],
      "legacyPrivate": "strip-work"
    },
    "knowledge": {
      "lastVerifiedAt": "whenever",
      "legacyPrivate": "strip-knowledge"
    },
    "log": {
      "occurredAt": "sometime",
      "legacyPrivate": "strip-log"
    },
    "page": {
      "layout": "generic",
      "legacyPrivate": "strip-page"
    },
    "legacyPrivate": "strip-metadata"
  },
  "markdown": "# Legacy\\n",
  "html": "<h1>Legacy</h1>",
  "outgoingLinks": [],
  "assets": [],
  "approvedAt": "approval day",
  "legacyTop": "strip-top",
  "integrityHash": "sha256:e1db9448354228be16dee8f000459135532ddff5da31e53455f8615eb415e33f"
}`;

it("decodes immutable legacy bytes before applying the persisted wire schema", () => {
  const revision = decodeRevision(
    legacyRevision,
    "pub_legacy",
    "sha256:44ed494590ced71210669554666ecd6c9c322482fcb40fbada361fef5b5addad",
  );

  expect(revision.metadata.work?.startedAt).toBe("Spring 2020");
  expect(revision.metadata.knowledge?.lastVerifiedAt).toBe("whenever");
  expect(revision.metadata.log?.occurredAt).toBe("sometime");
  expect(revision.approvedAt).toBe("approval day");
  expect(revision).not.toHaveProperty("legacyTop");
  expect(revision.metadata).not.toHaveProperty("legacyPrivate");
  expect(revision.metadata.work).not.toHaveProperty("legacyPrivate");
  expect(revision.metadata.work?.links?.[0]).not.toHaveProperty("legacyPrivate");
});

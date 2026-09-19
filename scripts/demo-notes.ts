export const demoNotes = [
  {
    path: "topics/publication-boundary.md",
    frontmatter: {
      id: "prv_demo_boundary",
      title: "Designing a publication boundary",
      kind: "design",
      topics: ["PRIVATE_SENTINEL_TAG_03"],
      public: {
        id: "pub_demo_boundary",
        status: "review",
        mode: "mirror",
        kind: "knowledge",
        slug: "/knowledge/publication-boundary",
        title: "A deliberate boundary",
        summary: "Why a private knowledge base deserves an explicit publishing boundary.",
        tags: ["Architecture", "Privacy"],
        contentState: "stable",
        knowledge: { documentType: "design", lastVerifiedAt: "2026-09-01" },
      },
    },
    body: "# A deliberate boundary\n\nA useful private wiki gives unfinished thinking a place to live. A public site has a different responsibility: it should contain only work that has been deliberately reviewed.\n\n## Separate writing from publishing\n\nAn approval is a snapshot, not a switch. Editing the source after approval must never silently change what readers see.\n\n## Three practical rules\n\n1. Start private.\n2. Review the complete public surface, including links and assets.\n3. Build only from immutable approved revisions.\n\n> Publishing should be intentional, reproducible, and easy to reason about.\n",
  },
  {
    path: "public-views/work/wikai.md",
    frontmatter: {
      id: "prv_demo_work",
      title: "Wikai case study",
      public: {
        id: "pub_demo_work",
        status: "review",
        mode: "projection",
        kind: "work",
        slug: "/work/wikai",
        title: "Wikai",
        summary: "A private-first publishing system for considered public work.",
        tags: ["TypeScript", "Developer tools"],
        featured: true,
        work: { role: "Design and engineering", projectStatus: "active", startedAt: "2026-09-01" },
        sources: [{ id: "prv_demo_journal" }],
      },
    },
    body: "# Wikai\n\n## The problem\n\nGood notes are often too personal, unfinished, or context-dependent to publish as they are. Maintaining a second public knowledge base creates duplicated work.\n\n## The decision\n\nKeep one private source of truth. Publish reviewed projections through a compiler that treats privacy as a hard boundary.\n\n## What it makes possible\n\n- Record freely without writing for an audience.\n- Publish an entire note or a carefully selected passage.\n- Review every externally visible change before release.\n\n## A conscious trade-off\n\nApproval adds a step. That step is the point: it separates a useful private habit from a public commitment.\n",
  },
  {
    path: "public-views/log/small-systems.md",
    frontmatter: {
      id: "prv_demo_log",
      public: {
        id: "pub_demo_log",
        status: "candidate",
        mode: "projection",
        kind: "log",
        slug: "/log/small-systems",
        title: "Small systems, explicit boundaries",
        summary: "A note on making the safe path the easiest path.",
        tags: ["Field notes"],
        log: { occurredAt: "2026-09-01T16:30:00+09:00" },
      },
    },
    body: "# Small systems, explicit boundaries\n\nThe simplest systems are not necessarily those with the fewest steps. They are the ones where each step has one understandable responsibility.\n\nToday I separated source editing from publication approval. The extra boundary makes the whole workflow easier to trust.\n",
  },
  {
    path: "public-views/knowledge/review-checklist.md",
    frontmatter: {
      id: "prv_demo_checklist",
      public: {
        id: "pub_demo_checklist",
        status: "candidate",
        mode: "projection",
        kind: "knowledge",
        slug: "/knowledge/review-checklist",
        title: "Before you publish",
        summary: "A compact checklist for reviewing a public snapshot.",
        tags: ["Workflow"],
        contentState: "draft",
        knowledge: { documentType: "guide" },
      },
    },
    body: "# Before you publish\n\n- [ ] Read the rendered page, not just the Markdown.\n- [ ] Check every outgoing link.\n- [ ] Review image alt text and attachment metadata.\n- [ ] Confirm the URL and search visibility.\n- [ ] Compare against the previous approved revision.\n\nApproved content can be copied by others. Withdrawal cannot guarantee its complete removal from the internet.\n",
  },
  {
    path: "public-views/knowledge/blocked-example.md",
    frontmatter: {
      id: "prv_demo_blocked",
      public: {
        id: "pub_demo_blocked",
        status: "review",
        mode: "projection",
        kind: "knowledge",
        slug: "/knowledge/context",
        title: "A note that needs review",
        summary: "This intentional example demonstrates a blocked private link.",
        contentState: "draft",
        knowledge: { documentType: "reference" },
      },
    },
    body: "# A note that needs review\n\nThis example cannot be approved because it references [[prv_demo_journal]]. Replace that link with a public explanation before approval.\n",
  },
  {
    path: "journal/2026-09-01.md",
    frontmatter: { id: "prv_demo_journal", title: "Private working journal" },
    body: "# Private working journal\n\nPRIVATE_SENTINEL_NOTE_BODY_01\n\n## Publication boundary\n\nA public renderer should never receive a private vault. It should receive only reviewed snapshots.\n\n## Personal\n\nPRIVATE_SENTINEL_PERSONAL_02\n",
  },
  ...["about", "now", "contact"].map((layout) => ({
    path: `public-views/pages/${layout}.md`,
    frontmatter: {
      id: `prv_demo_${layout}`,
      public: {
        id: `pub_demo_${layout}`,
        status: "review",
        mode: "projection",
        kind: "page",
        slug: `/${layout}`,
        title: layout === "about" ? "About" : layout === "now" ? "Now" : "Contact",
        page: { layout },
      },
    },
    body:
      layout === "about"
        ? "# About\n\nThis is an illustrative Wikai publication. Replace it with your own reviewed profile before deploying.\n\nI build tools that make complex workflows easier to understand. This space brings together selected projects, useful knowledge, and occasional field notes.\n"
        : layout === "now"
          ? "# Now\n\nExploring private-first knowledge systems and deliberate publishing workflows.\n\nThis demonstration page is not a real personal status update.\n"
          : "# Contact\n\nAdd your chosen public contact method here and approve the revision before deployment. No personal contact information is included in this demonstration.\n",
  })),
];

# Wikai Public Site Design System

## 0. Research Log

- Embedded refs: shortlisted Notion, Wired, and Claude; picked Minimalist + Notion for warm editorial restraint, serif-led hierarchy, whisper borders, and readable collections.
- Lazyweb: 2 queries, 2 screens viewed (Substack discovery and Intercom long-form) → flat metadata-rich rows for discovery, a narrow uninterrupted article measure for reading, and secondary material deferred below primary content on small screens.
- Imagen drafts: skipped — no image-generation tool is available in this environment; the brief calls for an understated editorial system rather than an image-led reference.
- Coordination: root `DESIGN.md` remains dashboard-owned; this contract is intentionally scoped to `site/` and can later inherit shared identity tokens without coupling public rendering to dashboard code.

## 1. Atmosphere & Identity

Wikai feels like a carefully kept field notebook: warm paper, precise ink, and quiet structural marks. Its signature is the **indexed margin**—small monospace kind and state labels align beside expressive serif titles, making browsing feel archival without making reading feel institutional.

Primary readers are visitors scanning work and knowledge, returning readers following logs, and keyboard or zoom users who need predictable landmarks. The surface prioritizes comprehension over promotion.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--color-paper` | `#f3eee4` | Shared warm page background |
| Raised paper | `--color-sheet` | `#fffcf5` | Shared paper surface |
| Ink | `--color-ink` | `#1d2420` | Shared primary copy |
| Muted ink | `--color-muted` | `#5e6862` | Shared metadata |
| Faint ink | `--color-faint` | `#7c877f` | Hints and counters |
| Rule | `--color-rule` | `#d8d1c3` | Shared dividers and controls |
| Accent | `--color-accent` | `#246454` | Shared forest links and active controls |
| Accent dark | `--color-accent-strong` | `#17483d` | Hover/active |
| Focus | `--color-focus` | `#b75836` | Shared rust keyboard focus |
| Mark | `--color-mark` | `#e3ebdf` | Tags and selected filters |

Colors are semantic tokens only. Accent is never decorative. The light scheme is deliberate and stable; forced-colors remains browser-owned.

## 3. Typography

| Level | Token | Size | Weight / line-height | Usage |
|---|---|---|---|---|
| Display | `--text-display` | `clamp(2.75rem, 8vw, 6.75rem)` | 500 / 0.92 | Home statement |
| H1 | `--text-h1` | `clamp(2.25rem, 5vw, 4.5rem)` | 500 / 1 | Page title |
| H2 | `--text-h2` | `clamp(1.6rem, 3vw, 2.5rem)` | 500 / 1.1 | Section title |
| H3 | `--text-h3` | `1.25rem` | 650 / 1.25 | Entry title |
| Lead | `--text-lead` | `1.25rem` | 400 / 1.55 | Introductory copy |
| Body | `--text-body` | `1rem` | 400 / 1.7 | Reading text |
| Small | `--text-small` | `0.875rem` | 500 / 1.45 | Metadata |
| Label | `--text-label` | `0.75rem` | 650 / 1.3 | Uppercase index labels |

- Display and headings: Iowan Old Style, Palatino Linotype, Georgia, serif.
- Body and interface: Avenir Next, Avenir, Segoe UI, sans-serif.
- Metadata: ui-monospace, SFMono-Regular, Consolas, monospace.
- Body measure is `--measure: 43rem`; no body copy below 14px.

## 4. Spacing & Layout

The base unit is 4px. Tokens: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-6` 24px, `--space-8` 32px, `--space-12` 48px, `--space-16` 64px, `--space-24` 96px.

- `--page-gutter`: `clamp(1rem, 4vw, 3rem)`.
- `--content-max`: 76rem; `--measure`: 43rem.
- Desktop collection rows use an asymmetric metadata/content grid. Below 48rem they become one column with metadata above the title.
- Breakpoints are content-driven at 48rem and 64rem. At 200% zoom, navigation wraps rather than clips.

## 5. Components

### Site shell
- **Structure**: skip link, header with wordmark/nav, main, quiet footer.
- **States**: links have default, hover, active, and focus-visible states.
- **Accessibility**: landmarks, current-page state, 44px minimum touch height on compact screens.
- **Layout**: centered shell; document owns scrolling.

### Entry row
- **Structure**: kind/date margin, linked title, summary, tag cluster.
- **Variants**: standard, featured, empty collection.
- **Spacing**: `--space-4`, `--space-6`, `--space-8`.
- **States**: title underline grows on hover/focus; active uses accent dark.
- **Accessibility**: one descriptive linked title; metadata remains text, not icon-only.
- **Motion**: color and underline opacity only, standard timing.

### Tag / state mark
- **Structure**: short text label.
- **Variants**: tag, content state, kind.
- **States**: static unless rendered as filter; interactive marks use the link state system.
- **Accessibility**: never conveys meaning by color alone.

### Category branch navigation
- **Structure**: an indexed page heading, immediate child-category links, then shared entry rows for all descendants.
- **Variants**: category root and nested category; the internal `category` tag root is never shown as a label.
- **Spacing**: `--space-2`, `--space-4`, `--space-6`, and `--space-12` only.
- **States**: branch and category-tag links use the shared link hover and focus states.
- **Accessibility**: native navigation/list semantics and an explicit subcategory label.

### Search controls and result
- **Structure**: labelled query input, kind checkboxes, result status, entry rows.
- **States**: empty query, no results, results, focus, checked, disabled.
- **Accessibility**: native input/checkbox semantics, live result count, Log excluded by default.
- **Motion**: none; results update immediately and predictably.

### Prose and backlinks
- **Structure**: article header, safe rendered body, related/backlink list.
- **Variants**: work, knowledge, log, page.
- **Accessibility**: heading hierarchy comes from approved HTML; links visibly underlined; code scrolls within its block.
- **Layout**: narrow reading stack; backlinks follow the article.

## 6. Motion & Interaction

- `--motion-fast`: 120ms ease-out for press/focus feedback.
- `--motion-standard`: 220ms ease-in-out for color and underline transitions.
- Only opacity and transform may animate. This content-first site has no entrance or scroll animation.
- `prefers-reduced-motion: reduce` disables transitions. Search never steals focus.

## 7. Depth & Surface

The strategy is **borders-only with tonal shift**: paper/sheet tones create hierarchy, and a one-pixel rule separates repeated rows. There are no shadows, gradients, glass, or floating cards. Corners use `--radius-control: 4px` and `--radius-surface: 8px`.

## 8. Accessibility Constraints & Accepted Debt

- WCAG 2.2 AA target; body contrast at least 4.5:1, large text and controls at least 3:1.
- Full keyboard reachability, visible `:focus-visible`, skip navigation, semantic landmarks, useful labels, reduced-motion support, and no horizontal page scroll at 320 CSS pixels or 200% zoom.
- Search remains functional without a framework runtime; the tiny inline module progressively enhances a complete index.

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| None | — | No accepted accessibility or persona debt | Site owner |

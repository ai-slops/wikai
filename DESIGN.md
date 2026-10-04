# Wikai Design System

## 0. Research Log

- Embedded references: shortlisted WIRED, Notion, and Claude; selected Minimalist UI + WIRED because a publication review tool needs print-like hierarchy, technical metadata, and operational restraint.
- Existing UI: the disposable plain-text server contains no reusable visual patterns or components to preserve.
- Product guidance: the UI/UX database reference supplied accessibility, touch, responsive, and form constraints; its query script was unavailable because Python is not installed.
- Lazyweb and Imagen: skipped because the brief already supplies a concrete cream/ink editorial direction and this environment exposes no image-generation tool.

## 1. Atmosphere & Identity

Wikai feels like an editor's proofing desk: warm paper, decisive ink rules, compact technical annotations, and a muted teal pencil mark showing where action is possible. The signature is the **proof margin**—queue rows and review sections are organized by thin rules and mono labels rather than generic cards. The memorable moment is approval: the selected revision gains a quiet teal edge and its exact exposure hash becomes the focal proof, not celebratory decoration.

Primary personas are an independent publisher reviewing a small private vault and a keyboard-first maintainer resolving diagnostics. Both need trustworthy state, legible diffs, explicit destructive confirmation, and no decorative motion competing with reading.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--color-canvas` | `#f2efe7` | App background, warm paper |
| Paper | `--color-paper` | `#fbfaf6` | Review and form surfaces |
| Paper strong | `--color-paper-strong` | `#ffffff` | Inputs and preview frames |
| Ink | `--color-ink` | `#1d2421` | Headlines, primary text |
| Ink muted | `--color-ink-muted` | `#66706b` | Secondary text |
| Ink faint | `--color-ink-faint` | `#8b938f` | Placeholder, disabled text |
| Rule | `--color-rule` | `#cfd2ca` | Structural hairlines |
| Rule strong | `--color-rule-strong` | `#8d9690` | Active structural borders |
| Teal | `--color-accent` | `#246b63` | Primary actions, active state, focus |
| Teal dark | `--color-accent-strong` | `#174c46` | Action hover and pressed state |
| Teal wash | `--color-accent-wash` | `#dbe8e3` | Selected row and info background |
| Amber | `--color-warning` | `#8a5a16` | Review caution and drift |
| Amber wash | `--color-warning-wash` | `#f3e5c8` | Warning background |
| Red | `--color-danger` | `#9a3c32` | Errors and destructive actions |
| Red wash | `--color-danger-wash` | `#f4dfda` | Error background |
| Green | `--color-success` | `#356548` | Published/success state |
| Green wash | `--color-success-wash` | `#dfeade` | Success background |
| Scrim | `--color-scrim` | `rgba(29, 36, 33, 0.58)` | Dialog separation only |

Rules: accent marks interaction, never decoration. Every status pairs color with text. Raw colors live only in token declarations. The product is light-only for the first release; browser forced-colors remains usable through semantic HTML and borders.

## 3. Typography

| Level | Token | Size / line-height | Weight | Usage |
|---|---|---|---|---|
| Display | `--text-display` | `clamp(2rem, 4vw, 3.5rem) / 1.02` | 500 | Publication title |
| H1 | `--text-h1` | `2rem / 1.1` | 500 | Page title |
| H2 | `--text-h2` | `1.5rem / 1.2` | 600 | Review sections |
| H3 | `--text-h3` | `1.125rem / 1.3` | 650 | Panel titles |
| Body | `--text-body` | `1rem / 1.55` | 400 | Default UI and prose |
| Small | `--text-small` | `0.875rem / 1.45` | 450 | Supporting copy |
| Caption | `--text-caption` | `0.75rem / 1.35` | 600 | Metadata |
| Kicker | `--text-kicker` | `0.6875rem / 1.2` | 700 | Uppercase mono labels |

- Display and editorial headings: `Newsreader, Iowan Old Style, Baskerville, Georgia, serif`.
- UI/body: `Avenir Next, Avenir, Segoe UI, Helvetica Neue, sans-serif`.
- Metadata/code: `SFMono-Regular, Consolas, Liberation Mono, monospace`.
- Only headings use the serif. Hashes use mono with `overflow-wrap: anywhere`. Labels never rely on case alone.

## 4. Spacing & Layout

All authored spacing uses the 4px base: `--space-1: 0.25rem`, `--space-2: 0.5rem`, `--space-3: 0.75rem`, `--space-4: 1rem`, `--space-5: 1.25rem`, `--space-6: 1.5rem`, `--space-8: 2rem`, `--space-10: 2.5rem`, `--space-12: 3rem`, `--space-16: 4rem`.

The desktop shell is a bounded `100dvh` grid with 20rem queue, fluid review, and 18rem context rail. The header is fixed in its grid row; queue, review, and rail independently scroll only when visible together. At 1024px the rail joins the review flow. Below 768px the queue becomes a full-width first view and the selected review replaces it with an explicit Back to queue control. Main prose measure is 72ch; app max inline size is 1600px. Gutters are `--space-4` mobile, `--space-6` tablet, and `--space-8` desktop.

Review-tool measures are `--measure-dialog-wide: 54rem` for complete private reports and `--measure-tool-pane: 24rem` for bounded raw metadata/source panes.

## 5. Components

### Button
- **Structure**: native `button` with optional inline SVG and text.
- **Variants**: ink primary, outline secondary, text quiet, danger.
- **Spacing**: minimum 44px block size; `--space-3` by `--space-4`.
- **States**: hover inverts/strengthens, active translates 1px via transform, focus gets 3px teal outline, disabled uses faint ink, loading keeps width and announces status.
- **Accessibility**: visible label, native disabled semantics, no icon-only critical actions.

### Field
- **Structure**: visible label, input/select/textarea, optional help and error.
- **Variants**: text, search, select, textarea, segmented control.
- **Spacing**: `--space-2` label gap, 44px minimum control, `--space-3` inset.
- **States**: paper-white default, rule-strong hover, teal focus, red error, faint disabled.
- **Accessibility**: programmatic label, described-by help/error, first invalid field receives focus.

### Queue row
- **Structure**: button containing kicker line, title, state marker, kind, diagnostics count.
- **Variants**: default, selected, blocked, drifted.
- **Spacing**: `--space-4` inset and `--space-2` internal stack.
- **States**: selected uses teal wash and a 3px inline-start proof edge; hover changes paper tone; focus is visible.
- **Layout**: queue pane owns vertical scroll; long titles wrap and IDs break safely.

### Status mark
- **Structure**: text plus small geometric marker.
- **Variants**: every service state and diagnostic severity.
- **Accessibility**: color is supplementary; full state name remains visible.

### Review section
- **Structure**: mono kicker, serif or sans heading, ruled content body.
- **Variants**: metadata, preview, diff, diagnostics, assets, history.
- **States**: loading skeleton, empty instruction, error with recovery.
- **Layout**: main review owns scroll; preview iframe has a labeled sandbox boundary.

### Tab strip
- **Structure**: `tablist`, tab buttons, associated panels.
- **Variants**: preview/diff and working/approved.
- **States**: active tab uses ink underline; arrow keys move tabs; focus remains visible.

### Dialog and toast
- **Structure**: native `dialog`, heading, description, action cluster; toast uses polite live region.
- **Variants**: confirmation, form sheet; success/error informational toast.
- **States**: scrim separates modal; Escape cancels; focus returns to trigger.

### Empty/loading/error panel
- **Structure**: kicker, clear sentence, optional recovery action.
- **Variants**: queue empty, no filter results, no approved revision, request error.
- **Accessibility**: loading uses `aria-busy`; errors use `role=status` unless urgent.

### Inspection report
- **Structure**: vault-relative path field, explicit Inspect action, compact review-state summary, reference inventory, and a complete raw metadata `pre`.
- **Variants**: ready, loading, complete, incomplete reference inventory, unsupported or failed inspection.
- **Safety**: report values and XMP/media metadata are inserted as text only. Inspection never marks a hash reviewed and offers no approval action.
- **Layout**: summary uses the intrinsic metadata grid; unbroken hashes and raw metadata wrap without forcing page-level horizontal scroll.

### Source merge workbench
- **Structure**: explicit indexed source-reference selector, optional replacement selector controls, current projection and selected source panes, textual selection-change report, editable merged Markdown, diagnostics, and one Apply merge action.
- **Variants**: idle, loading, resolvable, selector-required, stale, apply-error, applied.
- **Safety**: source content is always shown as text. Loading a review never writes; applying requires the current projection hash and the operator-edited merged body. It never triggers approval.
- **Layout**: comparison panes use an overflow-safe two-column grid and collapse to one column below the existing mobile breakpoint.

## 6. Motion & Interaction

- `--motion-micro: 120ms`, `--motion-standard: 200ms`, easing `cubic-bezier(0.2, 0, 0, 1)`.
- Animate only transform and opacity. Queue/detail changes use a 120ms crossfade; dialogs use 200ms opacity plus 8px translate.
- No ambient or decorative motion. `prefers-reduced-motion: reduce` removes transforms and transitions.
- Keyboard: `/` focuses search, Escape closes dialogs or returns from mobile detail, arrow keys operate tabs. Shortcuts never override typing.

## 7. Depth & Surface

Depth is printerly and mixed only by rule weight and tonal shift: paper over canvas, 1px rule between regions, 2px ink border for important controls, 3px teal proof edge for selection. Radius tokens are `--radius-none: 0`, `--radius-control: 0.25rem`, and `--radius-panel: 0.5rem`; large containers stay square. No box shadows or gradients.

## 8. Accessibility Constraints & Accepted Debt

Target WCAG 2.2 AA: 4.5:1 body contrast, 3:1 large text and component boundaries, 44px targets, complete keyboard reachability, logical headings/landmarks, zoom to 200%, reduced motion, and responsive reflow without primary-content horizontal scrolling. Preview iframes are sandboxed, titled, and never trusted to participate in the parent accessibility tree.

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| Local system font metrics vary | Entire dashboard | No font assets or network dependency are allowed for this local operational tool | Revisit only if self-hosted licensed fonts are added |

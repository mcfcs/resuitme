# Design notes

The interface is a **sheet of stock on a press bed**.

That is not decoration. This tool takes LaTeX in and gives a typeset page back,
so the interface is built from the materials of typesetting: a dark bed, a piece
of warm stock laid on it, ink in four weights, and a single register mark. Content
sits _on_ the sheet the way a proof sits on a light table.

## Why the previous design was replaced

It was recognisably machine-generated, and measurably so. Against the known
tells of AI-produced design, the old codebase hit nearly all of them:

| Tell                                               | Count                        |
| -------------------------------------------------- | ---------------------------- |
| Tracked-out ALL-CAPS eyebrow above every heading   | 25                           |
| `WORD — fragment` labels with a spaced em dash     | `01 — Résumé · LaTeX source` |
| Numbered markers on things that are not a sequence | `00` / `01` / `02`           |
| One rounded card for every kind of content         | `rounded-md border` ×33      |
| Fade-and-slide-up on every section                 | `animate-rise-in` ×17        |
| Monospace for small data labels                    | every eyebrow and badge      |

Plus `/` and `/build` were ~85% the same file, and only **two `lg:` breakpoints
existed** in the whole app, so a 27" monitor rendered like an iPad.

## Tokens

Defined once in `app/globals.css` `:root`, surfaced through
`tailwind.config.ts`.

```
--ink / --ink-raised     the press bed
--stock / --stock-shade  the sheet everything is read on
--type-strong/body/muted/faint   a real ink ramp
--marigold / --sage-ink          register marks, on the sheet
--marigold-lift / --sage-lift    the same accents, on the bed
--measure                        one line length for body copy
```

**Two accent variants is not redundancy.** `sage-ink` is calibrated for dark
text on light stock; on the dark bed it measures 3.44:1 and fails WCAG AA. The
`-lift` variants exist for the nav and tab bar. Use the wrong one and the
contrast audit will tell you.

The four-step ink ramp replaced **13 opacity steps of a single colour** standing
in for hierarchy.

## Rules

- **No eyebrows.** If a section needs a label, it needs a heading.
- **No numbered markers** unless the content is genuinely a sequence.
- **Surfaces differ by role.** An editorial verdict, a form, and a code listing
  should not share chrome. Use `Region` (a rule), `Notice` (a callout), or the
  bare sheet — not a card for everything.
- **One orchestrated page-load moment**, not an entrance animation per section.
- **Body copy stays within `max-w-measure`.**
- **`focus-visible:`, never `focus:`** — the latter fires on mouse clicks too.

## Primitives

`components/Sheet.tsx` — `Sheet`, `Region`, `Note`, `Notice`.
`components/PageShell.tsx` — the masthead + sheet + colophon shell every page
uses. It exists because the two main pages were near-duplicates.

## Verification is not optional

```bash
npm run build && npx next start -p 3000 &
node scripts/shoot.mjs http://127.0.0.1:3000 screenshots
```

Captures `/`, `/build`, `/profile` at **390 / 834 / 1440 / 1920** and exits
non-zero on horizontal overflow _or_ WCAG AA contrast failure.

The contrast audit earns its place. After the redesign looked finished by eye it
reported **14 real failures**, including disabled buttons at 1.00:1 —
invisible — and a heading at 1.05:1. Reading screenshots catches only what you
happen to look at; the audit checks every visible text node.

Fixes that came out of it, worth not regressing:

- `--type-faint` darkened `156,148,136` → `114,106,94` (2.64:1 → 4.69:1)
- disabled buttons given a solid muted fill rather than reduced opacity
- the mobile tab bar switched to the `-lift` accents

## Kept from the previous design

The genuinely non-generic craft: the film-grain `body::before` overlay, the
2.1rem baseline-grid background, Fraunces `ss01`/`ss02` figures, the marigold
`::selection` and caret, the custom scrollbar — and every piece of the
accessibility work (44px touch targets, 16px iOS inputs, safe-area insets,
`prefers-reduced-motion`).

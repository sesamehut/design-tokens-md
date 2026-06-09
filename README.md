# @sesamehut/design-tokens-md

> Compile a **DESIGN.md** spec into **W3C DTCG** design tokens and **Tailwind v4 `@theme`** CSS — pure, deterministic, byte-identical codegen primitives.

[![npm version](https://img.shields.io/npm/v/@sesamehut/design-tokens-md.svg)](https://www.npmjs.com/package/@sesamehut/design-tokens-md)
[![license: MIT](https://img.shields.io/npm/l/@sesamehut/design-tokens-md.svg)](./LICENSE)
[![node >=20](https://img.shields.io/node/v/@sesamehut/design-tokens-md.svg)](#requirements)

A small set of **pure functions** that turn the YAML frontmatter of a [`design.md`](https://github.com/google/design.md) spec into two checked-in build artifacts:

- `tokens.dtcg.json` — a spec-compliant [W3C DTCG 2025.10](https://www.designtokens.org/tr/) token file (the engineering interchange format)
- `tokens.css` — Tailwind v4 `@theme` blocks plus CSS custom properties, ready to `@import`

No config object, no CLI, no global state. You compose the primitives into a tiny orchestrator script that owns *your* project's paths, scope, and banner — the same way [shadcn/ui](https://ui.shadcn.com/) hands you components instead of a black-box dependency. The output is **byte-for-byte reproducible**, so you can commit it and guard it with a `git diff --exit-code` gate in CI.

---

## Why

Most design-token toolchains (Style Dictionary, Tokens Studio, Figma sync) ask you to adopt a new source of truth and a heavy build graph. `design.md` already lets a designer hand you one readable Markdown file. This package is the missing **last mile**: a translation + render layer that takes that file and emits tokens your app actually consumes — with three properties most pipelines lack:

- **Pure & deterministic.** Every function is `(input) → output` with no clock, no `Math.random`, no locale-dependent sort. Run it on any machine, any Node ≥ 20, and get identical bytes.
- **Spec-compliant DTCG, losslessly.** The official `design.md` DTCG exporter drops the component bundle, typography sub-values, and the semantic layer, and packs alpha into an 8-digit hex (non-conforming for the 2025.10 Color Module). This package ships its own translation layer that preserves all of it and emits conforming `{colorSpace, components, alpha?, hex}` color values.
- **Commit-and-gate friendly.** Because output is reproducible, you check it into git and add one CI step — `regenerate && git diff --exit-code` — that fails the build if anyone hand-edits a generated file or forgets to regenerate after changing `DESIGN.md`.

---

## How it works

```text
        DESIGN.md  (design.md frontmatter — the designer's single input)
            │
            │  ── this package: 4 pure-function stages ──
            ▼
  1. readDesignMd ............. read file, split off YAML frontmatter (verbatim)
  2. lint() ↦ assertLintBaseline   gate findings against an accepted floor
  3. buildDtcg ............... frontmatter → canonical W3C DTCG model
  4. renderTokensCss ......... DTCG model → Tailwind v4 @theme CSS
            │
            ▼
  tokens.dtcg.json  +  tokens.css     (checked-in, byte-identical build artifacts)
```

Stage 2 borrows the linter from [`@google/design.md`](https://www.npmjs.com/package/@google/design.md) (a peer dependency) — but only as a *gate*. The actual DTCG translation in stage 3 is owned here, because the official exporter is lossy and non-conforming (see [Relationship to design.md](#relationship-to-designmd)).

---

## Install

```bash
npm install --save-dev @sesamehut/design-tokens-md @google/design.md yaml
```

`@google/design.md` and `yaml` are **peer dependencies** — install them alongside.

### Requirements

- **Node ≥ 20**, ESM only (`"type": "module"`)
- **Tailwind v4** on the consuming side (the output uses `@theme` / `@theme inline`, not v3 `@tailwind` directives)

---

## Quick start

### 1. Write a `DESIGN.md`

A `design.md` file is Markdown with a YAML frontmatter block. The token-relevant keys are `colors`, `typography`, `spacing`, `rounded`, an optional `layout`, and `components`:

```md
---
version: alpha
name: acme-tokens
description: A tiny example design system.

colors:
  # The semantic layer (see below) expects these primitive role names.
  canvas: "#eeefe9"
  surface-card: "#ffffff"
  surface-soft: "#e5e7e0"
  surface-doc: "#fcfcfa"
  primary: "#f7a501"
  on-primary: "#23251d"
  ink: "#23251d"
  body: "#4d4f46"
  ash: "#9b9c92"
  stone: "#b6b7af"
  link-blue: "#1d4ed8"
  link-teal: "#1078a3"
  hairline: "#bfc1b7"
  hairline-soft: "#dcdfd2"
  focus-ring: "rgba(59,130,246,0.5)"   # rgba() is accepted; alpha < 1 round-trips

spacing:
  sm: 8px
  md: 12px
  section: 80px

rounded:
  md: 6px
  full: 9999px

# `layout` is OPTIONAL — declaration-driven. Omit it and no --layout-* tokens are emitted.
layout:
  container-max: 1280px
  gutter-desktop: 24px
  section-rhythm-desktop: "{spacing.section}"   # aliases resolve to var(--spacing-section)

typography:
  body-md:
    fontFamily: '"IBM Plex Sans Variable", -apple-system, sans-serif'
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  hero-display:
    fontFamily: '"IBM Plex Sans Variable", -apple-system, sans-serif'
    fontSize: 40px
    fluid:                  # OPTIONAL fluid type → clamp(fontSize, preferred, max)
      preferred: 7vw
      max: 84px
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: -1.5px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 8px 16px
    height: 40px
---

# Acme Design System

…the rest of the document is prose for humans; only the frontmatter is compiled.
```

### 2. Wire the pipeline

Create a small orchestrator — e.g. `scripts/tokens/generate.mjs`. This is the part *you* own; it binds the pure primitives to your paths, scope, and file banner:

```js
#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from '@google/design.md/linter';
import {
  readDesignMd,
  assertLintBaseline,
  buildDtcg,
  renderTokensCss,
  serializeJson,
} from '@sesamehut/design-tokens-md';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const designMd = join(root, 'DESIGN.md');
const outDir = join(root, 'src', 'styles', 'tokens');

const header = `/* GENERATED — DO NOT EDIT BY HAND.
 * Source of truth: DESIGN.md. Regenerate: \`npm run tokens:generate\`. */`;

// Stage 1 — read file, split frontmatter
const { raw, frontmatter } = readDesignMd(designMd);

// Stage 2 — lint gate: throws iff a finding is outside the accepted floor.
// Pass your own baseline once you've reviewed your DESIGN.md's findings.
assertLintBaseline(lint(raw) /*, MY_BASELINE */);

// Stage 3 — translation → canonical DTCG model
const { dtcg, scope } = buildDtcg(frontmatter, {
  // Drop chrome you keep as a visual asset but your app shell never renders:
  // outOfScopeComponents: new Set(['doc-sidebar', 'pricing-tier-card']),
  // Redefine the semantic layer in your own primitive vocabulary:
  // semanticColor: [['surface', 'bg', 'Page background'], /* …tuples */],
});

// Stage 4 — write both artifacts (deterministic: LF, one trailing newline)
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tokens.dtcg.json'), serializeJson(dtcg));
writeFileSync(join(outDir, 'tokens.css'), renderTokensCss({ dtcg, header }));

console.log(`tokens: ${scope.kept.length} components (+${scope.dropped.length} dropped)`);
```

Wire it into `package.json`:

```jsonc
{
  "scripts": {
    "tokens:generate": "node scripts/tokens/generate.mjs",
    // The byte-identical gate: regenerate, then fail if anything changed.
    "tokens:check": "npm run tokens:generate && git diff --exit-code -- src/styles/tokens",
    "prebuild": "npm run tokens:check"
  }
}
```

### 3. Run it

```bash
npm run tokens:generate
```

You get `tokens.dtcg.json`:

```jsonc
{
  "$schema": "https://www.designtokens.org/schemas/2025.10/format.json",
  "$description": "A tiny example design system.",
  "color": {
    "$type": "color",
    "primary": {
      "$value": {
        "colorSpace": "srgb",
        "components": [0.96863, 0.64706, 0.00392],
        "hex": "#f7a501"
      }
    }
    // …
  },
  "semantic": {
    "color": {
      "$type": "color",
      "surface-action": { "$value": "{color.primary}", "$description": "The single saturated CTA surface." }
      // …14 light-only semantic roles, each aliasing a primitive
    }
  }
  // spacing, rounded, layout?, typography, component …
}
```

…and `tokens.css`:

```css
/* GENERATED — DO NOT EDIT BY HAND. … */

@theme {
  /* Primitive · color */
  --color-primary: #f7a501;
  --color-focus-ring: rgba(59,130,246,0.5);

  /* Primitive · spacing */
  --spacing-section: 80px;

  /* Primitive · radius */
  --radius-md: 6px;

  /* Primitive · layout — page rails / gutters / rhythm */
  --layout-container-max: 1280px;
  --layout-section-rhythm-desktop: var(--spacing-section);

  /* Primitive · typography */
  --text-hero-display: clamp(40px, 7vw, 84px);
  --text-hero-display--line-height: 1.05;
  --text-hero-display--font-weight: 800;
  --text-hero-display--letter-spacing: -1.5px;
}

@theme inline {
  /* Semantic · color (light-only) */
  --color-surface-action: var(--color-primary);
  --color-content-body: var(--color-body);
  --color-content-heading: var(--color-ink);
}

:root {
  /* Typography family / transform — no @theme namespace */
  --text-hero-display-font-family: "IBM Plex Sans Variable", -apple-system, sans-serif;

  /* Component visual contract */
  --component-button-primary-background-color: var(--color-primary);
  --component-button-primary-text-color: var(--color-on-primary);
  --component-button-primary-font-size: var(--text-body-md);
  --component-button-primary-rounded: var(--radius-md);
  --component-button-primary-padding: 8px 16px;
  --component-button-primary-height: 40px;
}
```

Then `@import` it after Tailwind in your CSS entry:

```css
@import "tailwindcss";
@import "./tokens/tokens.css";
```

Now `bg-primary`, `text-content-body`, `rounded-md`, `text-hero-display` and friends are real Tailwind utilities, and every `--component-*` var is available for hand-written component CSS.

### 4. Lock it in CI

`tokens:check` (wired into `prebuild` above) regenerates and runs `git diff --exit-code`. Because the output is byte-identical, this fails the build if anyone edits a generated file by hand or changes `DESIGN.md` without regenerating — the tokens can never silently drift from their source.

---

## The semantic color contract

The semantic layer is applied **here**, not in `DESIGN.md`. By default it is a set of **14 light-only roles**, each aliasing one primitive color, so a `DESIGN.md` that adopts the default mapping must provide these primitive names:

| Semantic role          | → primitive      | Meaning                                        |
| ---------------------- | ---------------- | ---------------------------------------------- |
| `surface-page`         | `canvas`         | Page background                                |
| `surface-raised`       | `surface-card`   | Dominant card / tile surface                   |
| `surface-sunken`       | `surface-soft`   | Recessed fill (secondary buttons, code chips)  |
| `surface-doc`          | `surface-doc`    | Doc article body surface                       |
| `surface-action`       | `primary`        | The single saturated CTA surface               |
| `content-heading`      | `ink`            | Headlines, button text on light                |
| `content-body`         | `body`           | Default paragraph text                         |
| `content-on-action`    | `on-primary`     | Text on the primary CTA                        |
| `content-disabled`     | `ash`            | Disabled text                                  |
| `content-faint`        | `stone`          | Least-emphasis caption text                    |
| `content-link`         | `link-blue`      | Primary inline link                            |
| `content-link-subtle`  | `link-teal`      | Doc-article inline link variant                |
| `line-default`         | `hairline`       | 1px card border, table rule                    |
| `line-soft`            | `hairline-soft`  | In-card divider, soft inset rule               |

This mapping is exported as [`SEMANTIC_COLOR`](#semantic_color), and it is the **default** for `buildDtcg`'s `semanticColor` option. It is deliberately opinionated and **light-only** — there is no dark semantic layer (dark surfaces stay component-scoped primitives). If your `DESIGN.md` uses a different primitive vocabulary, pass your own role→primitive mapping rather than adopting these names:

```js
buildDtcg(frontmatter, {
  semanticColor: [
    ['surface', 'bg', 'Page background'],
    ['accent', 'brand', 'Primary CTA surface'],
    // …[role, primitive, description] tuples in your own vocabulary
  ],
});
```

Omitting the option keeps the built-in 14-role contract; the rest of the pipeline is structure-agnostic.

---

## API

All exports are pure functions or constants. Import from the package root:

```js
import {
  readDesignMd, normalizeText, serializeJson, CODEPOINT,   // io
  buildDtcg, SEMANTIC_COLOR,                                 // model
  assertLintBaseline, DEFAULT_BASELINE,                      // baseline
  renderTokensCss,                                           // css
} from '@sesamehut/design-tokens-md';
```

### `readDesignMd(path)`

Reads a `DESIGN.md` and splits off its YAML frontmatter. Returns `{ raw, frontmatter }` where `raw` is the full file (CRLF normalized to LF) and `frontmatter` is the verbatim YAML block. Throws if no `--- … ---` block is found at the file start.

### `buildDtcg(frontmatter, options?)`

The translation layer. Parses the frontmatter YAML and builds the canonical DTCG model.

- `frontmatter` — the verbatim YAML string from `readDesignMd`
- `options.outOfScopeComponents` — a `Set<string>` of component names to drop from the visual contract (chrome you keep in `DESIGN.md` as a visual asset but your app never renders). Defaults to keeping all.
- `options.semanticColor` — the role→primitive semantic layer as `[role, primitive, description]` tuples (same shape as [`SEMANTIC_COLOR`](#semantic_color)). Pass your own to redefine the layer in your vocabulary. Defaults to `SEMANTIC_COLOR`; omitting it reproduces prior output byte-for-byte.
- **Returns** `{ dtcg, scope: { kept: string[], dropped: string[] } }`

The `dtcg` object is spec-compliant W3C DTCG 2025.10: color values use the object form `{colorSpace, components, alpha?, hex}`; semantic values are alias strings; typography is the composite form; components ride DTCG's extensibility envelope. Ordering is canonical (fixed group order, code-point order within each group).

### `renderTokensCss({ dtcg, header })`

The pure renderer. Takes the `dtcg` model and your `header` string (the `GENERATED … DO NOT EDIT` banner you own) and returns the full `tokens.css` text — `@theme` primitives, `@theme inline` semantic aliases, and a `:root` block for typography companions + the component visual contract. LF, single trailing newline. This is the sole authority over byte order.

### `assertLintBaseline(report, baseline?)`

The lint gate. Takes a `report` from `@google/design.md`'s `lint()` and throws **iff** a finding is *not* in the accepted `baseline` (a new finding appeared, or the token inventory changed) — forcing a deliberate `DESIGN.md` + baseline review. Membership-based, not severity-based: a documented warning floor is fine; a *new* warning is a failure. Returns the matched findings for a one-line confirmation. Defaults to [`DEFAULT_BASELINE`](#default_baseline).

### `DEFAULT_BASELINE`

An array of accepted-floor identity strings (`severity::path` or `severity::message`) for the `DESIGN.md` shape this package was first designed against. If your `DESIGN.md` diverges, derive your own array (map over this one to patch the inventory line, or supply a fresh array).

### `SEMANTIC_COLOR`

The **default** 14-role semantic contract as an array of `[role, primitive, description]` tuples — the source for the table [above](#the-semantic-color-contract) and the default for [`buildDtcg`'s `semanticColor` option](#builddtcgfrontmatter-options). Re-exported so you can inspect, extend, or fully replace the mapping.

### `serializeJson(value)` · `normalizeText(text)` · `CODEPOINT`

Determinism utilities. `serializeJson` produces deterministic JSON (ordered construction + 2-space indent + LF + one trailing newline). `normalizeText` forces LF and exactly one trailing newline. `CODEPOINT` is a pure UTF-16 code-unit comparator — the only sort used in the pipeline, chosen over `localeCompare`/`Intl.Collator` because ICU collation tables differ across Node/OS builds and would break a byte-identical gate.

---

## Optional & declaration-driven features

- **`layout` dimension group** — page rails, gutters, section rhythm. Emitted only when `DESIGN.md` declares `layout:`. A component library that never lays out pages simply omits it and gets zero `--layout-*` output.
- **Fluid typography** — any typography scale can add `fluid: { preferred, max }` beside its `fontSize`. The engine assembles `clamp(fontSize, preferred, max)`, with `fontSize` as the non-fluid floor. (`fluid` is a key `@google/design.md` doesn't model, so its strip-unknown lint drops it before dimension validation — the `vw` term never trips the px/rem unit check.)
- **Alias resolution** — any dimension value can be a `{group.token}` reference (e.g. a layout rhythm pointing at `{spacing.section}`); it renders to `var(--spacing-section)`. Literals (`transparent`, `8px 16px`) pass through verbatim.

---

## Relationship to design.md

[`@google/design.md`](https://github.com/google/design.md) defines the `DESIGN.md` format and ships a linter and a `dtcg` exporter. This package uses its **linter** (as the stage-2 gate) but **replaces its exporter**, because — verified against 0.2.0 — the official `export dtcg` is:

- **Lossy** — drops the entire component bundle (the visual contract), drops typography `lineHeight` / `letterSpacing` / `textTransform`, drops the semantic layer.
- **Non-conforming** — packs alpha into an 8-digit `hex`, while the DTCG 2025.10 Color Module requires alpha as a sibling field (0–1, default 1) and mandates 6-digit `hex` to avoid conflicting with that alpha.

The translation layer here produces spec-compliant output the official emitter cannot, and is the reason the package exists.

---

## Used by

- [**sesamehut.studio**](https://sesamehut.studio) — the SesameHut studio site (Astro + Tailwind v4)
- **capy** — a cross-platform (Web + React Native via Uniwind) app design system

Both consume the same published engine; each owns a thin orchestrator that supplies its own `DESIGN.md` path, scope filter, and lint baseline. The engine is declaration-driven, so they share one codebase without their tokens bleeding into each other.

---

## License

[MIT](./LICENSE) © SesameHut

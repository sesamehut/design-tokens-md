# @sesamehut/design-tokens-md

> Drop-in replacement for **[`@google/design.md`](https://github.com/google-labs-code/design.md)**'s `dtcg` / `css-tailwind` exporters: compile a **DESIGN.md** you already maintain into lossless **W3C DTCG** tokens and **Tailwind v4 `@theme`** CSS — pure, deterministic, byte-identical.

[![npm version](https://img.shields.io/npm/v/@sesamehut/design-tokens-md.svg)](https://www.npmjs.com/package/@sesamehut/design-tokens-md)
[![license: MIT](https://img.shields.io/npm/l/@sesamehut/design-tokens-md.svg)](./LICENSE)
[![node >=20](https://img.shields.io/node/v/@sesamehut/design-tokens-md.svg)](#install)

[DESIGN.md](https://github.com/google-labs-code/design.md) is Google's plain-text format for giving coding agents a persistent grasp of a design system, and [`@google/design.md`](https://www.npmjs.com/package/@google/design.md) is its official linter + exporter. **If you already keep a `DESIGN.md` but have outgrown its built-in `dtcg` / `css-tailwind` exporters, this is a drop-in replacement for them** — a few pure functions that compile the *same* frontmatter into two checked-in artifacts:

- `tokens.dtcg.json` — a spec-conforming [W3C DTCG 2025.10](https://www.designtokens.org/tr/) token file
- `tokens.css` — Tailwind v4 `@theme` blocks + CSS custom properties, ready to `@import`

The output is **byte-for-byte reproducible**, so you commit it and guard it with a `git diff --exit-code` gate in CI.

## Why not the official exporter?

Verified against `@google/design.md` 0.2.0, its `export dtcg` / `css-tailwind` is:

- **Lossy** — drops the component bundle and the semantic layer; drops `textTransform`; flattens `lineHeight` to a unitless number; emits dimension sub-values as `{value, unit}` objects rather than source-faithful strings.
- **Non-conforming** — packs alpha into an 8-digit `hex` with no `alpha` member, while DTCG 2025.10 requires alpha as a `0–1` sibling and a 6-digit `hex`. Its Tailwind output is a single flat `@theme` block — no semantic aliases, no component contract.
- **Not reproducible** — no byte-stability guarantee (output rides YAML insertion order).

This package fixes all three: a translation layer that preserves everything and emits conforming `{colorSpace, components, alpha?, hex}` colors, rendered by pure `(input) → output` functions with no clock, no `Math.random`, no locale-dependent sort — identical bytes on any machine, any Node ≥ 20.

## Install

```bash
npm install --save-dev @sesamehut/design-tokens-md @google/design.md yaml
```

`@google/design.md` and `yaml` are **peer dependencies**. Node ≥ 20, ESM only; **Tailwind v4** on the consuming side (the output uses `@theme` / `@theme inline`, not v3 `@tailwind` directives).

## Usage

There's nothing new to author — you already maintain a `DESIGN.md`. Compose the pure primitives into a small orchestrator *you* own; it binds them to your paths, scope, and file banner:

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
const outDir = join(root, 'src', 'styles', 'tokens');
const header = `/* GENERATED — DO NOT EDIT BY HAND. Source: DESIGN.md. */`;

// 1. read file + split frontmatter
const { raw, frontmatter } = readDesignMd(join(root, 'DESIGN.md'));

// 2. lint gate — throws iff a finding is outside the accepted floor
assertLintBaseline(lint(raw) /*, MY_BASELINE */);

// 3. translate → canonical DTCG model
const { dtcg, scope } = buildDtcg(frontmatter, {
  baseScheme: 'light',                                 // REQUIRED — 'light' | 'dark'
  // outOfScopeComponents: new Set(['doc-sidebar']),   // drop chrome your app never renders
  // semanticColor: [['surface', 'bg', 'Page background'], /* …tuples */],  // your own vocabulary
});

// 4. write both artifacts (deterministic: LF, one trailing newline)
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tokens.dtcg.json'), serializeJson(dtcg));
writeFileSync(join(outDir, 'tokens.css'), renderTokensCss({ dtcg, header }));
```

Wire it into `package.json` and gate it in CI:

```jsonc
{
  "scripts": {
    "tokens:generate": "node scripts/tokens/generate.mjs",
    // regenerate, then fail the build if anything changed:
    "tokens:check": "npm run tokens:generate && git diff --exit-code -- src/styles/tokens",
    "prebuild": "npm run tokens:check"
  }
}
```

`@import "./tokens/tokens.css"` after Tailwind, and `bg-primary`, `text-content-body`, `rounded-md`, `text-hero-display` become real utilities while every `--component-*` var is available to hand-written CSS. Because the output is byte-identical, `tokens:check` fails if anyone hand-edits a generated file or changes `DESIGN.md` without regenerating — the tokens can't silently drift.

## API

All exports are pure functions or constants, imported from the package root.

- **`readDesignMd(path)`** → `{ raw, frontmatter }`. Reads the file (CRLF→LF) and splits off the verbatim YAML frontmatter; throws if absent.
- **`assertLintBaseline(report, baseline?)`** — gate on `@google/design.md`'s `lint()` output; throws **iff** a finding is outside the accepted `baseline` (membership-based, not severity-based — a documented warning floor passes, a *new* warning fails). Defaults to `DEFAULT_BASELINE`.
- **`buildDtcg(frontmatter, options?)`** → `{ dtcg, scope: { kept, dropped, darkLiterals } }`. The translation layer; re-parses the YAML and builds canonical DTCG 2025.10 (color in `{colorSpace, components, alpha?, hex}` form, fixed group order, code-point order within each group). **`options.baseScheme` is required** (`'light' | 'dark'`) — the base palette's scheme is declared explicitly, never inferred; it is recorded at the DTCG root (`$extensions[DARK_EXTENSION_NS].baseScheme`) and drives the rendered `color-scheme`. `options.outOfScopeComponents` (`Set<string>`) drops chrome from the visual contract; `options.semanticColor` redefines the role→primitive layer (defaults to `SEMANTIC_COLOR`) and is checked for **referential integrity** — a role aliasing a primitive your `colors:` doesn't declare throws at build, not as a dangling `var()` at render. An optional `colors-dark:` / `colors-light:` frontmatter block (see [Dark mode](#dark-mode--color-modes)) attaches each override to its primitive's `$extensions`; `scope.darkLiterals` flags component color slots that can't flip.
- **`renderTokensCss({ dtcg, header, colorModes? })`** → the full `tokens.css`: `@theme` primitives, `@theme inline` semantic aliases, and a `:root` block that **leads with the base `color-scheme`** (read from the DTCG's recorded `baseScheme`) followed by typography companions + the component contract. Sole authority over byte order. `colorModes` (required iff the DTCG carries a delta) appends the *alternate*-mode override block; without a delta the base scheme alone is emitted.
- **`SEMANTIC_COLOR`** — the default semantic mapping (see below); re-exported to inspect, extend, or replace.
- **`DARK_EXTENSION_NS`** — the reverse-DNS `$extensions` namespace (`com.sesamehut.design-tokens-md`) under which a primitive carries its alternate-mode override; read it to build a non-CSS theme (e.g. React Native) from the DTCG file.
- **`DEFAULT_BASELINE`** — accepted-floor lint identities for the `DESIGN.md` shape this package was first built against.
- **`serializeJson` · `normalizeText` · `CODEPOINT`** — determinism utilities: ordered JSON, LF + one trailing newline, and a pure UTF-16 comparator (chosen over `localeCompare`/`Intl.Collator`, whose ICU tables vary across builds and would break a byte-identical gate).

### The semantic color layer

The semantic layer is applied **here**, not in `DESIGN.md` — by default 14 roles, each aliasing one primitive. It is a *single, mode-agnostic* mapping: there is no per-mode remapping. When a [dark/light delta](#dark-mode--color-modes) recolors a primitive, every role aliasing it re-resolves automatically (recolor, not remap). The default mapping (`SEMANTIC_COLOR`) expects these primitive names: `canvas`, `surface-card`, `surface-soft`, `surface-doc`, `primary`, `on-primary`, `ink`, `body`, `ash`, `stone`, `link-blue`, `link-teal`, `hairline`, `hairline-soft`. If your `DESIGN.md` uses a different vocabulary, pass your own mapping:

```js
buildDtcg(frontmatter, {
  semanticColor: [
    ['surface', 'bg', 'Page background'],
    ['accent', 'brand', 'Primary CTA surface'],
    // [role, primitive, description?] tuples
  ],
});
```

### Beyond Google's base spec

- **`layout` group** — page rails / gutters / rhythm; emitted only when `DESIGN.md` declares `layout:`.
- **Fluid typography** — `fluid: { preferred, max }` beside a `fontSize` compiles to `clamp(fontSize, preferred, max)`.
- **Alias resolution** — any dimension value can be a `{group.token}` reference (e.g. `{spacing.section}` → `var(--spacing-section)`).

### Dark mode / color modes

`DESIGN.md`'s `colors:` block is the project's **base** mode. You declare which scheme it is **explicitly** — `buildDtcg` requires `baseScheme: 'light' | 'dark'` (never inferred, no light default), and the engine advertises it as `color-scheme` on `:root`. To add the *other* mode, declare a sibling **delta** block listing only the primitives that change — `colors-dark:` (base light) or `colors-light:` (base dark); the same-as-base block is rejected:

```yaml
colors:        # base (here: light)
  canvas: "#eeefe9"
  ink:    "#23251d"
colors-dark:   # delta — only what flips
  canvas: "#1a1b16"
  ink:    "#f7f5f2"
```

Each override rides the primitive's DTCG `$extensions` (`com.sesamehut.design-tokens-md` → `{ dark | light }`), so `tokens.dtcg.json` stays spec-conforming and a primitive without a delta keeps its byte-identical single-mode shape. Pass `colorModes` to `renderTokensCss` to emit the CSS override block:

```js
const { dtcg } = buildDtcg(frontmatter, { baseScheme: 'light' });
renderTokensCss({
  dtcg,
  header,
  colorModes: { strategy: 'selector' }, // 'selector' (default) | 'media' | 'both'
});
```

The block is **raw `--color-*` redeclaration** under a dark/light activation — never a second `@theme`. Because every utility, semantic alias, and component var resolves `var(--color-*)` at use-site, redeclaring just the changed primitives flips the whole system. This is **recolor, not remap**: a delta can't re-point a semantic role to a different primitive (a future `semanticColorDark`, deliberately out of scope).

Strategies:

- **`'selector'`** (default) — emits `[data-theme="dark"] { … }`. This is the Tailwind v4 path for **both** system-follow *and* a manual toggle: add the matching variant and the official init script, and the engine just supplies the dark vars under that selector.
  ```css
  @import "tailwindcss";
  @custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
  ```
  ```html
  <script>
    // inline in <head> to avoid FOUC — system default + remembered manual choice
    document.documentElement.dataset.theme =
      localStorage.theme ??
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  </script>
  ```
- **`'media'`** — emits `@media (prefers-color-scheme: dark) { :root { … } }` only (follows the OS, no manual toggle, zero JS).
- **`'both'`** — emits both, with the media query guarded (`:root:not([data-theme="light"])`) so an explicit choice always wins.

`darkSelector` / `lightSelector` (default `[data-theme="dark"]` / `[data-theme="light"]`) are configurable. A **dark-only** project needs no delta — put the dark values in `colors:` and pass `baseScheme: 'dark'`; the engine emits `:root { color-scheme: dark }` and a single-mode palette (no toggle, no JS). Non-CSS consumers (e.g. React Native) skip `colorModes` and read both the base scheme (`$extensions[DARK_EXTENSION_NS].baseScheme`, at the DTCG root) and the per-primitive overrides (`DARK_EXTENSION_NS` on each primitive) straight from the DTCG file.

## Relationship to design.md

`@google/design.md` defines the `DESIGN.md` format and ships the linter + exporters. This package keeps its **linter** (as the gate) but **replaces both exporters** — see [Why not the official exporter?](#why-not-the-official-exporter). It shares no code or data structure with Google's emitters: it re-parses the same frontmatter and owns the entire DTCG + CSS translation.

## Used by

- [**sesamehut.studio**](https://sesamehut.studio) — the SesameHut studio site (Astro + Tailwind v4)
- **capy** — a cross-platform (Web + React Native via Uniwind) app design system

Both consume the same published engine; each owns a thin orchestrator with its own `DESIGN.md` path, scope filter, and lint baseline.

## License

[MIT](./LICENSE) © SesameHut

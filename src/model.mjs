// Stage 1 parse + Stage 2 translation layer (DESIGN.md frontmatter →
// canonical DTCG single source).
//
// Why DESIGN.md is parsed directly here instead of via @google/design.md's
// `export dtcg` (verified 2026-05-26 against 0.2.0): the official exporter is
// lossy AND non-conforming. Lossy — drops the entire component bundle (the
// visual contract), drops typography lineHeight / letterSpacing /
// textTransform, drops the semantic layer. Non-conforming — packs alpha into
// an 8-digit `hex` and ships `components` with only 3 entries, while the
// 2025.10 Color Module requires alpha as a sibling field (0–1, defaults to 1)
// and explicitly mandates 6-digit `hex` "to avoid conflicts with the provided
// alpha value." An engineering-owned translation layer is therefore required;
// this module is that layer, and it produces spec-compliant output the
// official emitter cannot. @google/design.md's lint() is still the authority
// for the Stage 2d gate (see baseline.mjs).
//
// The output is the DTCG engineering single source — spec-compliant W3C
// DTCG 2025.10:
//   - color $value uses the object form {colorSpace, components, alpha?, hex}.
//     `hex` (6-digit) is the byte-stable round-trip authority — CSS renders
//     from it. `components` is the spec-mandated sRGB 0..1 representation,
//     derived from `hex` at 5-decimal precision; it sits on the DTCG side of
//     the boundary so future consumers (oklch / p3 transformers, design
//     tools) have a canonical entry point without touching CSS.
//   - semantic $value stays an alias string (`{color.x}`) — spec-allowed.
//   - typography is the composite form with every sub-value source-faithful.
//   - component bundles preserve the visual contract through DTCG's
//     extensibility envelope; this is an engineering-internal shape, not a
//     spec type.
// Ordering is canonical (fixed group order; CODEPOINT within each group); the
// primitive/semantic/component layering and the consumer-supplied scope
// filter are auditable in this JSON alone.

import { parse } from 'yaml';
import { CODEPOINT } from './io.mjs';

/**
 * Vendor namespace (reverse-DNS, per DTCG $extensions convention) under which a
 * primitive carries its alternate-mode override. Single source of truth, shared
 * by the renderer and any DTCG consumer (e.g. a React Native theme builder that
 * reads `$extensions[DARK_EXTENSION_NS].dark|light` instead of CSS vars).
 */
export const DARK_EXTENSION_NS = 'com.sesamehut.design-tokens-md';

/**
 * Semantic layer — applied HERE, not in DESIGN.md. A SINGLE role→primitive
 * mapping, mode-agnostic: there is deliberately NO per-mode semantic remapping.
 * When a `colors-dark:` / `colors-light:` delta recolors a primitive (see
 * buildDtcg), every role aliasing it re-resolves automatically — dark mode here
 * is *recolor*, not *remap*. No accent semantics either — pastel callouts are
 * component-scoped (YAGNI). Each role is grounded in DESIGN.md's own "## Colors"
 * role prose; the rationale is checked into the DTCG $description so the
 * layering is auditable.
 *
 * This is the DEFAULT for buildDtcg's `semanticColor` option — the 14-role
 * contract DESIGN.md primitives must supply when no override is passed. It is
 * re-exported so a consumer can inspect it, extend it, or pass a wholly
 * different role→primitive mapping for its own primitive vocabulary.
 */
export const SEMANTIC_COLOR = [
  ['surface-page', 'canvas', 'Warm cream page background, end-to-end on every page.'],
  ['surface-raised', 'surface-card', 'Dominant white card / tile surface on the canvas.'],
  ['surface-sunken', 'surface-soft', 'Recessed fill: secondary buttons, inline-code chips.'],
  ['surface-doc', 'surface-doc', 'Faintly cream-warm surface for doc article body cards.'],
  ['surface-action', 'primary', 'The single saturated CTA surface.'],
  ['content-heading', 'ink', 'Headlines and button text on light surfaces.'],
  ['content-body', 'body', 'Default paragraph / body text — the most-used text color.'],
  ['content-on-action', 'on-primary', 'Text on the primary CTA surface.'],
  ['content-disabled', 'ash', 'Disabled-state text.'],
  ['content-faint', 'stone', 'Least-emphasis caption text.'],
  ['content-link', 'link-blue', 'Primary informational inline link.'],
  ['content-link-subtle', 'link-teal', 'Doc-article inline link variant.'],
  ['line-default', 'hairline', '1px card border, table rule.'],
  ['line-soft', 'hairline-soft', 'In-card row divider, soft inset rule.'],
];

/** DESIGN.md component bundle field → canonical emission order. */
const COMPONENT_FIELDS = [
  'backgroundColor',
  'textColor',
  'typography',
  'rounded',
  'padding',
  'height',
  'width',
];

/** Deterministic scalar → canonical string (verbatim, no float math, no Intl). */
function str(v) {
  return String(v);
}

/**
 * Typography fontSize → canonical CSS value. When a scale declares an optional
 * `fluid: {preferred, max}` beside its fixed `fontSize`, assemble a CSS
 * clamp(fontSize, preferred, max) — `fontSize` is the min / non-fluid floor.
 *
 * `fluid` is a key @google/design.md does not model, so its strip-unknown lint
 * drops it before dimension validation — the `vw` preferred term never trips
 * the px/rem/em unit check. A scale without `fluid` returns the verbatim
 * dimension, byte-identical to before this field existed.
 */
function fontSizeValue(t) {
  return t.fluid
    ? `clamp(${str(t.fontSize)}, ${str(t.fluid.preferred)}, ${str(t.fluid.max)})`
    : str(t.fontSize);
}

/** sRGB byte → 0..1 component at 5-decimal precision (round-trips ×255 + round). */
function srgbComponent(byte) {
  return Math.round((byte / 255) * 100000) / 100000;
}

/**
 * Parse a DESIGN.md primitive color string and emit a DTCG 2025.10 Color
 * Module `$value` object. Accepts either 6-digit `#RRGGBB` or
 * `rgba(R,G,B,A)`. The 6-digit `hex` field is the byte-stable authority for
 * downstream CSS rendering; `components` is the spec-required sRGB 0..1
 * representation; `alpha` is a sibling field present only when < 1 (the spec
 * default).
 */
function parseColor(source) {
  const hex6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(source);
  if (hex6) {
    const [, r, g, b] = hex6;
    const rb = parseInt(r, 16);
    const gb = parseInt(g, 16);
    const bb = parseInt(b, 16);
    return ordered([
      ['colorSpace', 'srgb'],
      ['components', [srgbComponent(rb), srgbComponent(gb), srgbComponent(bb)]],
      ['hex', source.toLowerCase()],
    ]);
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i
    .exec(source);
  if (rgba) {
    const [, r, g, b, a] = rgba;
    const rb = +r;
    const gb = +g;
    const bb = +b;
    const alpha = +a;
    const hex = `#${[rb, gb, bb].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    return ordered([
      ['colorSpace', 'srgb'],
      ['components', [srgbComponent(rb), srgbComponent(gb), srgbComponent(bb)]],
      ['alpha', alpha],
      ['hex', hex],
    ]);
  }
  throw new Error(
    `DESIGN.md primitive color ${JSON.stringify(source)} must be 6-digit ` +
      `"#RRGGBB" or "rgba(r,g,b,a)" — model.mjs cannot encode it.`,
  );
}

/** Rewrite a DESIGN.md `{colors.x}` ref to the DTCG `{color.x}` alias. */
function normalizeRef(value) {
  const m = /^\{([a-z]+)\.([a-z0-9-]+)\}$/.exec(value);
  if (!m) return value; // literal: "transparent", "8px 16px", "40px", …
  const group = m[1] === 'colors' ? 'color' : m[1];
  return `{${group}.${m[2]}}`;
}

/** Build an object with keys inserted in `order` (V8 preserves that order). */
function ordered(pairs) {
  const o = {};
  for (const [k, v] of pairs) o[k] = v;
  return o;
}

function sortedEntries(obj) {
  return Object.keys(obj)
    .sort(CODEPOINT)
    .map((k) => [k, obj[k]]);
}

/**
 * Parse DESIGN.md frontmatter and build the canonical DTCG single source.
 *
 * @param {string} frontmatter verbatim YAML block from DESIGN.md
 * @param {object} [options]
 * @param {Set<string>} [options.outOfScopeComponents] component names to drop
 *   from the visual contract (chrome retained as DESIGN.md visual assets
 *   but unused by the consumer's app shell — exactly the orphaned-token lint
 *   warnings the consumer baselines). Defaults to an empty set (keep all).
 * @param {Array<[string, string, string?]>} [options.semanticColor] the
 *   role→primitive semantic layer as [role, primitive, description] tuples
 *   (same shape as the exported SEMANTIC_COLOR). A consumer whose DESIGN.md
 *   uses a different primitive vocabulary passes its own mapping; the rest of
 *   the pipeline is structure-agnostic. Defaults to SEMANTIC_COLOR.
 * @param {'light'|'dark'} options.baseScheme REQUIRED — the color scheme of the
 *   base `colors:` palette, declared explicitly (never inferred, no light
 *   default). Drives the `color-scheme` the renderer advertises and fixes which
 *   alternate-mode delta block is valid. Throws if absent or not 'light'|'dark'.
 *
 * Color modes (beyond Google's base spec): `baseScheme` names the base palette's
 * mode; an OPTIONAL sibling frontmatter block recolors a subset of primitives
 * for the *other* mode — `colors-dark:` when the base is light, `colors-light:`
 * when the base is dark (the same-as-base block is a contradiction). Each
 * override rides the primitive's DTCG `$extensions`; the root node records
 * `$extensions[ns].baseScheme`. The renderer always advertises the base
 * `color-scheme` and, given a delta, emits the alternate-mode block (see
 * renderTokensCss `colorModes`).
 *
 * @returns {{ dtcg: object, scope: { kept: string[], dropped: string[],
 *   darkLiterals: string[] } }} `darkLiterals` lists `component.field` color
 *   slots that are hardcoded literals (won't flip when a mode delta is active);
 *   empty unless a delta is present.
 */
export function buildDtcg(
  frontmatter,
  {
    outOfScopeComponents = new Set(),
    semanticColor = SEMANTIC_COLOR,
    baseScheme,
  } = {},
) {
  // The base color scheme is declared explicitly by the consumer, never
  // inferred. There is no light default: a single-palette project still states
  // whether that palette is light or dark, so the CSS advertises the right
  // `color-scheme` and a dark-primary project is first-class.
  if (baseScheme !== 'light' && baseScheme !== 'dark') {
    throw new Error(
      `buildDtcg requires baseScheme: 'light' | 'dark' (got ` +
        `${JSON.stringify(baseScheme)}) — the base color scheme is declared ` +
        `explicitly, never inferred.`,
    );
  }

  const fm = parse(frontmatter);

  // ── Optional color-mode delta. The alternate mode is always the opposite of
  // the (explicit) baseScheme; its sibling block recolors a subset of
  // primitives. Fail loud on the same-as-base block (a contradiction), or on an
  // override naming a primitive the base never declared (a dead var / typo). ──
  const altMode = baseScheme === 'light' ? 'dark' : 'light';
  const altDelta =
    (altMode === 'dark' ? fm['colors-dark'] : fm['colors-light']) ?? null;
  const contradictoryDelta =
    altMode === 'dark' ? fm['colors-light'] : fm['colors-dark'];
  if (contradictoryDelta) {
    throw new Error(
      `baseScheme '${baseScheme}' takes a colors-${altMode} override; a ` +
        `colors-${baseScheme} block contradicts the declared base (model.mjs).`,
    );
  }
  if (altDelta) {
    for (const key of Object.keys(altDelta)) {
      if (!Object.hasOwn(fm.colors, key)) {
        throw new Error(
          `colors-${altMode} "${key}" has no matching colors primitive — ` +
            `model.mjs cannot emit a ${altMode} override for an undeclared ` +
            `primitive.`,
        );
      }
    }
  }

  // ── Primitive · color (DTCG 2025.10 Color Module object form). A primitive
  // the alternate mode recolors carries its override in DTCG's $extensions
  // envelope (vendor-namespaced, keyed by mode) — off the standard $value so
  // the file stays spec-conforming and a primitive without a delta keeps the
  // byte-identical single-mode `{ $value }` shape. ──
  const color = ordered([
    ['$type', 'color'],
    ...sortedEntries(fm.colors).map(([name, source]) => {
      const value = parseColor(str(source));
      if (altDelta && Object.hasOwn(altDelta, name)) {
        return [
          name,
          ordered([
            ['$value', value],
            [
              '$extensions',
              {
                [DARK_EXTENSION_NS]: { [altMode]: parseColor(str(altDelta[name])) },
              },
            ],
          ]),
        ];
      }
      return [name, { $value: value }];
    }),
  ]);

  // ── Primitive · dimension groups. A value is either a verbatim "Npx"
  // string or a {group.token} alias (e.g. a layout rhythm pointing at
  // {spacing.section}). normalizeRef is a pass-through for literals, so
  // spacing/rounded — which never carry aliases — stay byte-identical. ──
  const dimensionGroup = (src) =>
    ordered([
      ['$type', 'dimension'],
      ...sortedEntries(src).map(([name, v]) => [
        name,
        { $value: normalizeRef(str(v)) },
      ]),
    ]);
  const spacing = dimensionGroup(fm.spacing);
  const rounded = dimensionGroup(fm.rounded);
  // Optional page-layout primitives (container rails, gutters, section
  // rhythm). Declaration-driven: a consumer that omits `layout:` — e.g. a
  // component library that never lays out pages — emits no layout group and
  // its output is unchanged.
  const layout = fm.layout ? dimensionGroup(fm.layout) : null;

  // ── Primitive · typography (composite; every sub-value source-faithful;
  // fontSize may be fluid — see fontSizeValue; textTransform only when
  // DESIGN.md declares it). ──
  const typography = ordered([
    ['$type', 'typography'],
    ...sortedEntries(fm.typography).map(([name, t]) => {
      const value = ordered([
        ['fontFamily', str(t.fontFamily)],
        ['fontSize', fontSizeValue(t)],
        ['fontWeight', t.fontWeight],
        ['lineHeight', str(t.lineHeight)],
        ['letterSpacing', str(t.letterSpacing)],
      ]);
      if (t.textTransform != null) value.textTransform = str(t.textTransform);
      return [name, { $value: value }];
    }),
  ]);

  // ── Referential integrity: every semantic role must alias a primitive the
  // DESIGN.md actually declares, else the rendered CSS carries a dangling
  // var(--color-x). Checked here where fm.colors is in scope — fail loud at
  // build, not silently at render (matters most for a consumer-supplied
  // semanticColor whose vocabulary can drift from the palette). ──
  const missingPrimitives = [...semanticColor].filter(
    ([, primitive]) => !Object.hasOwn(fm.colors, primitive),
  );
  if (missingPrimitives.length > 0) {
    throw new Error(
      `semanticColor references primitive(s) absent from DESIGN.md colors: ` +
        missingPrimitives.map(([role, p]) => `${role} → ${p}`).join(', ') +
        `. Available: ${Object.keys(fm.colors).sort(CODEPOINT).join(', ')} ` +
        `(model.mjs).`,
    );
  }

  // ── Semantic · color (alias → primitive; auditable). The mapping defaults
  // to the built-in SEMANTIC_COLOR but a consumer can supply its own role
  // vocabulary via options.semanticColor (sort a copy — never mutate the
  // caller's array). $description is optional so an override tuple may omit it
  // without emitting a stray key. ──
  const semanticColorGroup = ordered([
    ['$type', 'color'],
    ...[...semanticColor]
      .sort((a, b) => CODEPOINT(a[0], b[0]))
      .map(([role, primitive, why]) => [
        role,
        why != null
          ? { $value: `{color.${primitive}}`, $description: why }
          : { $value: `{color.${primitive}}` },
      ]),
  ]);

  // ── Component · visual contract. Consumer-supplied scope filter applied here. ──
  const allComponentNames = Object.keys(fm.components);
  const kept = allComponentNames
    .filter((n) => !outOfScopeComponents.has(n))
    .sort(CODEPOINT);
  const dropped = allComponentNames
    .filter((n) => outOfScopeComponents.has(n))
    .sort(CODEPOINT);

  // ── Dark-mode lint (surfaced, not thrown): a kept component whose color
  // slot is a hardcoded literal (not a {colors.x} ref, not `transparent`) has
  // no primitive var to re-resolve, so it will NOT flip when a mode delta
  // recolors primitives. Echoed by the orchestrator; empty without a delta. ──
  const darkLiterals = altDelta
    ? kept.flatMap((name) =>
        ['backgroundColor', 'textColor']
          .filter((f) => {
            const v = fm.components[name]?.[f];
            return v != null && /^(#|rgba\()/i.test(str(v));
          })
          .map((f) => `${name}.${f}`),
      )
    : [];

  const component = ordered(
    kept.map((name) => {
      const bundle = fm.components[name];
      const value = ordered(
        COMPONENT_FIELDS.filter((f) => bundle[f] != null).map((f) => [
          f,
          normalizeRef(str(bundle[f])),
        ]),
      );
      return [name, { $value: value }];
    }),
  );

  const dtcg = ordered([
    ['$schema', 'https://www.designtokens.org/schemas/2025.10/format.json'],
    ['$description', str(fm.description).replace(/\n+$/, '')],
    ['$extensions', { [DARK_EXTENSION_NS]: { baseScheme } }],
    ['color', color],
    ['spacing', spacing],
    ['rounded', rounded],
    ...(layout ? [['layout', layout]] : []),
    ['typography', typography],
    ['semantic', ordered([['color', semanticColorGroup]])],
    ['component', component],
  ]);

  return { dtcg, scope: { kept, dropped, darkLiterals } };
}

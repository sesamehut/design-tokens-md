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
 * Semantic layer — applied HERE, not in DESIGN.md. Light-only: deliberately
 * NO dark semantic layer (surface-dark / on-dark stay primitives consumed
 * directly by the component layer). No accent semantics either — pastel
 * callouts are component-scoped (YAGNI). Each role is grounded in DESIGN.md's
 * own "## Colors" role prose; the rationale is checked into the DTCG
 * $description so the layering is auditable.
 *
 * Re-exported so a consumer can inspect / fork; the names here are the
 * fixed 14-role contract that DESIGN.md primitives must supply.
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
 * @returns {{ dtcg: object, scope: { kept: string[], dropped: string[] } }}
 */
export function buildDtcg(frontmatter, { outOfScopeComponents = new Set() } = {}) {
  const fm = parse(frontmatter);

  // ── Primitive · color (DTCG 2025.10 Color Module object form). ──
  const color = ordered([
    ['$type', 'color'],
    ...sortedEntries(fm.colors).map(([name, source]) => [
      name,
      { $value: parseColor(str(source)) },
    ]),
  ]);

  // ── Primitive · dimension groups (verbatim "Npx" strings). ──
  const dimensionGroup = (src) =>
    ordered([
      ['$type', 'dimension'],
      ...sortedEntries(src).map(([name, v]) => [name, { $value: str(v) }]),
    ]);
  const spacing = dimensionGroup(fm.spacing);
  const rounded = dimensionGroup(fm.rounded);

  // ── Primitive · typography (composite; every sub-value source-faithful;
  // textTransform only when DESIGN.md declares it). ──
  const typography = ordered([
    ['$type', 'typography'],
    ...sortedEntries(fm.typography).map(([name, t]) => {
      const value = ordered([
        ['fontFamily', str(t.fontFamily)],
        ['fontSize', str(t.fontSize)],
        ['fontWeight', t.fontWeight],
        ['lineHeight', str(t.lineHeight)],
        ['letterSpacing', str(t.letterSpacing)],
      ]);
      if (t.textTransform != null) value.textTransform = str(t.textTransform);
      return [name, { $value: value }];
    }),
  ]);

  // ── Semantic · color (light-only; alias → primitive; auditable). ──
  const semanticColor = ordered([
    ['$type', 'color'],
    ...[...SEMANTIC_COLOR]
      .sort((a, b) => CODEPOINT(a[0], b[0]))
      .map(([role, primitive, why]) => [
        role,
        { $value: `{color.${primitive}}`, $description: why },
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
    ['color', color],
    ['spacing', spacing],
    ['rounded', rounded],
    ['typography', typography],
    ['semantic', ordered([['color', semanticColor]])],
    ['component', component],
  ]);

  return { dtcg, scope: { kept, dropped } };
}

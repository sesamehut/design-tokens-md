// Stage 3 — render the canonical DTCG model to one CSS file.
//
// Determinism is owned by the pure renderer below: it is the sole
// whitespace/order authority and renders from the canonical in-memory model,
// so no iteration variance can reach the byte-identical gate consumers wire
// up on the output file.
//
// Color $value is the DTCG 2025.10 object form (see model.mjs). The CSS
// authority is the `hex` field (6-digit) plus the optional `alpha` sibling —
// the renderer reconstructs the CSS color string directly from those two,
// never from `components`, so the float-precision of `components` is isolated
// to the DTCG file and cannot reach the byte-identical gate on the CSS.
//
// Output shape (Tailwind v4, verified contract):
//   @theme         — primitives → utilities (--color-* --spacing-* --radius-*
//                    --layout-* --text-* with
//                    --line-height/--font-weight/--letter-spacing)
//   @theme inline  — semantic light-only aliases → var(--color-<primitive>)
//   :root          — typography family/transform companions (no @theme
//                    namespace) + the component visual contract. Component-
//                    scoped, never utility-generating.

import { normalizeText } from './io.mjs';

const INDENT = '  ';

/**
 * Render a DESIGN.md `fontFamily` value as a CSS font-family value.
 *
 * - A comma-containing string is a multi-face stack already CSS-ready
 *   (each face individually quoted in DESIGN.md); pass through verbatim.
 * - A bare keyword (sans-serif, ui-monospace) emits unquoted.
 * - A bare name with whitespace ("IBM Plex Sans Variable") gets quoted.
 */
function fontFamily(name) {
  if (/,/.test(name)) return name;
  return /\s/.test(name) ? `"${name}"` : name;
}

/** `{group.token}` alias → CSS var; literals (transparent, 8px 16px) verbatim. */
function aliasToVar(value) {
  const m = /^\{([a-z]+)\.([a-z0-9-]+)\}$/.exec(value);
  if (!m) return value;
  const [, group, token] = m;
  if (group === 'rounded') return `var(--radius-${token})`;
  return `var(--${group}-${token})`;
}

function line(prop, value) {
  return `${INDENT}--${prop}: ${value};`;
}

/**
 * DTCG 2025.10 color $value object → CSS color string. Opaque colors emit
 * the canonical 6-digit `hex`; translucent colors reconstruct `rgba(r,g,b,a)`
 * directly from `hex` bytes and the `alpha` sibling — bypassing `components`
 * keeps the float-precision of the sRGB array out of the byte-identical path.
 */
function colorValueToCss(value) {
  if (value.alpha != null && value.alpha < 1) {
    const r = parseInt(value.hex.slice(1, 3), 16);
    const g = parseInt(value.hex.slice(3, 5), 16);
    const b = parseInt(value.hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${value.alpha})`;
  }
  return value.hex;
}

/**
 * A component's `typography` bundle ref expands to its companion CSS-var
 * lines. The ref MUST resolve to a `{typography.X}` primitive — throw (never
 * silently drop the bundle) if it doesn't. Stage 2d's lint gate already
 * rejects an unresolved *reference*; this is the narrower backstop for a
 * non-reference value, enforced where it is consumed (same fail-loud posture
 * as readDesignMd / assertLintBaseline).
 */
function componentTypographyLines(name, raw, dtcg) {
  const tm = /^\{typography\.([a-z0-9-]+)\}$/.exec(raw);
  const t = tm && dtcg.typography[tm[1]];
  if (!t) {
    throw new Error(
      `Component "${name}": typography ref ${JSON.stringify(raw)} does not ` +
        `resolve to a {typography.X} primitive — fix DESIGN.md and ` +
        `regenerate.`,
    );
  }
  const lines = [
    line(`component-${name}-font-size`, `var(--text-${tm[1]})`),
    line(`component-${name}-line-height`, `var(--text-${tm[1]}--line-height)`),
    line(`component-${name}-font-weight`, `var(--text-${tm[1]}--font-weight)`),
    line(
      `component-${name}-letter-spacing`,
      `var(--text-${tm[1]}--letter-spacing)`,
    ),
    line(`component-${name}-font-family`, `var(--text-${tm[1]}-font-family)`),
  ];
  if (t.$value.textTransform != null) {
    lines.push(
      line(
        `component-${name}-text-transform`,
        `var(--text-${tm[1]}-text-transform)`,
      ),
    );
  }
  return lines;
}

/**
 * Pure renderer: canonical DTCG model → the full tokens.css text (header
 * included, LF, single trailing newline). The single source of byte order.
 */
export function renderTokensCss({ dtcg, header }) {
  const tokensOf = (group) =>
    Object.keys(group).filter((k) => k !== '$type' && k !== '$description');

  const out = [];
  out.push(header, '');

  // ── @theme — primitives ──
  out.push('@theme {');
  out.push(`${INDENT}/* Primitive · color */`);
  for (const name of tokensOf(dtcg.color)) {
    out.push(line(`color-${name}`, colorValueToCss(dtcg.color[name].$value)));
  }
  out.push('', `${INDENT}/* Primitive · spacing */`);
  for (const name of tokensOf(dtcg.spacing)) {
    out.push(line(`spacing-${name}`, aliasToVar(dtcg.spacing[name].$value)));
  }
  out.push('', `${INDENT}/* Primitive · radius */`);
  for (const name of tokensOf(dtcg.rounded)) {
    out.push(line(`radius-${name}`, aliasToVar(dtcg.rounded[name].$value)));
  }
  if (dtcg.layout) {
    out.push('', `${INDENT}/* Primitive · layout — page rails / gutters / rhythm */`);
    for (const name of tokensOf(dtcg.layout)) {
      out.push(line(`layout-${name}`, aliasToVar(dtcg.layout[name].$value)));
    }
  }
  out.push('', `${INDENT}/* Primitive · typography */`);
  for (const name of tokensOf(dtcg.typography)) {
    const v = dtcg.typography[name].$value;
    out.push(line(`text-${name}`, v.fontSize));
    out.push(line(`text-${name}--line-height`, v.lineHeight));
    out.push(line(`text-${name}--font-weight`, String(v.fontWeight)));
    out.push(line(`text-${name}--letter-spacing`, v.letterSpacing));
  }
  out.push('}', '');

  // ── @theme inline — semantic (light-only; → primitive) ──
  out.push('@theme inline {');
  out.push(`${INDENT}/* Semantic · color — design-system.md §一 (light-only) */`);
  for (const role of tokensOf(dtcg.semantic.color)) {
    out.push(line(`color-${role}`, aliasToVar(dtcg.semantic.color[role].$value)));
  }
  out.push('}', '');

  // ── :root — typography companions + component visual contract ──
  out.push(':root {');
  out.push(`${INDENT}/* Typography family / transform — no @theme namespace */`);
  for (const name of tokensOf(dtcg.typography)) {
    const v = dtcg.typography[name].$value;
    out.push(line(`text-${name}-font-family`, fontFamily(v.fontFamily)));
    if (v.textTransform != null) {
      out.push(line(`text-${name}-text-transform`, v.textTransform));
    }
  }
  out.push('', `${INDENT}/* Component visual contract — design-system.md §三 */`);
  for (const name of tokensOf(dtcg.component)) {
    const bundle = dtcg.component[name].$value;
    for (const [field, raw] of Object.entries(bundle)) {
      if (field === 'typography') {
        out.push(...componentTypographyLines(name, raw, dtcg));
        continue;
      }
      const cssField = field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      out.push(line(`component-${name}-${cssField}`, aliasToVar(raw)));
    }
  }
  out.push('}');

  return normalizeText(out.join('\n'));
}


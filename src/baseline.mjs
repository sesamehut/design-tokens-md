// Stage 2d — the lint gate.
//
// `@google/design.md`'s lint() validates DESIGN.md. Its findings for a stable
// DESIGN.md form a documented, accepted FLOOR — orphaned-warning paths
// (tokens referenced only via CSS, not by any DESIGN.md component bundle),
// false-positive contrast warnings (e.g. WCAG-1.4.3-exempt disabled state,
// `backgroundColor: "transparent"` parsed as #00000000 against literal
// black), out-of-scope chrome colors, and an inventory `info`.
//
// Therefore the gate is set-membership, NOT severity:
//   - it must NEVER "fail on any warning" — the documented set IS the floor;
//   - it fails iff a finding is NOT in the supplied baseline (i.e. a NEW
//     finding appeared, or the inventory changed), forcing a deliberate
//     DESIGN.md + baseline review and a tokens regeneration.
//
// {@link DEFAULT_BASELINE} captures the floor verified 2026-05-26 against
// `@google/design.md` 0.2.0 for the DESIGN.md form this package was first
// designed against; consumers whose DESIGN.md differs pass their own array.

/**
 * Default lint floor — exactly summary {errors:0, warnings:16, infos:1} for a
 * DESIGN.md that ships the same chrome / orphaned-color shape capy and sesame
 * use. Consumers whose DESIGN.md diverges (different orphan colors, different
 * transparent-bg component set, different inventory count) pass their own
 * baseline array to {@link assertLintBaseline} instead.
 */
export const DEFAULT_BASELINE = [
  // Finding 1 — focus-ring is referenced only via CSS outline / box-shadow,
  // not by any DESIGN.md component bundle field. Orphaned by representation.
  'warning::colors.focus-ring',
  // Finding 2 — WCAG-1.4.3-exempt disabled contrast (false positive).
  'warning::components.button-disabled',
  // Finding 3 — orphaned colors: consumed only by out-of-scope chrome.
  'warning::colors.primary-active',
  'warning::colors.charcoal',
  'warning::colors.mute',
  'warning::colors.stone',
  'warning::colors.hairline',
  'warning::colors.hairline-soft',
  'warning::colors.accent-blue',
  'warning::colors.accent-red',
  'warning::colors.accent-green',
  'warning::colors.accent-purple',
  // Finding 4 — transparent-bg false positives: the linter parses
  // "transparent" as #00000000 and computes contrast against literal black.
  // These components render over cream / white surfaces in practice.
  'warning::components.button-tertiary',
  'warning::components.product-tab',
  'warning::components.pill-tab',
  'warning::components.badge-uppercase',
  // Inventory info — matched by exact message so any token-count change
  // (a deliberate DESIGN.md edit) trips the gate and forces review.
  'info::Design system defines 29 colors, 20 typography scales, 6 rounding levels, 8 spacing tokens, 30 components.',
];

/** Stable identity for a finding: path-keyed, or exact message for the info. */
function identity(f) {
  return `${f.severity}::${f.path ?? f.message}`;
}

/**
 * Throw iff lint output exceeds the documented floor. Returns the matched
 * findings so the orchestrator can echo a one-line confirmation.
 *
 * @param {{ findings: Array<{severity:string,path?:string,message:string}>,
 *           summary: { errors:number, warnings:number, infos:number } }} report
 * @param {string[]} [baseline] accepted-floor identity strings (severity::path
 *   or severity::message). Defaults to {@link DEFAULT_BASELINE}.
 */
export function assertLintBaseline(report, baseline = DEFAULT_BASELINE) {
  const baselineSet = new Set(baseline);
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const unexpected = findings.filter((f) => !baselineSet.has(identity(f)));
  if (unexpected.length > 0) {
    const lines = unexpected.map(
      (f) => `  - [${f.severity}] ${f.path ?? '(no path)'}: ${f.message}`,
    );
    throw new Error(
      `Stage 2d lint gate: ${unexpected.length} finding(s) outside the ` +
        `documented baseline.\n${lines.join('\n')}\n` +
        `If this is an intended DESIGN.md change, update the baseline ` +
        `in the same change, then regenerate tokens.`,
    );
  }
  // Defense in depth: the summary must not report more than the floor even
  // if every individual finding happened to be path-matched.
  const s = report?.summary ?? {};
  const total = (s.errors ?? 0) + (s.warnings ?? 0) + (s.infos ?? 0);
  if (total > baselineSet.size) {
    throw new Error(
      `Stage 2d lint gate: summary total ${total} exceeds documented ` +
        `baseline ${baselineSet.size} (errors:${s.errors} warnings:` +
        `${s.warnings} infos:${s.infos}).`,
    );
  }
  return findings;
}

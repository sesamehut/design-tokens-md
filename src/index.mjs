// Barrel — re-exports stage primitives. Each `lib/*` module is a pure-function
// surface (no module-level project state); consumers compose them into their
// own orchestrator with project paths, scope filter, lint baseline, and banner.

export { CODEPOINT, readDesignMd, normalizeText, serializeJson } from './io.mjs';
export { buildDtcg, SEMANTIC_COLOR } from './model.mjs';
export { assertLintBaseline, DEFAULT_BASELINE } from './baseline.mjs';
export { renderTokensCss } from './css.mjs';

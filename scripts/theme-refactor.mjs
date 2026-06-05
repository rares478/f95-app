// One-shot mass refactor: replace literal hex colors in inline React styles
// with the corresponding CSS variable. Safe to re-run — once a hex is gone,
// it won't be re-matched.
//
// usage: node scripts/theme-refactor.mjs [--dry]
//
// We match the hex INSIDE quoted strings (`'#xxx'` / `"#xxx"`) so we don't
// touch hex literals that appear in comments or as part of larger hex codes.

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname.replace(/^\//, '');
const DRY = process.argv.includes('--dry');

// Order matters: longer hex first so `#fff5ed` isn't matched as `#fff` + `5ed`.
const MAP = [
  // 6-digit hex (must come before 3-digit to avoid partial matches)
  ['#ffffff', 'var(--text-primary)'],
  ['#f1d4d4', 'var(--status-danger-text)'],
  ['#f1a4a4', 'var(--status-danger-text)'],
  ['#e6e6e6', 'var(--text-secondary)'],
  ['#e0444c', 'var(--accent)'],
  ['#dcdcdc', 'var(--text-secondary)'],
  ['#d3a31f', 'var(--status-warning)'],
  ['#cfcfcf', 'var(--text-secondary)'],
  ['#c2453a', 'var(--accent-strong)'],
  ['#bdbdbd', 'var(--text-tertiary)'],
  ['#a86fb0', 'var(--status-purple)'],
  ['#9a9a9a', 'var(--text-muted)'],
  ['#8a8a8a', 'var(--text-muted)'],
  ['#7a2a2a', 'var(--accent-strong)'],
  ['#5a5a5a', 'var(--text-faint)'],
  ['#5cb85c', 'var(--status-success)'],
  ['#3aa757', 'var(--status-success)'],
  ['#3a78c2', 'var(--status-info)'],
  ['#3a3a3a', 'var(--border-strong)'],
  ['#3a1a1a', 'var(--status-danger-bg)'],
  ['#2a2a2a', 'var(--border)'],
  ['#262626', 'var(--bg-elevated)'],
  ['#1f1f1f', 'var(--bg-elevated)'],
  ['#1c1c1c', 'var(--border-faint)'],
  ['#1a1a1a', 'var(--bg-elevated)'],
  ['#141414', 'var(--bg-base)'],
  ['#0e0e0e', 'var(--bg-sunken)'],
  // 3-digit hex last
  ['#fff', 'var(--text-primary)'],
  ['#aaa', 'var(--text-tertiary)'],
  ['#999', 'var(--text-muted)'],
  ['#888', 'var(--text-muted)'],
  ['#666', 'var(--text-faint)'],
  ['#555', 'var(--text-faint)'],
  ['#444', 'var(--text-faint)'],
  ['#333', 'var(--border-strong)'],
  ['#222', 'var(--border-faint)'],
];

// Files where literal hex values are intentional (theme previews, etc.)
// and must not be replaced.
const SKIP = new Set([
  'lib/theme.ts',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

function skipped(path) {
  const rel = path.replace(/\\/g, '/').split('/src/')[1] ?? '';
  return SKIP.has(rel);
}

function refactorFile(path) {
  const src = readFileSync(path, 'utf8');
  let out = src;
  let touched = 0;
  for (const [hex, cssVar] of MAP) {
    // Two patterns:
    //  1) `'#abc'` standalone (the original easy case)
    //  2) `'... #abc ...'` hex embedded inside a longer string literal like
    //     `'1px solid #abc'`. We can't blindly replace the whole string, so
    //     we just swap the hex in-place with the CSS var.
    // Both use a non-hex lookahead so we don't gobble part of a longer hex.
    const escaped = hex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // (1) whole-string match
    const whole = new RegExp(`(['"])${escaped}(?![0-9a-fA-F])\\1`, 'g');
    out = out.replace(whole, (_, quote) => {
      touched++;
      return `${quote}${cssVar}${quote}`;
    });
    // (2) hex inside a longer string — only replace when surrounded by
    // typical CSS separators (space, comma) so we don't touch e.g. a URL.
    const inside = new RegExp(`(?<=[\\s,(])${escaped}(?![0-9a-fA-F])`, 'g');
    out = out.replace(inside, () => {
      touched++;
      return cssVar;
    });
  }
  if (touched > 0 && !DRY) writeFileSync(path, out);
  return touched;
}

const files = walk(ROOT).filter((f) => !skipped(f));
let total = 0;
const summary = [];
for (const f of files) {
  const n = refactorFile(f);
  if (n > 0) {
    total += n;
    summary.push(`  ${f.replace(ROOT + '/', '')}: ${n}`);
  }
}
console.log(`${DRY ? '[dry-run]' : ''} ${total} replacements across ${summary.length} files`);
console.log(summary.join('\n'));

/**
 * Developers often wrap long changelogs in XenForo spoilers (`details`) to
 * compress many versions — not for actual plot spoilers. Flatten those so
 * the timeline can see every header and render bodies without a click gate.
 */

/**
 * XenForo / BBCode sometimes nests bold+underline so the opening paren closes
 * before the version token:
 *   <b><u><b><u>Changelog (</u></b>wip.8189):</u></b>
 * Stitch those back into a single readable header before parsing.
 */
export function repairBrokenChangelogWipHeaders(html: string): string {
  return (html ?? '').replace(
    /Changelog\s*\(\s*(?:<\/[a-z][a-z0-9]*\s*>\s*)+(wip\.\d+)\s*\)\s*:?/gi,
    'Changelog ($1):',
  );
}

function promoteChangelogSummaryInner(inner: string): string {
  const text = inner
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || !/^changelog\b/i.test(text)) return '';
  return `<b>${text}</b><br>`;
}

export function unwrapChangelogSpoilers(html: string): string {
  let out = repairBrokenChangelogWipHeaders(html ?? '');
  // Keep changelog titles from spoiler labels; drop generic "Spoiler" labels.
  out = out.replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, (_m, inner: string) =>
    promoteChangelogSummaryInner(inner),
  );
  // Unwrap details (repeat for shallow nesting)
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/<details\b[^>]*>([\s\S]*?)<\/details>/gi, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}

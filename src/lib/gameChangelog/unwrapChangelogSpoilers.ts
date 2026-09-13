/**
 * Developers often wrap long changelogs in XenForo spoilers (`details`) to
 * compress many versions — not for actual plot spoilers. Flatten those so
 * the timeline can see every header and render bodies without a click gate.
 */
export function unwrapChangelogSpoilers(html: string): string {
  let out = html ?? '';
  // Drop the clickable label entirely
  out = out.replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi, '');
  // Unwrap details (repeat for shallow nesting)
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/<details\b[^>]*>([\s\S]*?)<\/details>/gi, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}

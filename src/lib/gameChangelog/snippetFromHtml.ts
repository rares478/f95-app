const DEFAULT_MAX = 180;

function stripToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Plain-text preview for changelog cards. Truncates to maxLen at a word
 * boundary when possible and appends an ellipsis character.
 */
export function snippetFromHtml(html: string, maxLen: number = DEFAULT_MAX): string {
  const text = stripToText(html);
  if (!text) return '';
  if (text.length <= maxLen) return text;

  const slice = text.slice(0, maxLen);
  const sp = slice.lastIndexOf(' ');
  const base = sp > Math.floor(maxLen * 0.6) ? slice.slice(0, sp) : slice;
  return `${base.trimEnd()}…`;
}

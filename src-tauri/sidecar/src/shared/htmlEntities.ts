/** Decode common HTML entities from F95Zone SAM/API strings (e.g. Ren&#039;Py). */
export function decodeHtmlEntities(input: string): string {
  let s = input;
  // Two passes so double-encoded forms like `&amp;#039;` become `'`.
  for (let i = 0; i < 2; i++) {
    s = s
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#x([0-9a-fA-F]+);/g, (full, hex: string) => {
        const cp = parseInt(hex, 16);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : full;
      })
      .replace(/&#(\d+);/g, (full, dec: string) => {
        const cp = Number(dec);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : full;
      });
  }
  return s;
}

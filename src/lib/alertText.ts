/** Strip HTML-ish noise and collapse whitespace from F95 alert strings. */
export function cleanAlertText(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function alertInitial(text: string): string {
  const clean = cleanAlertText(text);
  const m = clean.match(/[A-Za-z0-9À-ÿ]/);
  return m ? m[0].toUpperCase() : '?';
}

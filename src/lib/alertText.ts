import { decodeHtmlEntities } from './htmlEntities';

/** Strip HTML-ish noise and collapse whitespace from F95 alert strings. */
export function cleanAlertText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function alertInitial(text: string): string {
  const clean = cleanAlertText(text);
  const m = clean.match(/[A-Za-z0-9À-ÿ]/);
  return m ? m[0].toUpperCase() : '?';
}

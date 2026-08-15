import { KNOWN_PREFIXES } from '../types/sam';

const HTML_ENGINE_KEY = KNOWN_PREFIXES.find(
  (p) => p.group === 'engine' && p.name.trim().toLowerCase() === 'html',
)?.name.trim().toLowerCase() ?? 'html';

/** True when library store tags include the F95 HTML engine prefix. */
export function isHtmlEngine(storeTags: string[] | null | undefined): boolean {
  if (!storeTags?.length) return false;
  return storeTags.some((t) => t.trim().toLowerCase() === HTML_ENGINE_KEY);
}

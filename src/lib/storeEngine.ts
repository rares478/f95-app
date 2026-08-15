import { KNOWN_PREFIXES } from '../types/sam';

const HTML_ENGINE_KEY = KNOWN_PREFIXES.find(
  (p) => p.group === 'engine' && p.name.trim().toLowerCase() === 'html',
)?.name.trim().toLowerCase() ?? 'html';

const RENPY_ENGINE_KEY = KNOWN_PREFIXES.find(
  (p) => p.group === 'engine' && p.name.trim().toLowerCase() === "ren'py",
)?.name.trim().toLowerCase() ?? "ren'py";

const RPGM_ENGINE_KEY = KNOWN_PREFIXES.find(
  (p) => p.group === 'engine' && p.name.trim().toLowerCase() === 'rpgm',
)?.name.trim().toLowerCase() ?? 'rpgm';

/** True when library store tags include the F95 HTML engine prefix. */
export function isHtmlEngine(storeTags: string[] | null | undefined): boolean {
  if (!storeTags?.length) return false;
  return storeTags.some((t) => t.trim().toLowerCase() === HTML_ENGINE_KEY);
}

/** True when library store tags include the F95 Ren'Py engine prefix. */
export function isRenPyEngine(storeTags: string[] | null | undefined): boolean {
  if (!storeTags?.length) return false;
  return storeTags.some((t) => t.trim().toLowerCase() === RENPY_ENGINE_KEY);
}

/** True when library store tags include the F95 RPGM engine prefix. */
export function isRpgmEngine(storeTags: string[] | null | undefined): boolean {
  if (!storeTags?.length) return false;
  return storeTags.some((t) => t.trim().toLowerCase() === RPGM_ENGINE_KEY);
}

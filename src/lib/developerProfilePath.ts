/** In-app path for a game developer profile (title search in Games forum). */
export function developerProfilePath(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '/store';
  return `/developers/${encodeURIComponent(trimmed)}`;
}

export function parseDeveloperProfileParam(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

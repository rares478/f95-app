export const STREAMABLE_HOSTS = new Set([
  'pixeldrain',
  'mediafire',
  'gofile',
  'mega',
  'uploadhaven',
  'buzzheavier',
  'datanodes',
  'gdrive',
  'workupload',
  'mixdrop',
  'akirabox',
]);

export const HOST_COLORS: Record<string, string> = {
  mega: '#d9272e',
  mediafire: 'var(--status-info)',
  mixdrop: '#e85c00',
  pixeldrain: '#3a3a8f',
  gofile: '#4d4d4d',
  workupload: '#1f7a3a',
  uploadhaven: '#888888',
  datanodes: '#2a8aa8',
  buzzheavier: '#a87a2a',
  gdrive: '#4285f4',
  akirabox: '#5a6a8a',
  vikingfile: '#6a5a4a',
  bunkr: '#8a3a3a',
  cyberfile: '#6f4d8a',
  cyberdrop: '#8a4d6f',
  rapidgator: '#cc8a3a',
  '1fichier': '#3aaa8a',
};

export function shouldShowHostBadge(label: string, host: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s._-]+/g, '');
  const nl = norm(label);
  const nh = norm(host);
  if (!nh) return false;
  if (nl === nh) return false;
  if (nl.includes(nh) || nh.includes(nl)) return false;
  return true;
}

export type HostCategory = 'direct' | 'social' | 'unknown';

export interface HostInfo {
  host: string;
  category: HostCategory;
}

export interface ClassifyHostHints {
  /** Visible link text (e.g. "PIXELDRAIN" on F95 /dl/ anchors). */
  text?: string | null;
  /** Inline style; F95 paints host favicons via duckduckgo ip3/*.ico. */
  style?: string | null;
}

interface Pattern {
  host: string;
  regex: RegExp;
  category: HostCategory;
}

const PATTERNS: Pattern[] = [
  // direct file hosts
  { host: 'mega',          regex: /^(www\.)?mega\.(nz|co\.nz|io)$/i,                       category: 'direct' },
  { host: 'mediafire',     regex: /^(www\.)?mediafire\.com$/i,                              category: 'direct' },
  { host: 'mixdrop',       regex: /^(www\.)?mixdrop\.(co|ag|sx|to|top|club|gl|ch|ms|nu)$/i,     category: 'direct' },
  { host: 'pixeldrain',    regex: /^(www\.)?pixeldrain\.com$/i,                             category: 'direct' },
  { host: 'gofile',        regex: /^(www\.)?gofile\.io$/i,                                  category: 'direct' },
  { host: 'workupload',    regex: /^(www\.)?workupload\.com$/i,                             category: 'direct' },
  { host: 'anonfiles',     regex: /^(www\.)?anonfiles\.com$/i,                              category: 'direct' },
  { host: 'datanodes',     regex: /^(www\.)?datanodes\.to$/i,                               category: 'direct' },
  { host: 'buzzheavier',   regex: /^(www\.)?(buzzheavier\.com|bzzhr\.(co|to)|fuckingfast\.(net|co))$/i, category: 'direct' },
  { host: 'racaty',        regex: /^(www\.)?racaty\.(net|io)$/i,                            category: 'direct' },
  { host: 'uploadhaven',   regex: /^(www\.)?uploadhaven\.com$/i,                            category: 'direct' },
  { host: 'zippyshare',    regex: /^(www\.)?zippyshare\.com$/i,                             category: 'direct' },
  { host: 'k2s',           regex: /^(www\.)?k2s\.cc$/i,                                     category: 'direct' },
  { host: 'rapidgator',    regex: /^(www\.)?rapidgator\.net$/i,                             category: 'direct' },
  { host: 'turbobit',      regex: /^(www\.)?turbobit\.net$/i,                               category: 'direct' },
  { host: 'nopy',          regex: /^(www\.)?nopy\.to$/i,                                    category: 'direct' },
  { host: 'sendspace',     regex: /^(www\.)?sendspace\.com$/i,                              category: 'direct' },
  { host: '1fichier',      regex: /^(www\.)?1fichier\.com$/i,                               category: 'direct' },
  { host: 'bunkr',         regex: /^(.*\.)?bunkr\.(ru|sk|si|la|fi|ws|cr|red|ph|pk|black)$/i, category: 'direct' },
  { host: 'cyberfile',     regex: /^(www\.)?cyberfile\.(me|is|su)$/i,                       category: 'direct' },
  { host: 'cyberdrop',     regex: /^(www\.)?cyberdrop\.me$/i,                               category: 'direct' },
  { host: 'dropbox',       regex: /^(www\.)?dropbox\.com$/i,                                category: 'direct' },
  { host: 'gdrive',        regex: /^(drive|docs)\.google\.com$/i,                           category: 'direct' },
  { host: 'pcloud',        regex: /^(my\.|www\.)?pcloud\.com$|^u\.pcloud\.link$/i,          category: 'direct' },
  { host: 'akirabox',      regex: /^(www\.)?akirabox\.com$/i,                               category: 'direct' },
  { host: 'vikingfile',    regex: /^(www\.)?(vikingfile\.com|vik1ngfile\.site)$/i,         category: 'direct' },
  // social / creator pages (linked from threads but not downloads)
  { host: 'patreon',       regex: /^(www\.)?patreon\.com$/i,                                category: 'social' },
  { host: 'subscribestar', regex: /^(www\.)?subscribestar\.(adult|com)$/i,                  category: 'social' },
  { host: 'twitter',       regex: /^(www\.)?(twitter|x)\.com$/i,                            category: 'social' },
  { host: 'discord',       regex: /^(www\.)?discord\.(gg|com)$/i,                           category: 'social' },
  { host: 'itch',          regex: /^(.+\.)?itch\.io$/i,                                     category: 'social' },
  { host: 'ko-fi',         regex: /^(www\.)?ko-fi\.com$/i,                                  category: 'social' },
  { host: 'youtube',       regex: /^(www\.)?(youtube\.com|youtu\.be)$/i,                    category: 'social' },
];

/** Link-text aliases F95 uses on /dl/ buttons (not always equal to host id). */
const TEXT_ALIASES: Record<string, string> = {
  pixeldrain: 'pixeldrain',
  mega: 'mega',
  mediafire: 'mediafire',
  mixdrop: 'mixdrop',
  gofile: 'gofile',
  workupload: 'workupload',
  anonfiles: 'anonfiles',
  datanodes: 'datanodes',
  buzzheavier: 'buzzheavier',
  bzzhr: 'buzzheavier',
  racaty: 'racaty',
  uploadhaven: 'uploadhaven',
  zippyshare: 'zippyshare',
  k2s: 'k2s',
  rapidgator: 'rapidgator',
  turbobit: 'turbobit',
  nopy: 'nopy',
  sendspace: 'sendspace',
  '1fichier': '1fichier',
  bunkr: 'bunkr',
  cyberfile: 'cyberfile',
  cyberdrop: 'cyberdrop',
  dropbox: 'dropbox',
  gdrive: 'gdrive',
  'google drive': 'gdrive',
  googledrive: 'gdrive',
  pcloud: 'pcloud',
  akirabox: 'akirabox',
  vikingfile: 'vikingfile',
};

function hostFromHostname(hostname: string): HostInfo | null {
  const m = PATTERNS.find((p) => p.regex.test(hostname));
  return m ? { host: m.host, category: m.category } : null;
}

function hostFromLinkText(text: string | null | undefined): HostInfo | null {
  if (!text) return null;
  const key = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const alias = TEXT_ALIASES[key] ?? TEXT_ALIASES[key.replace(/[^a-z0-9]/g, '')];
  if (!alias) return null;
  return { host: alias, category: 'direct' };
}

function hostFromFaviconStyle(style: string | null | undefined): HostInfo | null {
  if (!style) return null;
  const m = style.match(/ip3\/([^/"')\s]+)\.ico/i);
  if (!m) return null;
  return hostFromHostname(m[1]);
}

/**
 * Classify a URL by inspecting its hostname. F95Zone wraps download links in
 * redirectors:
 * - legacy `/masked/<host>/<thread>/<key>` — host is in the path
 * - current `/dl/<id>/?…` — host is only in link text / favicon style hints
 */
export function classifyHost(
  rawUrl: string,
  hints?: ClassifyHostHints,
): HostInfo | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase();
  if (host === 'f95zone.to') {
    if (u.pathname.startsWith('/masked/')) {
      const segs = u.pathname.split('/').filter(Boolean);
      if (segs.length >= 2) {
        const rawHost = segs[1];
        const match = PATTERNS.find((p) => p.regex.test(rawHost));
        if (match) return { host: match.host, category: match.category };
        // Unknown but clearly a download intent (F95 only masks downloads).
        return { host: rawHost.toLowerCase(), category: 'direct' };
      }
    }

    if (/^\/dl\/\d+/i.test(u.pathname)) {
      return (
        hostFromFaviconStyle(hints?.style) ??
        hostFromLinkText(hints?.text) ??
        { host: 'f95-dl', category: 'direct' }
      );
    }
  }

  return hostFromHostname(u.hostname);
}

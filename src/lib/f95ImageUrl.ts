/** Hosts that serve F95 attachment binaries (full-resolution). */
const ATTACHMENTS_HOST = 'attachments.f95zone.to';
/** SAM/list CDN — same path, intentionally downscaled previews. */
const PREVIEW_HOST = 'preview.f95zone.to';

function rewriteHost(url: string, fromHost: string, toHost: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() === fromHost) {
      u.hostname = toHost;
      return u.toString();
    }
  } catch {
    /* keep */
  }
  return url;
}

/** Full-resolution attachment URL (strip `/thumb/`, preview CDN → attachments). */
export function toF95FullUrl(url: string): string {
  const noThumb = url.replace(/\/thumb\/(?=[^/]+$)/, '/');
  return rewriteHost(noThumb, PREVIEW_HOST, ATTACHMENTS_HOST);
}

export function isF95AttachmentUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === ATTACHMENTS_HOST ||
      host === PREVIEW_HOST ||
      host.includes('f95zone') ||
      host.includes('attachments')
    );
  } catch {
    return false;
  }
}

/**
 * Lightweight preview. Prefer the preview CDN (what SAM already uses);
 * fall back to inserting `/thumb/` on attachment hosts.
 */
export function toF95ThumbUrl(full: string): string {
  if (!full) return full;
  const normalized = toF95FullUrl(full);
  const viaPreview = rewriteHost(normalized, ATTACHMENTS_HOST, PREVIEW_HOST);
  if (viaPreview !== normalized) return viaPreview;

  if (normalized.includes('/thumb/') || !isF95AttachmentUrl(normalized)) {
    return normalized;
  }
  try {
    const u = new URL(normalized);
    const slash = u.pathname.lastIndexOf('/');
    if (slash <= 0) return normalized;
    u.pathname = `${u.pathname.slice(0, slash)}/thumb${u.pathname.slice(slash)}`;
    return u.toString();
  } catch {
    return normalized;
  }
}

/** URL to show immediately while a cached preview is not ready yet. */
export function instantPreviewUrl(full: string): string | null {
  if (isF95AttachmentUrl(full)) return toF95ThumbUrl(full);
  return null;
}

export type StoreImageQuality = 'full' | 'thumb';

type StoreImageSource = {
  thumbnailUrl: string | null;
  screens?: readonly string[];
};

/**
 * Store UI image picker.
 * - full: prefer first screenshot, else cover — attachments host (not preview CDN).
 * - thumb: SAM cover as-is when present (already on preview CDN); else preview of screen.
 */
export function storeGameImageUrl(
  game: StoreImageSource,
  quality: StoreImageQuality,
): string | null {
  if (quality === 'full') {
    const raw = game.screens?.[0] || game.thumbnailUrl;
    return raw ? toF95FullUrl(raw) : null;
  }
  if (game.thumbnailUrl) {
    // Covers from SAM are already preview.* — keep them (don't invent /thumb/).
    return game.thumbnailUrl;
  }
  const screen = game.screens?.[0];
  return screen ? toF95ThumbUrl(screen) : null;
}

/** Cover as-is + screens as preview thumbs for compact rail hover carousels. */
export function storeGameThumbUrls(game: StoreImageSource): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (url: string | null | undefined) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  push(game.thumbnailUrl);
  for (const s of game.screens ?? []) {
    push(toF95ThumbUrl(s));
  }
  return out;
}

/** Cover + screens at attachment full resolution (spotlight / large tiles). */
export function storeGameFullUrls(game: StoreImageSource): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (url: string | null | undefined) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  if (game.thumbnailUrl) push(toF95FullUrl(game.thumbnailUrl));
  for (const s of game.screens ?? []) {
    push(toF95FullUrl(s));
  }
  return out;
}

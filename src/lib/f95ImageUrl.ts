/** Remove `/thumb/` imediatamente antes do nome do arquivo (URL em resolução cheia). */
export function toF95FullUrl(url: string): string {
  return url.replace(/\/thumb\/(?=[^/]+$)/, '/');
}

export function isF95AttachmentUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes('f95zone') || host.includes('attachments');
  } catch {
    return false;
  }
}

/** Pré-visualização F95 (leve). Só aplica em anexos do fórum. */
export function toF95ThumbUrl(full: string): string {
  if (!full || full.includes('/thumb/') || !isF95AttachmentUrl(full)) return full;
  try {
    const u = new URL(full);
    const slash = u.pathname.lastIndexOf('/');
    if (slash <= 0) return full;
    u.pathname = `${u.pathname.slice(0, slash)}/thumb${u.pathname.slice(slash)}`;
    return u.toString();
  } catch {
    return full;
  }
}

/** URL para mostrar imediatamente enquanto o preview em cache não fica pronto. */
export function instantPreviewUrl(full: string): string | null {
  if (isF95AttachmentUrl(full)) return toF95ThumbUrl(full);
  return null;
}

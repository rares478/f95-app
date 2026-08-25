/** True only for https attachment URLs on trusted F95 hosts/paths. */
export function isAllowedAttachmentUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (host === 'attachments.f95zone.to') return true;
  if (host === 'f95zone.to') {
    return (
      parsed.pathname === '/attachments' ||
      parsed.pathname.startsWith('/attachments/')
    );
  }
  return false;
}

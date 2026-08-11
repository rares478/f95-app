import type { SocialLink } from '../types/game';

export const KNOWN_SOCIAL_HOSTS = [
  'patreon',
  'discord',
  'itch',
  'twitter',
  'ko-fi',
  'youtube',
  'subscribestar',
] as const;

export type KnownSocialHost = (typeof KNOWN_SOCIAL_HOSTS)[number];

const HOST_LABELS: Record<KnownSocialHost, string> = {
  patreon: 'Patreon',
  discord: 'Discord',
  itch: 'itch.io',
  twitter: 'X',
  'ko-fi': 'Ko-fi',
  youtube: 'YouTube',
  subscribestar: 'SubscribeStar',
};

export function dedupeSocialLinks(links: SocialLink[]): SocialLink[] {
  const seen = new Set<string>();
  const out: SocialLink[] = [];
  for (const link of links) {
    const key = link.url.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

export function socialLinkLabel(link: SocialLink): string {
  const host = link.host.trim().toLowerCase();
  const hostLabel =
    (HOST_LABELS as Record<string, string>)[host] ?? (host || 'Link');
  const text = link.text?.trim() ?? '';
  if (!text) return hostLabel;
  if (text.toLowerCase() === hostLabel.toLowerCase()) return hostLabel;
  if (text.toLowerCase() === host) return hostLabel;
  return text;
}

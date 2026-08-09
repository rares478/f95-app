import { describe, expect, it } from 'vitest';
import {
  KNOWN_SOCIAL_HOSTS,
  dedupeSocialLinks,
  socialLinkLabel,
} from './socialLinks';
import type { SocialLink } from '../types/game';

function link(partial: Partial<SocialLink> & Pick<SocialLink, 'url' | 'host'>): SocialLink {
  return { text: '', ...partial };
}

describe('dedupeSocialLinks', () => {
  it('keeps first occurrence per URL', () => {
    const out = dedupeSocialLinks([
      link({ host: 'patreon', url: 'https://patreon.com/a', text: 'Patreon' }),
      link({ host: 'patreon', url: 'https://patreon.com/a', text: 'dup' }),
      link({ host: 'discord', url: 'https://discord.gg/x', text: 'Discord' }),
    ]);
    expect(out).toEqual([
      link({ host: 'patreon', url: 'https://patreon.com/a', text: 'Patreon' }),
      link({ host: 'discord', url: 'https://discord.gg/x', text: 'Discord' }),
    ]);
  });
});

describe('socialLinkLabel', () => {
  it('capitalizes known host names', () => {
    expect(socialLinkLabel(link({ host: 'discord', url: 'https://discord.gg/x' }))).toBe(
      'Discord',
    );
    expect(socialLinkLabel(link({ host: 'ko-fi', url: 'https://ko-fi.com/x' }))).toBe('Ko-fi');
    expect(socialLinkLabel(link({ host: 'itch', url: 'https://dev.itch.io' }))).toBe('itch.io');
    expect(socialLinkLabel(link({ host: 'twitter', url: 'https://x.com/x' }))).toBe('X');
  });

  it('uses trimmed text when it adds info beyond the host label', () => {
    expect(
      socialLinkLabel(
        link({ host: 'patreon', url: 'https://patreon.com/a', text: 'Support on Patreon' }),
      ),
    ).toBe('Support on Patreon');
  });

  it('falls back to host for unknown hosts', () => {
    expect(socialLinkLabel(link({ host: 'weird', url: 'https://example.com' }))).toBe('weird');
  });
});

describe('KNOWN_SOCIAL_HOSTS', () => {
  it('lists every host that must have a dedicated icon', () => {
    expect([...KNOWN_SOCIAL_HOSTS].sort()).toEqual(
      ['discord', 'itch', 'ko-fi', 'patreon', 'subscribestar', 'twitter', 'youtube'].sort(),
    );
  });
});

import { KNOWN_SOCIAL_ICON_HOSTS } from '../components/game/socialIcons';

describe('social icon coverage', () => {
  it('provides an icon entry for every known social host', () => {
    expect([...KNOWN_SOCIAL_ICON_HOSTS].sort()).toEqual([...KNOWN_SOCIAL_HOSTS].sort());
  });
});

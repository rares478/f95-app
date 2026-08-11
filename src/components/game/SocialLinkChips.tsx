import { openUrl } from '@tauri-apps/plugin-opener';
import type { SocialLink } from '../../types/game';
import { dedupeSocialLinks, socialLinkLabel } from '../../lib/socialLinks';
import { SocialHostIcon } from './socialIcons';
import '../../styles/social-link-chips.css';

export function SocialLinkChips({ links }: { links: SocialLink[] }) {
  const items = dedupeSocialLinks(links);
  if (items.length === 0) return null;

  return (
    <span className="social-link-chips">
      {items.map((link) => {
        const label = socialLinkLabel(link);
        return (
          <button
            key={link.url}
            type="button"
            className="social-link-chip"
            title={label}
            aria-label={label}
            onClick={() => void openUrl(link.url)}
          >
            <SocialHostIcon host={link.host} />
          </button>
        );
      })}
    </span>
  );
}

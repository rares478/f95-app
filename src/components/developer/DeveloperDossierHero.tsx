import { SocialLinkChips } from '../game/SocialLinkChips';
import { useT } from '../../lib/i18n';
import type { DeveloperProfileStats } from '../../lib/developerProfileModel';
import type { SocialLink } from '../../types/game';

type Props = {
  developerName: string;
  stats: DeveloperProfileStats | null;
  socialLinks: SocialLink[];
  heroBannerUrl: string | null;
  onBack: () => void;
};

export function DeveloperDossierHero({
  developerName,
  stats,
  socialLinks,
  heroBannerUrl,
  onBack,
}: Props) {  const { t } = useT();

  return (
    <header className="developer-dossier-hero">
      <button type="button" className="developer-dossier-back" onClick={onBack}>
        {t('common.back')}
      </button>

      <div className="developer-dossier-hero-inner">
        <div className="developer-dossier-hero-copy">
          <p className="developer-dossier-kicker">{t('developer.kicker')}</p>
          <h1 className="developer-dossier-name">{developerName || '—'}</h1>
          {socialLinks.length > 0 && (
            <div className="developer-dossier-social">
              <SocialLinkChips links={socialLinks} />
            </div>
          )}

          {stats && stats.gameCount > 0 && (
            <dl className="developer-dossier-stats">
              <div className="developer-dossier-stat">
                <dt>{t('developer.stats.games')}</dt>
                <dd>{stats.gameCount}</dd>
              </div>
              {stats.avgRating != null && (
                <div className="developer-dossier-stat">
                  <dt>{t('developer.stats.rating')}</dt>
                  <dd>★ {stats.avgRating.toFixed(1)}</dd>
                </div>
              )}
              {stats.latestDateLabel && (
                <div className="developer-dossier-stat">
                  <dt>{t('developer.stats.latest')}</dt>
                  <dd>{stats.latestDateLabel}</dd>
                </div>
              )}
              {stats.inLibraryCount > 0 && (
                <div className="developer-dossier-stat">
                  <dt>{t('developer.stats.inLibrary')}</dt>
                  <dd>{stats.inLibraryCount}</dd>
                </div>
              )}
            </dl>
          )}

          {stats && stats.enginePrefixes.length > 0 && (
            <div className="developer-dossier-engines" aria-label={t('developer.stats.engines')}>
              {stats.enginePrefixes.map((engine) => (
                <span key={engine} className="developer-dossier-engine">
                  {engine}
                </span>
              ))}
            </div>
          )}
        </div>

        {heroBannerUrl && (
          <div className="developer-dossier-hero-cover">
            <img src={heroBannerUrl} alt="" className="developer-dossier-hero-cover-img" />
            <div className="developer-dossier-hero-cover-shade" aria-hidden />
          </div>
        )}
      </div>
    </header>
  );
}

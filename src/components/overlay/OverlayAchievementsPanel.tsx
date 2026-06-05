import { useEffect, useState } from 'react';
import { useT } from '../../lib/i18n';
import * as achievements from '../../lib/achievements';
import type { AchievementDefinition, AchievementStats } from '../../types/achievements';

interface Props {
  threadId: string;
  enabled: boolean;
}

export function OverlayAchievementsPanel({ threadId, enabled }: Props) {
  const { t } = useT();
  const [defs, setDefs] = useState<AchievementDefinition[]>([]);
  const [stats, setStats] = useState<AchievementStats | null>(null);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void achievements.seedDevAchievements();
    void Promise.all([
      achievements.listForGame(threadId),
      achievements.getStats(threadId),
      achievements.listUnlocksForGame(threadId),
    ]).then(([list, st, unlocks]) => {
      if (cancelled) return;
      setDefs(list);
      setStats(st);
      setUnlockedIds(new Set(unlocks.map((u) => u.achievementId)));
    });
    return () => {
      cancelled = true;
    };
  }, [threadId, enabled]);

  if (!enabled) {
    return (
      <div className="game-overlay-panel--disabled">{t('overlay.achievements.disabled')}</div>
    );
  }

  return (
    <div className="game-overlay-panel-fill game-overlay-panel-fill--scroll">
      {stats && (
        <p className="game-overlay-stats">
          {t('overlay.achievements.stats', {
            unlocked: String(stats.unlocked),
            total: String(stats.total),
          })}{' '}
          · {t('overlay.achievements.points', { points: String(stats.points) })}
        </p>
      )}
      {defs.length === 0 ? (
        <p className="game-overlay-empty">{t('overlay.achievements.empty')}</p>
      ) : (
        <div className="game-overlay-achievements-grid">
          {defs.map((d) => (
            <div
              key={d.id}
              className={`game-overlay-achievement-card${unlockedIds.has(d.id) ? ' game-overlay-achievement-card--unlocked' : ''}`}
            >
              <p className="game-overlay-achievement-title">{d.title}</p>
              {d.description && (
                <p className="game-overlay-achievement-desc">{d.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

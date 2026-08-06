import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { parseSamCategory, SAM_CATEGORIES } from '../../constants/samCategories';
import { useLibraryGameActions } from '../../hooks/useLibraryGameActions';
import { useT } from '../../lib/i18n';
import * as library from '../../lib/library';
import type { LibraryGame } from '../../types/library';
import type { SamCategory } from '../../types/sam';

/**
 * Steam-library-style left panel: a search box on top and the game list
 * below (alphabetical), one compact row per game — installed games read
 * brighter and the routed game gets the accent slab, like Steam.
 * Self-sufficient: loads its own list so it can stay visible across the
 * library home AND game detail routes (mounted by LibraryLayout when the
 * Steam skin is active). The list follows the category tabs (`?cat=` on
 * /library); the search filters the panel only, mirroring Steam.
 */
export function SteamLibrarySidebar() {
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const detailMatch = useMatch('/library/game/:threadId');
  const activeThreadId = detailMatch?.params.threadId ?? null;

  // Follow the category tabs. On detail routes the param can be absent
  // (game opened from the grid), so keep the last known category instead
  // of snapping back to Games.
  const isHome = detailMatch === null;
  const catParam = new URLSearchParams(location.search).get('cat');
  const [category, setCategory] = useState<SamCategory>(() => parseSamCategory(catParam));

  useEffect(() => {
    if (isHome || catParam !== null) {
      setCategory(parseSamCategory(catParam));
    }
  }, [isHome, catParam]);

  const [games, setGames] = useState<LibraryGame[]>([]);
  const [search, setSearch] = useState('');

  const reload = useCallback(async () => {
    try {
      setGames(await library.list({ category }));
    } catch {
      // Best-effort: the main pages already surface library errors.
    }
  }, [category]);

  // Refresh on category switches and on every route change inside the
  // library, so installs/removals done from a detail page show up.
  useEffect(() => {
    void reload();
  }, [reload, location.pathname]);

  const { openLibraryContextMenu } = useLibraryGameActions({ onReload: reload });

  const visible = useMemo(() => {
    const sorted = [...games].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    );
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((g) => g.title.toLowerCase().includes(q));
  }, [games, search]);

  // Head shows the active category (same labels as the tabs).
  const categoryMeta = SAM_CATEGORIES.find((c) => c.id === category);
  const categoryLabel =
    categoryMeta?.literal ?? (categoryMeta?.labelKey ? t(categoryMeta.labelKey) : category);

  return (
    <aside className="steam-library-sidebar">
      <div className="steam-library-search-wrap">
        <span className="steam-library-search-icon" aria-hidden>
          ⌕
        </span>
        <input
          type="search"
          className="steam-library-search"
          placeholder={t('library.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="steam-library-side-head">
        {categoryLabel} ({visible.length})
      </div>

      <ul className="steam-library-list">
        {visible.map((g) => {
          const isActive = String(g.threadId) === activeThreadId;
          const installed = g.installStatus === 'installed';
          return (
            <li key={g.threadId}>
              <button
                type="button"
                className={`steam-library-row${installed ? ' steam-library-row--installed' : ''}${
                  isActive ? ' steam-library-row--active' : ''
                }`}
                onClick={() =>
                  navigate(
                    // Carry the category so the panel keeps its context on
                    // the detail route (games = default, no param — same
                    // convention as LibraryPage).
                    `/library/game/${g.threadId}${category !== 'games' ? `?cat=${category}` : ''}`,
                  )
                }
                onContextMenu={(e) => openLibraryContextMenu(e, g)}
                title={g.title}
              >
                {g.thumbnailUrl ? (
                  <img
                    src={g.thumbnailUrl}
                    alt=""
                    className="steam-library-row-thumb"
                    loading="lazy"
                  />
                ) : (
                  <span className="steam-library-row-thumb steam-library-row-thumb--empty" />
                )}
                <span className="steam-library-row-title">{g.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

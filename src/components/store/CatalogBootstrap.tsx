import { useEffect } from 'react';
import * as ipc from '../../lib/ipc';
import { usePrefixCatalog } from '../../contexts/PrefixCatalogContext';
import { useTagCatalog } from '../../contexts/TagCatalogContext';
import { fallbackPrefixGroupsForCategory } from '../../lib/fallbackPrefixGroups';
import { loadStoredPrefixGroups, sanitizePrefixGroups } from '../../lib/prefixCatalogStorage';

/** Loads F95 prefix/tag catalogs once per session (persists to localStorage). */
export function CatalogBootstrap() {
  const { setFromGroups } = usePrefixCatalog();
  const { setFromRecord } = useTagCatalog();

  useEffect(() => {
    let cancelled = false;
    ipc
      .samOptions('games')
      .then((result) => {
        if (cancelled) return;
        const stored = loadStoredPrefixGroups();
        const groups =
          result.prefixGroups.length > 0
            ? sanitizePrefixGroups(result.prefixGroups)
            : stored.length > 0
              ? stored
              : fallbackPrefixGroupsForCategory('games');
        if (groups.length > 0) {
          setFromGroups(groups);
        }
        setFromRecord(result.tagCatalog);
      })
      .catch((err) => console.warn('[catalog] bootstrap failed', err));
    return () => {
      cancelled = true;
    };
  }, [setFromGroups, setFromRecord]);

  return null;
}

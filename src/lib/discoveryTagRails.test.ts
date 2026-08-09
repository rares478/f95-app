import { describe, expect, it } from 'vitest';
import { TAG_RAIL_COUNT } from './discoveryConfig';
import { localDayKey, pickTagRailsForDay } from './discoveryTagRails';
import { bundledTagCatalog } from './tagCatalog';

describe('localDayKey', () => {
  it('formats local YYYY-MM-DD', () => {
    const d = new Date(2026, 7, 9, 15, 0, 0); // Aug 9 local
    expect(localDayKey(d.getTime())).toBe('2026-08-09');
  });
});

describe('pickTagRailsForDay', () => {
  const catalog = bundledTagCatalog();

  it('returns up to TAG_RAIL_COUNT resolvable rails', () => {
    const rails = pickTagRailsForDay({ catalog, dayKey: '2026-08-09' });
    expect(rails.length).toBeLessThanOrEqual(TAG_RAIL_COUNT);
    expect(rails.length).toBeGreaterThan(0);
    expect(new Set(rails.map((r) => r.tag.id)).size).toBe(rails.length);
  });

  it('is stable for the same dayKey', () => {
    const a = pickTagRailsForDay({ catalog, dayKey: '2026-08-09' });
    const b = pickTagRailsForDay({ catalog, dayKey: '2026-08-09' });
    expect(a.map((r) => r.tag.id)).toEqual(b.map((r) => r.tag.id));
  });

  it('differs across known dayKeys with bundled catalog', () => {
    const a = pickTagRailsForDay({ catalog, dayKey: '2026-08-09' });
    const b = pickTagRailsForDay({ catalog, dayKey: '2026-08-10' });
    expect(a.map((r) => r.tag.id)).not.toEqual(b.map((r) => r.tag.id));
  });

  it('skips unresolved names', () => {
    const rails = pickTagRailsForDay({
      catalog,
      dayKey: 'seed',
      pool: ['NotARealTagXYZ', 'Fantasy'],
      count: 3,
    });
    expect(rails).toHaveLength(1);
    expect(rails[0]!.tag.name.toLowerCase()).toBe('fantasy');
  });

  it('returns empty when nothing resolves', () => {
    expect(
      pickTagRailsForDay({
        catalog: new Map(),
        dayKey: '2026-08-09',
        pool: ['Fantasy'],
      }),
    ).toEqual([]);
  });
});

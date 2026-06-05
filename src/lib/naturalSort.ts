/**
 * Natural / alphanumeric sort so `2.png` comes before `10.png`.
 */
export function naturalCompare(a: string, b: string): number {
  const tokenize = (s: string) => s.match(/(\d+|\D+)/g) ?? [s];
  const ap = tokenize(a);
  const bp = tokenize(b);
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const ac = ap[i] ?? '';
    const bc = bp[i] ?? '';
    const an = /^\d+$/.test(ac);
    const bn = /^\d+$/.test(bc);
    if (an && bn) {
      const av = ac.length - bc.length;
      if (av !== 0) return av;
      const c = ac.localeCompare(bc, undefined, { numeric: true });
      if (c !== 0) return c;
    } else {
      const c = ac.localeCompare(bc, undefined, { sensitivity: 'base' });
      if (c !== 0) return c;
    }
  }
  return 0;
}

export function naturalSortBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => naturalCompare(key(a), key(b)));
}

export function sortPaths(paths: string[]): string[] {
  return naturalSortBy(paths, (p) => p.replace(/\\/g, '/'));
}

import type { GameDownload } from '../types/game';

export function groupDownloads(items: GameDownload[]): [string | null, GameDownload[]][] {
  const map = new Map<string | null, GameDownload[]>();
  const order: (string | null)[] = [];
  for (const item of items) {
    const key = item.group?.trim() || null;
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)!.push(item);
  }
  return order.map((key) => [key, map.get(key)!]);
}

import { execute, query } from './db';
import type { SamGameCard } from '../types/sam';

export type DiscoveryPoolKey = string;

export interface DiscoveryPoolRecord {
  key: string;
  items: SamGameCard[];
  fetchedAt: number;
}

interface DbRow {
  key: string;
  payload: string;
  fetched_at: number;
}

function parseRow(row: DbRow): DiscoveryPoolRecord {
  let items: SamGameCard[] = [];
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    items = Array.isArray(parsed) ? (parsed as SamGameCard[]) : [];
  } catch {
    items = [];
  }
  return { key: row.key, items, fetchedAt: Number(row.fetched_at) || 0 };
}

export async function getPool(key: string): Promise<DiscoveryPoolRecord | null> {
  const rows = await query<DbRow>(
    `SELECT key, payload, fetched_at FROM discovery_pools WHERE key = ? LIMIT 1`,
    [key],
  );
  const row = rows[0];
  return row ? parseRow(row) : null;
}

export async function getPools(keys: string[]): Promise<Map<string, DiscoveryPoolRecord>> {
  const map = new Map<string, DiscoveryPoolRecord>();
  if (keys.length === 0) return map;
  const placeholders = keys.map(() => '?').join(',');
  const rows = await query<DbRow>(
    `SELECT key, payload, fetched_at FROM discovery_pools WHERE key IN (${placeholders})`,
    keys,
  );
  for (const row of rows) map.set(row.key, parseRow(row));
  return map;
}

export async function upsertPool(
  key: string,
  items: SamGameCard[],
  fetchedAt: number,
): Promise<void> {
  await execute(
    `INSERT INTO discovery_pools (key, payload, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at`,
    [key, JSON.stringify(items), fetchedAt],
  );
}

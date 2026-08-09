import { TAG_SAMPLE_ROTATE_MS } from './discoveryConfig';

export function tagSampleWindowIndex(nowMs = Date.now()): number {
  return Math.floor(nowMs / TAG_SAMPLE_ROTATE_MS);
}

export function tagSampleSeed(dayKey: string, nowMs = Date.now()): string {
  return `${dayKey}:tag:${tagSampleWindowIndex(nowMs)}`;
}

export function msUntilNextTagSampleWindow(nowMs = Date.now()): number {
  const idx = tagSampleWindowIndex(nowMs);
  const nextAt = (idx + 1) * TAG_SAMPLE_ROTATE_MS;
  return Math.max(1, nextAt - nowMs);
}

export const SPEED_WINDOW_MS = 2_000;
export const SPEED_SAMPLE_MS = 2_000;
export const SPEED_HISTORY_LEN = 60;

export interface ByteSample {
  t: number;
  bytes: number;
}

export interface GraphHistory {
  download: number[];
  extract: number[];
}

export const EMPTY_GRAPH_HISTORY: GraphHistory = { download: [], extract: [] };

/** Keep samples inside the averaging window (plus a small overlap). */
export function pushByteSample(
  samples: ByteSample[],
  sample: ByteSample,
  windowMs = SPEED_WINDOW_MS,
): ByteSample[] {
  const next = [...samples, sample];
  const cutoff = sample.t - windowMs;
  let start = 0;
  while (start < next.length - 1 && next[start]!.t < cutoff) start += 1;
  return start === 0 ? next : next.slice(start);
}

/** Average bytes/sec over the samples that fall in `windowMs`. */
export function averageSpeedBps(
  samples: readonly ByteSample[],
  now: number,
  windowMs = SPEED_WINDOW_MS,
): number {
  if (samples.length < 2) return 0;
  const cutoff = now - windowMs;
  let firstIdx = 0;
  while (firstIdx < samples.length - 1 && samples[firstIdx]!.t < cutoff) firstIdx += 1;
  if (firstIdx > 0) firstIdx -= 1;
  const first = samples[firstIdx]!;
  const last = samples[samples.length - 1]!;
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return 0;
  const delta = last.bytes - first.bytes;
  if (delta <= 0) return 0;
  return delta / dt;
}

export function sumSpeeds(speeds: Iterable<number>): number {
  let total = 0;
  for (const n of speeds) {
    if (n > 0) total += n;
  }
  return total;
}

export function pushSpeedHistory(
  history: readonly number[],
  sampleBps: number,
  maxLen = SPEED_HISTORY_LEN,
): number[] {
  const next = [...history, Math.max(0, sampleBps)];
  return next.length > maxLen ? next.slice(next.length - maxLen) : next;
}

export function pushGraphHistory(
  history: GraphHistory,
  downloadBps: number,
  extractBps: number,
  maxLen = SPEED_HISTORY_LEN,
): GraphHistory {
  const idle =
    downloadBps <= 0 &&
    extractBps <= 0 &&
    history.download.length === 0 &&
    history.extract.length === 0;
  if (idle) return history;
  const bothZero =
    downloadBps <= 0 &&
    extractBps <= 0 &&
    history.download.every((n) => n === 0) &&
    history.extract.every((n) => n === 0);
  if (bothZero) return history;
  return {
    download: pushSpeedHistory(history.download, downloadBps, maxLen),
    extract: pushSpeedHistory(history.extract, extractBps, maxLen),
  };
}

export function speedHistoryMax(history: readonly number[]): number {
  let max = 0;
  for (const n of history) {
    if (n > max) max = n;
  }
  return max;
}

export function padHistory(history: readonly number[], len = SPEED_HISTORY_LEN): number[] {
  if (history.length >= len) return [...history];
  return [...Array(len - history.length).fill(0), ...history];
}

/** SVG polyline points for a 0..W by 0..H chart (y grows downward). */
export function speedHistoryPolyline(
  history: readonly number[],
  width: number,
  height: number,
  maxBps: number,
): string {
  if (history.length === 0 || width <= 0 || height <= 0) return '';
  const peak = Math.max(maxBps, 1);
  const last = history.length - 1;
  return history
    .map((bps, i) => {
      const x = last === 0 ? width : (i / last) * width;
      const y = height - (Math.max(0, bps) / peak) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

/** Nice round Y ticks for a speed axis (bytes/sec). */
export function speedAxisTicks(maxBps: number, count = 3): number[] {
  const peak = Math.max(maxBps, 1);
  const raw = peak / count;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 2.5, 5, 10].find((n) => n * exp >= raw) ?? 10;
  const step = nice * exp;
  const ticks: number[] = [];
  for (let v = step; v < peak * 0.98; v += step) ticks.push(v);
  if (ticks.length === 0) ticks.push(step);
  return ticks;
}

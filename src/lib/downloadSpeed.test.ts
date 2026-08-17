import { describe, expect, it } from 'vitest';
import {
  averageSpeedBps,
  EMPTY_GRAPH_HISTORY,
  padHistory,
  pushByteSample,
  pushGraphHistory,
  pushSpeedHistory,
  speedAxisTicks,
  speedHistoryMax,
  speedHistoryPolyline,
  SPEED_HISTORY_LEN,
  SPEED_WINDOW_MS,
} from './downloadSpeed';

describe('averageSpeedBps', () => {
  it('averages bytes over a 2s window instead of last tick', () => {
    const samples = [
      { t: 0, bytes: 0 },
      { t: 1000, bytes: 50 * 1024 * 1024 },
      { t: 2000, bytes: 70 * 1024 * 1024 },
    ];
    const bps = averageSpeedBps(samples, 2000);
    expect(bps).toBeCloseTo((70 * 1024 * 1024) / 2, 5);
  });

  it('returns 0 with fewer than two samples', () => {
    expect(averageSpeedBps([{ t: 0, bytes: 10 }], 1000)).toBe(0);
  });
});

describe('pushByteSample', () => {
  it('drops samples older than the window', () => {
    const kept = pushByteSample(
      [
        { t: 0, bytes: 0 },
        { t: 500, bytes: 10 },
      ],
      { t: SPEED_WINDOW_MS + 800, bytes: 40 },
    );
    expect(kept[0]?.t).toBeGreaterThanOrEqual(800);
  });
});

describe('pushSpeedHistory', () => {
  it('caps history length', () => {
    let hist: number[] = [];
    for (let i = 0; i < SPEED_HISTORY_LEN + 5; i++) {
      hist = pushSpeedHistory(hist, i);
    }
    expect(hist).toHaveLength(SPEED_HISTORY_LEN);
    expect(hist[0]).toBe(5);
  });
});

describe('pushGraphHistory', () => {
  it('keeps download and extract series aligned', () => {
    const next = pushGraphHistory(EMPTY_GRAPH_HISTORY, 100, 40);
    expect(next.download).toEqual([100]);
    expect(next.extract).toEqual([40]);
  });
});

describe('speedHistoryPolyline', () => {
  it('maps peak speed to the top of the chart', () => {
    const hist = [0, 100, 50];
    const points = speedHistoryPolyline(hist, 100, 40, speedHistoryMax(hist));
    expect(points).toContain('0.00,40.00');
    expect(points).toContain('50.00,0.00');
  });
});

describe('speedAxisTicks', () => {
  it('returns round values below the peak', () => {
    const ticks = speedAxisTicks(50 * 1024 * 1024);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((n) => n > 0 && n < 50 * 1024 * 1024)).toBe(true);
  });
});

describe('padHistory', () => {
  it('left-pads with zeros', () => {
    expect(padHistory([1, 2], 4)).toEqual([0, 0, 1, 2]);
  });
});

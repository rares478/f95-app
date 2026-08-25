import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollLeftForCard, scrollRailByPage, snapRailToNearestCard } from './scrollRailPage';

function mockTrack(opts: {
  scrollLeft: number;
  clientWidth: number;
  paddingLeft?: number;
  paddingRight?: number;
  cardWidths: number[];
  gap?: number;
}) {
  const padL = opts.paddingLeft ?? 40;
  const padR = opts.paddingRight ?? 40;
  const gap = opts.gap ?? 12;
  let x = padL;
  const cards = opts.cardWidths.map((w) => {
    const el = {
      offsetLeft: x,
      offsetWidth: w,
    } as HTMLElement;
    x += w + gap;
    return el;
  });
  const contentEnd = x - gap + padR;
  const track = {
    scrollLeft: opts.scrollLeft,
    clientWidth: opts.clientWidth,
    scrollWidth: Math.max(contentEnd, opts.clientWidth),
    children: cards,
    scrollTo: vi.fn(),
  } as unknown as HTMLElement;

  vi.stubGlobal(
    'getComputedStyle',
    () =>
      ({
        paddingLeft: `${padL}px`,
        paddingRight: `${padR}px`,
      }) as CSSStyleDeclaration,
  );

  return { track, cards, padL };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scrollLeftForCard', () => {
  it('aligns card flush inside left padding', () => {
    const { track, cards, padL } = mockTrack({
      scrollLeft: 0,
      clientWidth: 500,
      cardWidths: [200, 200, 200, 200],
    });
    expect(scrollLeftForCard(track, cards[1]!)).toBe(cards[1]!.offsetLeft - padL);
  });
});

describe('scrollRailByPage', () => {
  it('next scrolls the right-peek card flush left', () => {
    const { track, cards } = mockTrack({
      scrollLeft: 0,
      clientWidth: 716,
      cardWidths: [200, 200, 200, 200, 200, 200, 200, 200],
    });
    scrollRailByPage(track, 1);
    expect(track.scrollTo).toHaveBeenCalledWith({
      left: cards[3]!.offsetLeft - 40,
      behavior: 'smooth',
    });
  });

  it('next from a mid-card scroll clears the left peek', () => {
    const { track, cards } = mockTrack({
      scrollLeft: 100,
      clientWidth: 716,
      cardWidths: [200, 200, 200, 200, 200, 200, 200, 200],
    });
    scrollRailByPage(track, 1);
    expect(track.scrollTo).toHaveBeenCalledWith({
      left: cards[3]!.offsetLeft - 40,
      behavior: 'smooth',
    });
  });

  it('prev steps back about one page onto a card edge', () => {
    const scrollLeft = 3 * (200 + 12);
    const { track, cards } = mockTrack({
      scrollLeft,
      clientWidth: 716,
      cardWidths: [200, 200, 200, 200, 200, 200, 200, 200],
    });
    scrollRailByPage(track, -1);
    expect(track.scrollTo).toHaveBeenCalledWith({
      left: cards[0]!.offsetLeft - 40,
      behavior: 'smooth',
    });
  });
});

describe('snapRailToNearestCard', () => {
  it('snaps mid-card scroll to the nearer card', () => {
    const { track, cards } = mockTrack({
      scrollLeft: 80,
      clientWidth: 716,
      cardWidths: [200, 200, 200],
    });
    snapRailToNearestCard(track);
    expect(track.scrollTo).toHaveBeenCalledWith({
      left: cards[0]!.offsetLeft - 40,
      behavior: 'smooth',
    });
  });

  it('no-ops when already aligned', () => {
    const { track } = mockTrack({
      scrollLeft: 0,
      clientWidth: 716,
      cardWidths: [200, 200, 200],
    });
    snapRailToNearestCard(track);
    expect(track.scrollTo).not.toHaveBeenCalled();
  });
});

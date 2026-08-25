/** Card-aligned page scrolling for discovery / popular rails. */

function trackCards(track: HTMLElement): HTMLElement[] {
  return Array.from(track.children).filter(
    (n): n is HTMLElement =>
      typeof (n as HTMLElement).offsetLeft === 'number' &&
      typeof (n as HTMLElement).offsetWidth === 'number',
  );
}

function trackPads(track: HTMLElement): { padL: number; padR: number } {
  const style = getComputedStyle(track);
  return {
    padL: parseFloat(style.paddingLeft) || 0,
    padR: parseFloat(style.paddingRight) || 0,
  };
}

function clampScrollLeft(track: HTMLElement, left: number): number {
  const max = Math.max(0, track.scrollWidth - track.clientWidth);
  return Math.max(0, Math.min(max, left));
}

/** scrollLeft that aligns `card` flush with the track's content start (inside padding). */
export function scrollLeftForCard(track: HTMLElement, card: HTMLElement): number {
  const { padL } = trackPads(track);
  return clampScrollLeft(track, card.offsetLeft - padL);
}

/**
 * Advance / rewind by roughly one viewport of cards, always landing on a card edge
 * so peeks don't sit under both chevrons at once.
 */
export function scrollRailByPage(track: HTMLElement, dir: -1 | 1): void {
  const cards = trackCards(track);
  if (cards.length === 0) return;

  const { padL, padR } = trackPads(track);
  const viewLeft = track.scrollLeft + padL;
  const viewRight = track.scrollLeft + track.clientWidth - padR;
  const avail = Math.max(track.clientWidth - padL - padR, 1);

  if (dir === 1) {
    let target = cards.find((c) => c.offsetLeft + c.offsetWidth > viewRight + 1);
    if (!target) {
      track.scrollTo({ left: clampScrollLeft(track, track.scrollWidth), behavior: 'smooth' });
      return;
    }
    // Card already flush-left and still overflows → step to the next card.
    if (target.offsetLeft <= viewLeft + 1) {
      const i = cards.indexOf(target);
      target = cards[i + 1] ?? target;
    }
    track.scrollTo({ left: scrollLeftForCard(track, target), behavior: 'smooth' });
    return;
  }

  // Prev: land on the rightmost card that starts at least ~one page before the current left.
  const desired = viewLeft - avail;
  let target = cards[0]!;
  for (const c of cards) {
    if (c.offsetLeft <= desired + 1) target = c;
    else break;
  }
  track.scrollTo({ left: scrollLeftForCard(track, target), behavior: 'smooth' });
}

/** After free scroll (wheel/drag), snap so a card edge lines up with the content start. */
export function snapRailToNearestCard(track: HTMLElement): void {
  const cards = trackCards(track);
  if (cards.length === 0) return;

  const { padL } = trackPads(track);
  const viewLeft = track.scrollLeft + padL;
  let best = cards[0]!;
  let bestDist = Infinity;
  for (const c of cards) {
    const d = Math.abs(c.offsetLeft - viewLeft);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }

  const left = scrollLeftForCard(track, best);
  if (Math.abs(left - track.scrollLeft) > 2) {
    track.scrollTo({ left, behavior: 'smooth' });
  }
}

export const STORE_CARD_HOVER_OPEN_MS = 200;
export const STORE_CARD_SLIDE_MS = 1400;

export function shouldAdvanceStoreCardSlide(opts: {
  hovered: boolean;
  imageCount: number;
  prefersReducedMotion: boolean;
}): boolean {
  return opts.hovered && opts.imageCount > 1 && !opts.prefersReducedMotion;
}

export function nextStoreCardSlide(slide: number, imageCount: number): number {
  if (imageCount <= 0) return 0;
  return (slide + 1) % imageCount;
}

export function storeCardActiveSrc(images: string[], slide: number): string | null {
  if (images.length === 0) return null;
  return images[Math.min(slide, images.length - 1)] ?? null;
}

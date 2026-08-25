import { useEffect, useMemo, useRef, useState } from 'react';
import { storeGameThumbUrls } from '../lib/f95ImageUrl';
import {
  STORE_CARD_HOVER_OPEN_MS,
  STORE_CARD_SLIDE_MS,
  nextStoreCardSlide,
  shouldAdvanceStoreCardSlide,
  storeCardActiveSrc,
} from '../lib/storeCardHoverImages';

export function useStoreCardHoverImages(game: {
  thumbnailUrl: string | null;
  screens: string[];
}) {
  const [hovered, setHovered] = useState(false);
  const [slide, setSlide] = useState(0);
  const openTimerRef = useRef<number | null>(null);

  const images = useMemo(
    () => storeGameThumbUrls(game),
    [game.thumbnailUrl, game.screens],
  );

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (
      !shouldAdvanceStoreCardSlide({
        hovered,
        imageCount: images.length,
        prefersReducedMotion,
      })
    ) {
      setSlide(0);
      return;
    }

    const id = window.setInterval(() => {
      setSlide((i) => nextStoreCardSlide(i, images.length));
    }, STORE_CARD_SLIDE_MS);
    return () => window.clearInterval(id);
  }, [hovered, images.length]);

  useEffect(() => {
    return () => {
      if (openTimerRef.current != null) {
        window.clearTimeout(openTimerRef.current);
      }
    };
  }, []);

  const clearOpenTimer = () => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  const onEnter = () => {
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setHovered(true);
    }, STORE_CARD_HOVER_OPEN_MS);
  };

  const onLeave = () => {
    clearOpenTimer();
    setHovered(false);
    setSlide(0);
  };

  return {
    images,
    hovered,
    slide,
    activeSrc: storeCardActiveSrc(images, slide),
    onEnter,
    onLeave,
  };
}

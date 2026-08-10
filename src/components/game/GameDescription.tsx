import { useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  instantPreviewUrl,
  isF95AttachmentUrl,
  toF95FullUrl,
} from '../../lib/f95ImageUrl';
import { requestGridPreview } from '../../lib/gridPreviewQueue';
import { openF95InAppLink } from '../../lib/openF95InAppLink';
import { useT } from '../../lib/i18n';
import '../../styles/game-description.css';

interface Props {
  html: string;
  className?: string;
  style?: CSSProperties;
}

const VIEW_MARGIN_PX = 200;
const QUOTE_COLLAPSE_PX = 160;

function isNearViewport(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  return rect.bottom >= -VIEW_MARGIN_PX && rect.top <= window.innerHeight + VIEW_MARGIN_PX;
}

/**
 * Descrição: thumb F95 imediato (sem ícone quebrado) → preview ~720px em cache (fila).
 * Also wires expandable XF quotes (normalized to `.x-quote`).
 * Thread/post links open in-app (store vs thread); other links use the system browser.
 */
export function GameDescription({ html, className, style }: Props) {
  const { t } = useT();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const priorityRef = useRef(0);
  const upgradedRef = useRef(new WeakSet<HTMLImageElement>());

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    priorityRef.current = 0;
    upgradedRef.current = new WeakSet();
    const imgs = root.querySelectorAll<HTMLImageElement>('img');
    if (imgs.length === 0) return;

    const prepare = (img: HTMLImageElement) => {
      const raw = img.getAttribute('src') || img.dataset.fullSrc || '';
      const full = toF95FullUrl(raw);
      if (!full) return false;
      img.dataset.fullSrc = full;
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';

      const instant = instantPreviewUrl(full);
      if (instant) {
        img.src = instant;
      } else if (isF95AttachmentUrl(full)) {
        img.removeAttribute('src');
        img.classList.add('game-description-img--pending');
      } else {
        img.src = full;
      }
      return true;
    };

    const upgrade = (img: HTMLImageElement) => {
      if (upgradedRef.current.has(img)) return;
      const full = img.dataset.fullSrc;
      if (!full || !isF95AttachmentUrl(full)) return;
      upgradedRef.current.add(img);

      const priority = Math.min(priorityRef.current, 8);
      priorityRef.current += 1;

      void requestGridPreview(full, priority).then((url) => {
        if (!img.isConnected) return;
        img.src = url;
        img.classList.remove('game-description-img--pending', 'game-description-img--preview');
      });
    };

    const ready: HTMLImageElement[] = [];
    imgs.forEach((img) => {
      if (prepare(img)) ready.push(img);
    });

    if (typeof IntersectionObserver === 'undefined') {
      ready.forEach(upgrade);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          upgrade(entry.target as HTMLImageElement);
          io.unobserve(entry.target);
        }
      },
      { rootMargin: `${VIEW_MARGIN_PX}px 0px` },
    );

    ready.forEach((img) => {
      if (isNearViewport(img)) {
        upgrade(img);
      } else {
        io.observe(img);
      }
    });

    return () => io.disconnect();
  }, [html]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const expandLabel = t('gamedetail.description.expandQuote');
    const collapseLabel = t('gamedetail.description.collapseQuote');
    const cleanups: Array<() => void> = [];

    root.querySelectorAll<HTMLElement>('.x-quote').forEach((quote) => {
      const content = quote.querySelector<HTMLElement>('.x-quote-content');
      const btn = quote.querySelector<HTMLButtonElement>('button.x-quote-expand');
      if (!content || !btn) return;

      quote.classList.remove('x-quote--expanded', 'x-quote--short');
      // Force layout so scrollHeight reflects the clamped box.
      content.style.maxHeight = `${QUOTE_COLLAPSE_PX}px`;
      const needsExpand = content.scrollHeight > QUOTE_COLLAPSE_PX + 8;
      content.style.maxHeight = '';

      if (!needsExpand) {
        quote.classList.add('x-quote--short');
        btn.hidden = true;
        btn.textContent = '';
        return;
      }

      btn.hidden = false;
      btn.textContent = expandLabel;
      const onClick = () => {
        const open = quote.classList.toggle('x-quote--expanded');
        btn.textContent = open ? collapseLabel : expandLabel;
      };
      btn.addEventListener('click', onClick);
      cleanups.push(() => btn.removeEventListener('click', onClick));
    });

    return () => {
      for (const fn of cleanups) fn();
    };
  }, [html, t]);

  const onRootClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (!anchor || !e.currentTarget.contains(anchor)) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    void openF95InAppLink(href, navigate);
  };

  return (
    <div
      ref={rootRef}
      className={className ? `game-description ${className}` : 'game-description'}
      style={style}
      onClick={onRootClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

import { isChangelogHeader } from './isChangelogHeader';
import { unwrapChangelogSpoilers } from './unwrapChangelogSpoilers';
import type { GameChangelogEntry, GameChangelogParseResult } from './types';

type Piece =
  | { kind: 'header'; title: string }
  | { kind: 'html'; html: string };

type ParseState = {
  boldOpen: boolean;
  preambleHtml: string;
  entries: GameChangelogEntry[];
  current: GameChangelogEntry | null;
  pendingBr: boolean;
};

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Drop leading/trailing breaks and whitespace (bodies often end in `<br>\\r\\n`). */
function trimEntryHtml(html: string): string {
  return html
    .replace(/^(?:(?:\s|<br\s*\/?>)+)/i, '')
    .replace(/(?:(?:\s|<br\s*\/?>)+)$/i, '');
}

function displayTitle(text: string): string {
  let t = stripTags(text);
  if (t.endsWith(':')) t = t.slice(0, -1).trimEnd();
  return t;
}

/**
 * Versions often sit after closing spoiler markup on the same <br> segment
 * (e.g. `</details>v2.60`). Peel a trailing header after the last `>`.
 */
function peelTrailingHeader(
  html: string,
  fromBold?: boolean,
): { bodyHtml: string; title: string } | null {
  const lastGt = html.lastIndexOf('>');
  if (lastGt === -1) return null;
  const after = html.slice(lastGt + 1).trim();
  if (!after) return null;
  if (!isChangelogHeader(after, fromBold ? { fromBold: true } : undefined).ok) {
    return null;
  }
  return { bodyHtml: html.slice(0, lastGt + 1), title: displayTitle(after) };
}

function pushHtmlOrTrailingHeader(
  pieces: Piece[],
  html: string,
  fromBold?: boolean,
): void {
  const peeled = peelTrailingHeader(html, fromBold);
  if (peeled) {
    if (peeled.bodyHtml.length > 0) {
      pieces.push({ kind: 'html', html: peeled.bodyHtml });
    }
    pieces.push({ kind: 'header', title: peeled.title });
    return;
  }
  if (html.length > 0) pieces.push({ kind: 'html', html });
}

/**
 * Split one <br>-delimited segment into header / html pieces.
 * Tracks unclosed <b>/<strong> across segments (DeLuca / Harmony multi-line bold).
 */
function splitSegment(
  seg: string,
  boldOpen: boolean,
): { pieces: Piece[]; boldOpen: boolean } {
  const pieces: Piece[] = [];
  let remaining = seg;
  let open = boldOpen;

  while (remaining.length > 0) {
    if (open) {
      const closeMatch = remaining.match(/<\/(b|strong)>/i);
      if (!closeMatch || closeMatch.index === undefined) {
        const text = stripTags(remaining);
        if (text && isChangelogHeader(text, { fromBold: true }).ok) {
          pieces.push({ kind: 'header', title: displayTitle(text) });
        } else {
          pushHtmlOrTrailingHeader(pieces, remaining, true);
        }
        return { pieces, boldOpen: true };
      }

      const beforeClose = remaining.slice(0, closeMatch.index);
      const closeTag = closeMatch[0];
      const afterClose = remaining.slice(closeMatch.index + closeTag.length);
      const text = stripTags(beforeClose);

      if (text && isChangelogHeader(text, { fromBold: true }).ok) {
        pieces.push({ kind: 'header', title: displayTitle(text) });
      } else {
        // beforeClose may end with `</details>v1.90` before the bold close
        const peeled = peelTrailingHeader(beforeClose, true);
        if (peeled) {
          if (peeled.bodyHtml.length > 0) {
            pieces.push({ kind: 'html', html: peeled.bodyHtml + closeTag });
          } else {
            pieces.push({ kind: 'html', html: closeTag });
          }
          pieces.push({ kind: 'header', title: peeled.title });
        } else {
          pieces.push({ kind: 'html', html: beforeClose + closeTag });
        }
      }
      open = false;
      remaining = afterClose;
      continue;
    }

    // Plain leading text (before any tag) may be an unbolded version line (DeLuca).
    const firstTagIdx = remaining.search(/</);
    const leading = firstTagIdx === -1 ? remaining : remaining.slice(0, firstTagIdx);
    const leadingText = leading.trim();
    if (leadingText && isChangelogHeader(leadingText).ok) {
      pieces.push({ kind: 'header', title: displayTitle(leadingText) });
      remaining = firstTagIdx === -1 ? '' : remaining.slice(firstTagIdx);
      continue;
    }

    const openMatch = remaining.match(/<(b|strong)(?:\s[^>]*)?>/i);
    if (!openMatch || openMatch.index === undefined) {
      pushHtmlOrTrailingHeader(pieces, remaining);
      return { pieces, boldOpen: false };
    }

    if (openMatch.index > 0) {
      const before = remaining.slice(0, openMatch.index);
      if (before.length > 0) pushHtmlOrTrailingHeader(pieces, before);
    }

    const openTag = openMatch[0];
    const tagName = openMatch[1];
    const afterOpen = remaining.slice(openMatch.index + openTag.length);
    const closeRe = new RegExp(`</${tagName}>`, 'i');
    const closeMatch = afterOpen.match(closeRe);

    if (!closeMatch || closeMatch.index === undefined) {
      const text = stripTags(afterOpen);
      if (text && isChangelogHeader(text, { fromBold: true }).ok) {
        pieces.push({ kind: 'header', title: displayTitle(text) });
      } else {
        pushHtmlOrTrailingHeader(pieces, openTag + afterOpen, true);
      }
      return { pieces, boldOpen: true };
    }

    const inner = afterOpen.slice(0, closeMatch.index);
    const closeTag = closeMatch[0];
    const afterClose = afterOpen.slice(closeMatch.index + closeTag.length);
    const text = stripTags(inner);

    if (text && isChangelogHeader(text, { fromBold: true }).ok) {
      pieces.push({ kind: 'header', title: displayTitle(text) });
    } else {
      pieces.push({ kind: 'html', html: openTag + inner + closeTag });
    }
    remaining = afterClose;
  }

  return { pieces, boldOpen: open };
}

function createParseState(): ParseState {
  return {
    boldOpen: false,
    preambleHtml: '',
    entries: [],
    current: null,
    pendingBr: false,
  };
}

function commitCurrent(state: ParseState): void {
  if (!state.current) return;
  state.entries.push(state.current);
  state.current = null;
}

function feedSegment(
  state: ParseState,
  segment: string,
  hasFollowingBr: boolean,
): void {
  const { pieces, boldOpen: nextBold } = splitSegment(segment, state.boldOpen);
  state.boldOpen = nextBold;

  if (pieces.length === 0) {
    if (state.current) {
      if (state.pendingBr || state.current.bodyHtml.length > 0) {
        state.current.bodyHtml += '<br>';
      } else {
        state.pendingBr = true;
      }
    } else if (state.preambleHtml.length > 0) {
      state.preambleHtml += '<br>';
    } else {
      state.pendingBr = true;
    }
  } else {
    for (const piece of pieces) {
      if (piece.kind === 'header') {
        state.pendingBr = false;
        commitCurrent(state);
        state.current = { title: piece.title, bodyHtml: '' };
        continue;
      }

      if (!state.current) {
        if (state.pendingBr && state.preambleHtml.length > 0) {
          state.preambleHtml += '<br>';
        }
        state.pendingBr = false;
        state.preambleHtml += piece.html;
      } else {
        if (state.pendingBr && state.current.bodyHtml.length > 0) {
          state.current.bodyHtml += '<br>';
        }
        state.pendingBr = false;
        if (state.current.bodyHtml.length === 0 && piece.html === '') continue;
        state.current.bodyHtml += piece.html;
      }
    }
  }

  if (hasFollowingBr) {
    state.pendingBr = true;
  }
}

function finalizeParse(state: ParseState): GameChangelogParseResult {
  commitCurrent(state);

  let preambleHtml = trimEntryHtml(state.preambleHtml);
  if (stripTags(preambleHtml).length === 0) {
    preambleHtml = '';
  }

  if (state.entries.length < 2) return { ok: false };

  return {
    ok: true,
    preambleHtml,
    entries: state.entries.map((e) => ({
      title: e.title,
      bodyHtml: trimEntryHtml(e.bodyHtml),
    })),
  };
}

export function parseChangelogHtml(html: string): GameChangelogParseResult {
  const normalized = unwrapChangelogSpoilers(html ?? '');
  const segments = normalized.split(/<br\s*\/?>/i);
  const state = createParseState();
  for (let i = 0; i < segments.length; i++) {
    feedSegment(state, segments[i], i < segments.length - 1);
  }
  return finalizeParse(state);
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 32 });
      return;
    }
    setTimeout(resolve, 0);
  });
}

export type ChangelogParseProgress = {
  /** Completed entries so far (bodies not yet final-trimmed). */
  entries: GameChangelogEntry[];
};

/**
 * Same result as `parseChangelogHtml`, but yields to the main thread between
 * segment batches and reports completed entries so the UI can paint progressively.
 */
export async function parseChangelogHtmlChunked(
  html: string,
  opts: {
    signal?: AbortSignal;
    /** Segments processed before yielding (default 48). */
    segmentsPerChunk?: number;
    onProgress?: (progress: ChangelogParseProgress) => void;
  } = {},
): Promise<GameChangelogParseResult> {
  const { signal, segmentsPerChunk = 48, onProgress } = opts;
  const normalized = unwrapChangelogSpoilers(html ?? '');
  const segments = normalized.split(/<br\s*\/?>/i);
  const state = createParseState();
  let lastReported = 0;

  const report = () => {
    if (state.entries.length === lastReported) return;
    lastReported = state.entries.length;
    onProgress?.({ entries: state.entries.slice() });
  };

  for (let i = 0; i < segments.length; i++) {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    feedSegment(state, segments[i], i < segments.length - 1);

    if ((i + 1) % segmentsPerChunk === 0) {
      report();
      await yieldToMain();
    }
  }

  report();
  return finalizeParse(state);
}

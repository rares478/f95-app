import { isChangelogHeader } from './isChangelogHeader';
import type { GameChangelogEntry, GameChangelogParseResult } from './types';

type Piece =
  | { kind: 'header'; title: string }
  | { kind: 'html'; html: string };

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

function displayTitle(text: string): string {
  let t = text.trim();
  if (t.endsWith(':')) t = t.slice(0, -1).trimEnd();
  return t;
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
        } else if (remaining.length > 0) {
          pieces.push({ kind: 'html', html: remaining });
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
        pieces.push({ kind: 'html', html: beforeClose + closeTag });
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
      if (remaining.length > 0) pieces.push({ kind: 'html', html: remaining });
      return { pieces, boldOpen: false };
    }

    if (openMatch.index > 0) {
      const before = remaining.slice(0, openMatch.index);
      if (before.length > 0) pieces.push({ kind: 'html', html: before });
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
        pieces.push({ kind: 'html', html: openTag + afterOpen });
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

export function parseChangelogHtml(html: string): GameChangelogParseResult {
  const normalized = html ?? '';
  const segments = normalized.split(/<br\s*\/?>/i);

  let boldOpen = false;
  let preamble = { html: '' };
  const entries: GameChangelogEntry[] = [];
  let current: GameChangelogEntry | null = null;
  let pendingBr = false;

  for (let i = 0; i < segments.length; i++) {
    const { pieces, boldOpen: nextBold } = splitSegment(segments[i], boldOpen);
    boldOpen = nextBold;

    if (pieces.length === 0) {
      // Empty segment = blank line via <br>
      if (current) {
        if (pendingBr || current.bodyHtml.length > 0) current.bodyHtml += '<br>';
        else pendingBr = true;
      } else if (preamble.html.length > 0) {
        preamble.html += '<br>';
      } else {
        pendingBr = true;
      }
      continue;
    }

    for (const piece of pieces) {
      if (piece.kind === 'header') {
        pendingBr = false;
        if (current) entries.push(current);
        current = { title: piece.title, bodyHtml: '' };
        continue;
      }

      if (!current) {
        if (pendingBr && preamble.html.length > 0) preamble.html += '<br>';
        pendingBr = false;
        preamble.html += piece.html;
      } else {
        if (pendingBr && current.bodyHtml.length > 0) current.bodyHtml += '<br>';
        pendingBr = false;
        // Avoid leading <br> at start of body
        if (current.bodyHtml.length === 0 && piece.html === '') continue;
        current.bodyHtml += piece.html;
      }
    }

    // A <br> follows this segment unless it was the last one
    if (i < segments.length - 1) {
      pendingBr = true;
    }
  }

  if (current) entries.push(current);

  // Drop trailing <br> noise on preamble
  preamble.html = preamble.html.replace(/(?:<br\s*\/?>)+$/i, '');

  if (entries.length < 2) return { ok: false };

  return {
    ok: true,
    preambleHtml: preamble.html,
    entries: entries.map((e) => ({
      title: e.title,
      bodyHtml: e.bodyHtml.replace(/^(?:<br\s*\/?>)+/i, '').replace(/(?:<br\s*\/?>)+$/i, ''),
    })),
  };
}

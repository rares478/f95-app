export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]+>/g, '');
  return stripped
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function buildQuoteBbcode(args: {
  author: string;
  postId: string;
  text: string;
}): string | null {
  const text = args.text.trim();
  if (!text) return null;
  const author = args.author.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[QUOTE="${author}, post: ${args.postId}"]\n${text}\n[/QUOTE]`;
}

export function appendQuoteToDraft(draft: string, quoteBlock: string): string {
  const d = draft.replace(/\s+$/u, '');
  if (!d) return quoteBlock;
  return `${d}\n\n${quoteBlock}`;
}

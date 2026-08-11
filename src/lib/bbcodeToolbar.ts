export type BbcodeSelection = { value: string; start: number; end: number };
export type BbcodeEditResult = { value: string; start: number; end: number };

function splice(
  sel: BbcodeSelection,
  inserted: string,
  caretStart: number,
  caretEnd: number,
): BbcodeEditResult {
  const before = sel.value.slice(0, sel.start);
  const after = sel.value.slice(sel.end);
  return {
    value: before + inserted + after,
    start: caretStart,
    end: caretEnd,
  };
}

export function wrapBbcodeTag(sel: BbcodeSelection, tag: string): BbcodeEditResult {
  const open = `[${tag}]`;
  const close = `[/${tag}]`;
  const selected = sel.value.slice(sel.start, sel.end);
  if (sel.start === sel.end) {
    const caret = sel.start + open.length;
    return splice(sel, open + close, caret, caret);
  }
  const inserted = open + selected + close;
  const contentStart = sel.start + open.length;
  return splice(sel, inserted, contentStart, contentStart + selected.length);
}

export function insertBbcodeUrl(sel: BbcodeSelection, url: string): BbcodeEditResult {
  if (sel.start === sel.end) {
    const inserted = `[URL]${url}[/URL]`;
    const caret = sel.start + inserted.length;
    return splice(sel, inserted, caret, caret);
  }
  const selected = sel.value.slice(sel.start, sel.end);
  const inserted = `[URL=${url}]${selected}[/URL]`;
  return splice(sel, inserted, sel.start, sel.start + inserted.length);
}

export function insertBbcodeImage(sel: BbcodeSelection, url: string): BbcodeEditResult {
  const inserted = `[IMG]${url}[/IMG]`;
  const caret = sel.start + inserted.length;
  return splice(sel, inserted, caret, caret);
}

export function insertBbcodeList(sel: BbcodeSelection): BbcodeEditResult {
  const inserted = '[LIST]\n[*]\n[/LIST]';
  const caret = sel.start + '[LIST]\n[*]'.length;
  return splice(sel, inserted, caret, caret);
}

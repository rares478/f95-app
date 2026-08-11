import { describe, expect, it } from 'vitest';
import {
  insertBbcodeImage,
  insertBbcodeList,
  insertBbcodeUrl,
  wrapBbcodeTag,
} from './bbcodeToolbar';

describe('wrapBbcodeTag', () => {
  it('wraps selection', () => {
    expect(wrapBbcodeTag({ value: 'hello world', start: 6, end: 11 }, 'B')).toEqual({
      value: 'hello [B]world[/B]',
      start: 9,
      end: 14,
    });
  });

  it('inserts empty pair and places caret inside when no selection', () => {
    expect(wrapBbcodeTag({ value: 'ab', start: 1, end: 1 }, 'I')).toEqual({
      value: 'a[I][/I]b',
      start: 4,
      end: 4,
    });
  });
});

describe('insertBbcodeUrl', () => {
  it('wraps selection with URL=', () => {
    expect(
      insertBbcodeUrl({ value: 'click here', start: 0, end: 10 }, 'https://x.test'),
    ).toEqual({
      value: '[URL=https://x.test]click here[/URL]',
      start: 0,
      end: 36,
    });
  });

  it('inserts [URL]url[/URL] when no selection', () => {
    expect(insertBbcodeUrl({ value: '', start: 0, end: 0 }, 'https://x.test')).toEqual({
      value: '[URL]https://x.test[/URL]',
      start: 25,
      end: 25,
    });
  });
});

describe('insertBbcodeImage', () => {
  it('inserts IMG tag at caret', () => {
    expect(insertBbcodeImage({ value: 'x', start: 1, end: 1 }, 'https://i.test/a.png')).toEqual({
      value: 'x[IMG]https://i.test/a.png[/IMG]',
      start: 32,
      end: 32,
    });
  });
});

describe('insertBbcodeList', () => {
  it('inserts list stub with caret after [*]', () => {
    const r = insertBbcodeList({ value: '', start: 0, end: 0 });
    expect(r.value).toBe('[LIST]\n[*]\n[/LIST]');
    expect(r.start).toBe('[LIST]\n[*]'.length);
    expect(r.end).toBe(r.start);
  });
});

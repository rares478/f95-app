import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities } from './htmlEntities';

describe('decodeHtmlEntities', () => {
  it('decodes Ren&#039;Py apostrophe entity', () => {
    expect(decodeHtmlEntities("Ren&#039;Py")).toBe("Ren'Py");
  });

  it('decodes numeric and hex apostrophes', () => {
    expect(decodeHtmlEntities('Ren&#39;Py')).toBe("Ren'Py");
    expect(decodeHtmlEntities('Ren&#x27;Py')).toBe("Ren'Py");
  });

  it('decodes double-encoded entities', () => {
    expect(decodeHtmlEntities('Ren&amp;#039;Py')).toBe("Ren'Py");
  });

  it('leaves plain text unchanged', () => {
    expect(decodeHtmlEntities("Ren'Py")).toBe("Ren'Py");
  });
});

import { describe, expect, it } from 'vitest';
import { isHtmlEngine } from './storeEngine';

describe('isHtmlEngine', () => {
  it('is false for empty or missing tags', () => {
    expect(isHtmlEngine([])).toBe(false);
    expect(isHtmlEngine(null)).toBe(false);
    expect(isHtmlEngine(undefined)).toBe(false);
  });

  it('is true when HTML engine tag is present', () => {
    expect(isHtmlEngine(['Adventure', 'HTML'])).toBe(true);
    expect(isHtmlEngine(['html'])).toBe(true);
  });

  it('is false for other engines only', () => {
    expect(isHtmlEngine(["Ren'Py", 'Adventure'])).toBe(false);
    expect(isHtmlEngine(['Unity'])).toBe(false);
  });
});

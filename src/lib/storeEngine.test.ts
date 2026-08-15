import { describe, expect, it } from 'vitest';
import { isHtmlEngine, isRenPyEngine } from './storeEngine';

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

describe('isRenPyEngine', () => {
  it('is false for empty or missing tags', () => {
    expect(isRenPyEngine([])).toBe(false);
    expect(isRenPyEngine(null)).toBe(false);
    expect(isRenPyEngine(undefined)).toBe(false);
  });

  it("is true when Ren'Py engine tag is present (case-insensitive)", () => {
    expect(isRenPyEngine(['Adventure', "Ren'Py"])).toBe(true);
    expect(isRenPyEngine(["ren'py"])).toBe(true);
    expect(isRenPyEngine(["REN'PY"])).toBe(true);
  });

  it('is false for other engines only', () => {
    expect(isRenPyEngine(['HTML', 'Adventure'])).toBe(false);
    expect(isRenPyEngine(['Unity'])).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { isPathInsideLibrary } from './libraries';

describe('isPathInsideLibrary', () => {
  it('accepts direct child and nested paths', () => {
    expect(isPathInsideLibrary('D:\\Games\\Foo', 'D:\\Games')).toBe(true);
    expect(isPathInsideLibrary('D:\\Games\\Foo\\bar', 'D:\\Games')).toBe(true);
  });

  it('accepts exact library root', () => {
    expect(isPathInsideLibrary('D:\\Games', 'D:\\Games')).toBe(true);
  });

  it('rejects siblings and prefix false-friends', () => {
    expect(isPathInsideLibrary('D:\\GamesOther\\Foo', 'D:\\Games')).toBe(false);
    expect(isPathInsideLibrary('D:\\Other\\Foo', 'D:\\Games')).toBe(false);
  });

  it('normalizes trailing separators', () => {
    expect(isPathInsideLibrary('D:\\Games\\Foo\\', 'D:\\Games\\')).toBe(true);
  });
});

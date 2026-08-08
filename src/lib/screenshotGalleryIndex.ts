/** Keep a gallery selection index inside `[0, length)`. Empty → 0. */
export function clampGalleryIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

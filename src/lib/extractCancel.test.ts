import { describe, expect, it } from 'vitest';
import { isExtractCancelled } from './extractCancel';

describe('isExtractCancelled', () => {
  it('detects the locale key from IPC errors', () => {
    expect(isExtractCancelled({ message: 'error.extract.cancelled' })).toBe(true);
    expect(isExtractCancelled('error.extract.cancelled')).toBe(true);
    expect(isExtractCancelled({ message: 'error.extract.failed|{"detail":"x"}' })).toBe(false);
  });
});

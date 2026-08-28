import { describe, expect, it } from 'vitest';
import {
  developerProfilePath,
  parseDeveloperProfileParam,
} from './developerProfilePath';

describe('developerProfilePath', () => {
  it('builds encoded developer routes', () => {
    expect(developerProfilePath('DrPinkcake')).toBe('/developers/DrPinkcake');
    expect(developerProfilePath('Team & Co')).toBe(
      '/developers/Team%20%26%20Co',
    );
  });

  it('parses route params', () => {
    expect(parseDeveloperProfileParam('DrPinkcake')).toBe('DrPinkcake');
    expect(parseDeveloperProfileParam('Team%20%26%20Co')).toBe('Team & Co');
  });
});

import { describe, expect, it } from 'vitest';
import { samCreatorBrowseUrl } from './developerSearch';

describe('samCreatorBrowseUrl', () => {
  it('builds SAM latest_alpha creator hash URL', () => {
    expect(samCreatorBrowseUrl('Andrealphus')).toBe(
      'https://f95zone.to/sam/latest_alpha/#/cat=games/page=1/creator=Andrealphus',
    );
  });

  it('encodes special characters in creator names', () => {
    expect(samCreatorBrowseUrl('DSS Games')).toBe(
      'https://f95zone.to/sam/latest_alpha/#/cat=games/page=1/creator=DSS%20Games',
    );
  });
});

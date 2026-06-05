import { describe, expect, it } from 'vitest';
import { normalizeSamPrefixGroups } from '../domain/sam/client';

const SAMPLE_BY_CATEGORY = JSON.stringify({
  status: 'ok',
  msg: {
    prefixes: {
      games: [
        {
          id: 3,
          name: 'Engine',
          prefixes: [
            { id: 7, name: "Ren'Py", class: 'label label--renpy' },
            { id: 3, name: 'Unity', class: 'label label--unity' },
          ],
        },
        {
          id: 5,
          name: 'Other',
          prefixes: [
            { id: 13, name: 'VN', class: 'label label--blue' },
            { id: 25, name: 'Collection', class: 'label label--gray' },
          ],
        },
      ],
    },
  },
});

const SAMPLE_FLAT_LIST = JSON.stringify({
  status: 'ok',
  msg: {
    prefixes: [
      {
        id: 4,
        name: 'Status',
        prefixes: [
          { id: 22, name: 'Completed', class: 'label label--green' },
          { id: 23, name: 'On Hold', class: 'label label--orange' },
        ],
      },
    ],
  },
});

describe('normalizeSamPrefixGroups', () => {
  it('parses prefixes grouped by category key', () => {
    const groups = normalizeSamPrefixGroups(SAMPLE_BY_CATEGORY, 'games');
    expect(groups.length).toBe(2);
    expect(groups[0].name).toBe('Engine');
    expect(groups[0].prefixes.map((p) => p.name)).toContain("Ren'Py");
    expect(groups[1].prefixes.map((p) => p.id)).toContain(13);
  });

  it('parses flat prefix list when category is in the query', () => {
    const groups = normalizeSamPrefixGroups(SAMPLE_FLAT_LIST, 'games');
    expect(groups.length).toBe(1);
    expect(groups[0].name).toBe('Status');
    expect(groups[0].prefixes.length).toBe(2);
  });

  it('returns empty for error responses', () => {
    expect(
      normalizeSamPrefixGroups(
        JSON.stringify({ status: 'error', msg: 'You must be logged in' }),
        'games',
      ),
    ).toEqual([]);
  });
});

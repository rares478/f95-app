import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseForumNodesFromForumsIndex,
  parseForumSearchFormOptions,
} from '../domain/f95/forumSearch';

const SAMPLE = `<form>
  <select name="c[nodes][]" multiple size="7">
    <option value="">All forums</option>
    <option value="2">Games</option>
    <option value="45">Mods</option>
  </select>
</form>`;

const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseForumSearchFormOptions', () => {
  it('parses forum node options from XenForo search HTML', () => {
    const { forums } = parseForumSearchFormOptions(SAMPLE);
    expect(forums).toEqual([
      { id: 2, label: 'Games', depth: 0 },
      { id: 45, label: 'Mods', depth: 0 },
    ]);
  });

  it('matches node selects by name attribute instead of CSS brackets', () => {
    const html = `<select name="c[nodes][0]"><option value="2">Games</option></select>`;
    expect(parseForumSearchFormOptions(html).forums).toEqual([
      { id: 2, label: 'Games', depth: 0 },
    ]);
  });

  it('parses F95 /search/?type=post forum select markup', () => {
    const { forums } = parseForumSearchFormOptions(fix('search-form-post-nodes.html'));
    expect(forums).toEqual([
      { id: 32, label: 'Announcements', depth: 0 },
      { id: 19, label: 'Site Rules, News & Announcements', depth: 1 },
      { id: 1, label: 'Adult Games', depth: 0 },
      { id: 2, label: 'Games', depth: 1 },
      { id: 41, label: 'Mods', depth: 1 },
    ]);
  });
});

describe('parseForumNodesFromForumsIndex', () => {
  it('parses forum and sub-forum nodes from the forums index', () => {
    const forums = parseForumNodesFromForumsIndex(fix('forum-nodes-index-sample.html'));
    expect(forums).toEqual([
      { id: 2, label: 'Games', depth: 1 },
      { id: 41, label: 'Mods', depth: 1 },
      { id: 119, label: 'Request', depth: 2 },
    ]);
  });
});
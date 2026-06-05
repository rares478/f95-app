import { describe, expect, it } from 'vitest';
import { parseRssTitle, parseRssXml } from '../domain/sam/rss';

const SAMPLE_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>F95zone Latest Updates</title>
    <item>
      <title>[UPDATE] Shadows of Ambition [Ch.1 Rework]</title>
      <description><![CDATA[<img src="https://preview.f95zone.to/2026/01/test.png" alt="" />]]></description>
      <dc:creator>AbyssGames</dc:creator>
      <link>https://f95zone.to/threads/231321</link>
      <guid>https://f95zone.to/threads/231321</guid>
      <pubDate>Fri, 05 Jun 2026 03:08:00 +0000</pubDate>
    </item>
    <item>
      <title>[NEW] My Dragon Idol [v1.0.0]</title>
      <description><![CDATA[<img src="https://preview.f95zone.to/2026/06/new.jpg" alt="" />]]></description>
      <dc:creator>artoonu</dc:creator>
      <link>https://f95zone.to/threads/301389</link>
      <guid>https://f95zone.to/threads/301389</guid>
      <pubDate>Thu, 04 Jun 2026 20:12:23 +0000</pubDate>
    </item>
  </channel>
</rss>`;

describe('parseRssXml', () => {
  it('parses items with thread ids and metadata', () => {
    const feed = parseRssXml(SAMPLE_RSS);
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({
      threadId: '231321',
      kind: 'update',
      creator: 'AbyssGames',
      thumbnailUrl: 'https://preview.f95zone.to/2026/01/test.png',
    });
    expect(feed.items[1]).toMatchObject({
      threadId: '301389',
      kind: 'new',
      version: 'v1.0.0',
    });
  });
});

describe('parseRssTitle', () => {
  it('extracts kind and version from bracketed titles', () => {
    expect(parseRssTitle('[UPDATE] Game Name [v0.25]')).toEqual({
      displayTitle: 'Game Name [v0.25]',
      kind: 'update',
      version: 'v0.25',
    });
    expect(parseRssTitle('[NEW] Fresh Game [Final]')).toEqual({
      displayTitle: 'Fresh Game [Final]',
      kind: 'new',
      version: 'Final',
    });
  });
});

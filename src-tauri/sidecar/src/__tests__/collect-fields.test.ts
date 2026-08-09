import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { collectFields } from '../domain/game/client';

function fieldsFrom(html: string): Record<string, string> {
  const $ = cheerio.load(`<div class="bbWrapper">${html}</div>`);
  return collectFields($, $('.bbWrapper').first());
}

describe('collectFields — Developer with links', () => {
  it('keeps plain developer name before social links', () => {
    const fields = fieldsFrom(
      `<b>Developer</b>: Caribdis <a href="https://www.patreon.com/x">Patreon</a> - <a href="https://discord.gg/x">Discord</a><br />`,
    );
    expect(fields.Developer).toBe('Caribdis');
  });

  it('extracts developer name when the name itself is a link', () => {
    const fields = fieldsFrom(
      `<b>Developer</b>: <a href="https://mrdotsgames.com/">MrDots Games</a> - <a href="https://www.patreon.com/mrdotsgames">Patreon</a><br />`,
    );
    expect(fields.Developer).toBe('MrDots Games');
  });

  it('extracts developer name when linked to a social host', () => {
    const fields = fieldsFrom(
      `<b>Developer</b>: <a href="https://www.patreon.com/caribdis">Caribdis</a> - <a href="https://discord.gg/caribdis">Discord</a><br />`,
    );
    expect(fields.Developer).toBe('Caribdis');
  });

  it('does not treat a lone Patreon button as the developer name', () => {
    const fields = fieldsFrom(
      `<b>Developer</b>: <a href="https://www.patreon.com/x">Patreon</a><br />`,
    );
    expect(fields.Developer).toBeUndefined();
  });

  it('skips generic Website labels without eating the name', () => {
    const fields = fieldsFrom(
      `<b>Developer</b>: MrDots Games - <a href="http://mrdotsgames.com/">Website</a> - <a href="https://www.patreon.com/mrdotsgames">Patreon</a><br />`,
    );
    expect(fields.Developer).toBe('MrDots Games');
  });
});

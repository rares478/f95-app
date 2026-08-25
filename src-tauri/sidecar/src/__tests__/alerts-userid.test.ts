import { describe, expect, it } from 'vitest';
import { parseAlertsHtml } from '../domain/f95/alerts';

describe('parseAlertsHtml userId', () => {
  it('extracts userId from the member link', () => {
    const html = `
      <div class="alert js-alert" data-alert-id="9">
        <div class="contentRow-figure"><img class="avatar" src="/a.jpg"></div>
        <div class="contentRow-main">
          <div class="contentRow-header">
            <a href="/members/alice.55/" data-user-id="55">Alice</a> reacted to your post
          </div>
          <a href="/threads/1/">thread</a>
        </div>
      </div>`;
    const alerts = parseAlertsHtml(html);
    expect(alerts[0]?.userId).toBe('55');
    expect(alerts[0]?.username).toBe('Alice');
  });

  it('sets userId null when no member link', () => {
    const html = `
      <div class="alert js-alert" data-alert-id="10">
        <div class="contentRow-main">
          <div class="contentRow-header">System notice about something long enough</div>
        </div>
      </div>`;
    expect(parseAlertsHtml(html)[0]?.userId).toBeNull();
  });
});

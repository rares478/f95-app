import { RPC_ERROR, RpcError } from '../rpc';

export interface CloudflareChallengeOptions {
  message?: string;
  variant?: string;
}

/**
 * Detect Cloudflare managed challenges in HTTP responses (F95, SAM, game threads).
 */
export function assertNotCloudflareChallenge(
  body: string,
  headers: Record<string, string>,
  options: CloudflareChallengeOptions = {},
): void {
  const cfHeader = headers['cf-mitigated'] ?? headers['CF-Mitigated'];
  const head = body.slice(0, 4000);
  const isChallenge =
    (cfHeader && cfHeader.toLowerCase() === 'challenge') ||
    /just a moment\.\.\./i.test(head) ||
    /challenge-platform/.test(head) ||
    /cf-chl-bypass/.test(head);
  if (isChallenge) {
    throw new RpcError(
      RPC_ERROR.CLOUDFLARE_CHALLENGE,
      options.message ?? 'Cloudflare challenge encountered; headless HTTP cannot bypass it',
      options.variant ? { variant: options.variant } : { variant: 'managed' },
    );
  }
}

/** Detect Cloudflare interstitial pages loaded via Playwright (BuzzHeavier, etc.). */
export function isCloudflareInterstitial(html: string): boolean {
  const head = html.slice(0, 8000);
  return (
    (head.includes('<title>Just a moment') ||
      head.includes('Just a moment...</title>') ||
      head.includes('Enable JavaScript and cookies to continue')) &&
    head.includes('challenges.cloudflare.com')
  );
}

/** WorkUpload and similar hosts use custom bot-check pages (not always challenges.cloudflare.com). */
export function isBotChallengePage(html: string): boolean {
  if (isCloudflareInterstitial(html)) return true;
  const head = html.slice(0, 12_000).toLowerCase();
  return (
    head.includes('are you a human') ||
    head.includes('checking that you are not a robot') ||
    head.includes('you will be redirected shortly') ||
    (head.includes('security check') && head.includes('workupload'))
  );
}

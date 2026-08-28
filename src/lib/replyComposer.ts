import * as ipc from './ipc';

/** Where server-side BBCode preview should be routed. Extend when adding new reply surfaces. */
export type BbcodePreviewTarget =
  | { kind: 'thread'; threadId: string }
  | { kind: 'conversation'; conversationPath: string };

export async function previewBbcodeFor(
  target: BbcodePreviewTarget,
  bbCode: string,
): Promise<{ html: string }> {
  if (target.kind === 'thread') {
    return ipc.bbcodePreview(target.threadId, bbCode);
  }
  return ipc.conversationBbcodePreview(target.conversationPath, bbCode);
}

export function openOnF95UrlFor(
  target: BbcodePreviewTarget,
  override?: string | null,
): string | undefined {
  if (override) return override;
  if (target.kind === 'thread') {
    return `https://f95zone.to/threads/${target.threadId}/`;
  }
  return `https://f95zone.to/conversations/${encodeURIComponent(target.conversationPath)}/`;
}

export function composerIdFor(target: BbcodePreviewTarget): string {
  if (target.kind === 'thread') {
    return `reply-thread-${target.threadId}`;
  }
  const safe = target.conversationPath.replace(/[^\w.-]+/g, '_');
  return `reply-conversation-${safe}`;
}

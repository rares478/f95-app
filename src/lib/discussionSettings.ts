import * as settings from './settings';

export interface DiscussionSettings {
  autoShowSignatures: boolean;
}

export const DEFAULT_DISCUSSION_SETTINGS: DiscussionSettings = {
  autoShowSignatures: false,
};

export async function loadDiscussionSettings(): Promise<DiscussionSettings> {
  return {
    autoShowSignatures: await settings.getBool(
      settings.KEY_DISCUSSION_AUTO_SHOW_SIGNATURES,
      DEFAULT_DISCUSSION_SETTINGS.autoShowSignatures,
    ),
  };
}

export async function saveDiscussionSettings(
  patch: Partial<DiscussionSettings>,
): Promise<DiscussionSettings> {
  const current = await loadDiscussionSettings();
  const next = { ...current, ...patch };
  await settings.setBool(
    settings.KEY_DISCUSSION_AUTO_SHOW_SIGNATURES,
    next.autoShowSignatures,
  );
  return next;
}

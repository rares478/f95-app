import type { ProfileDto } from '../types';
import * as settings from './settings';

export async function saveProfileCache(profile: ProfileDto): Promise<void> {
  await settings.set(settings.KEY_PROFILE_CACHE, JSON.stringify(profile));
}

export async function loadProfileCache(): Promise<ProfileDto | null> {
  const raw = await settings.get(settings.KEY_PROFILE_CACHE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProfileDto;
  } catch {
    return null;
  }
}

export async function clearProfileCache(): Promise<void> {
  await settings.remove(settings.KEY_PROFILE_CACHE);
}

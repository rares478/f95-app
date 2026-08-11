import { invoke } from '@tauri-apps/api/core';
import { isBackendError } from '../types';

export type AppLogLevel = 'INFO' | 'WARN' | 'ERROR';

export async function appLog(
  level: AppLogLevel,
  tag: string,
  message: string,
): Promise<void> {
  try {
    await invoke('append_app_log', { level, tag, message });
  } catch {
    // best-effort — never break UX
  }
}

export function mapAuthFailCode(err: unknown): string {
  if (!isBackendError(err)) return 'other';
  switch (err.code) {
    case 'invalid_credentials':
      return 'invalid_credentials';
    case 'two_factor_required':
      return 'two_factor';
    case 'cloudflare':
      return 'cloudflare';
    case 'not_initialized':
    case 'sidecar_timeout':
    case 'sidecar_crash':
    case 'protocol':
      return 'sidecar';
    default:
      return 'other';
  }
}

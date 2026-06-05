import { convertFileSrc } from '@tauri-apps/api/core';
import * as ipc from './ipc';

export type MediaPreviewVariant = 'thumb' | 'display';

/** Arquivos acima disso podem usar preview redimensionado em segundo plano. */
export const DISPLAY_UPGRADE_BYTES = 4 * 1024 * 1024;

/** Abaixo disso a miniatura usa o arquivo original (sem IPC). Alinhado ao backend. */
export const THUMB_SKIP_BYTES = 400 * 1024;

const previewPathCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

function cacheKey(path: string, variant: MediaPreviewVariant): string {
  return `${variant}:${path}`;
}

/** URL imediata — arquivo original via protocolo asset do Tauri. */
export function directAssetUrl(path: string): string {
  return convertFileSrc(path);
}

/**
 * Preview em cache (Rust). Use só em segundo plano; para exibição imediata prefira `directAssetUrl`.
 */
export async function resolvePreviewPath(
  sourcePath: string,
  variant: MediaPreviewVariant,
): Promise<string> {
  const key = cacheKey(sourcePath, variant);
  const hit = previewPathCache.get(key);
  if (hit) return hit;

  let pending = inFlight.get(key);
  if (!pending) {
    pending = ipc
      .resolveMediaPreview({ path: sourcePath, variant })
      .then((out) => {
        previewPathCache.set(key, out);
        inFlight.delete(key);
        return out;
      })
      .catch((err) => {
        inFlight.delete(key);
        throw err;
      });
    inFlight.set(key, pending);
  }
  return pending;
}

/** Troca para preview menor quando o original é pesado demais para o WebView. */
export async function upgradeDisplayUrl(path: string, fileSize: number): Promise<string> {
  if (fileSize < DISPLAY_UPGRADE_BYTES) return directAssetUrl(path);
  try {
    const cached = await resolvePreviewPath(path, 'display');
    return convertFileSrc(cached);
  } catch {
    return directAssetUrl(path);
  }
}

export function clearMediaPreviewCache(): void {
  previewPathCache.clear();
  inFlight.clear();
}

import type { GameDownload } from '../types/game';
import { STREAMABLE_HOSTS } from './downloadHosts';
import { groupDownloads } from './groupDownloads';

export type SectionKind = 'current_os' | 'legacy' | 'patch' | 'extra' | 'other';

export type InstallSection = {
  label: string;
  kind: SectionKind;
  links: GameDownload[];
  defaultChecked: boolean;
};

const DEFAULT_PREFERRED_ORDER = [
  'pixeldrain',
  'mega',
  'gofile',
  'buzzheavier',
  'datanodes',
  'mediafire',
  'uploadhaven',
  'workupload',
  'mixdrop',
  'gdrive',
];

export function classifySectionLabel(
  label: string | null,
  platform: 'windows' | 'macos' | 'linux',
): SectionKind {
  const text = label ?? '';

  if (/patch(es)?/i.test(text)) return 'patch';
  if (/extra(s)?/i.test(text) || /\bmods?\b/i.test(text) || /translation/i.test(text)) return 'extra';
  if (/before\b|legacy|old(er)?\b|previous\b|archive\b/i.test(text)) return 'legacy';

  if ((platform === 'windows' || platform === 'linux') && /win|windows|pc|linux/i.test(text)) {
    return 'current_os';
  }

  if (platform === 'macos' && /mac|osx|darwin/i.test(text)) {
    return 'current_os';
  }

  return 'other';
}

const NON_DEFAULT_KINDS = new Set<SectionKind>(['legacy', 'patch', 'extra']);

export function buildInstallSections(
  links: GameDownload[],
  platform: 'windows' | 'macos' | 'linux',
): InstallSection[] {
  const sections = groupDownloads(links).map(([group, groupLinks]) => {
    const label = group ?? '(ungrouped)';
    const kind = classifySectionLabel(group, platform);
    return {
      label,
      kind,
      links: groupLinks,
      defaultChecked: false,
    };
  });

  if (sections.some((s) => s.kind === 'current_os')) {
    return sections.map((s) => ({
      ...s,
      defaultChecked: s.kind === 'current_os',
    }));
  }

  // No current_os: sole section, else first non-legacy/patch/extra (prefer other).
  let defaultLabel: string | null = null;
  if (sections.length === 1) {
    defaultLabel = sections[0]!.label;
  } else {
    const eligible = sections.filter((s) => !NON_DEFAULT_KINDS.has(s.kind));
    const pick =
      eligible.find((s) => s.kind === 'other') ?? eligible[0] ?? null;
    defaultLabel = pick?.label ?? null;
  }

  return sections.map((s) => ({
    ...s,
    defaultChecked: defaultLabel != null && s.label === defaultLabel,
  }));
}

export function pickPreferredHost(
  links: GameDownload[],
  preferredOrder: string[] = DEFAULT_PREFERRED_ORDER,
): GameDownload | null {
  if (links.length === 0) return null;

  for (const host of preferredOrder) {
    if (!STREAMABLE_HOSTS.has(host)) continue;
    const found = links.find((l) => l.host === host);
    if (found) return found;
  }

  const firstStreamable = links.find((l) => STREAMABLE_HOSTS.has(l.host));
  if (firstStreamable) return firstStreamable;

  return links[0] ?? null;
}

/** Best-effort OS for section defaults; Win Tauri falls back to windows. */
export function detectInstallPlatform(): 'windows' | 'macos' | 'linux' {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const fromUaData = nav.userAgentData?.platform?.toLowerCase() ?? '';
  if (fromUaData.includes('mac')) return 'macos';
  if (fromUaData.includes('linux')) return 'linux';
  if (fromUaData.includes('win')) return 'windows';

  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux') && !ua.includes('android')) return 'linux';
  return 'windows';
}

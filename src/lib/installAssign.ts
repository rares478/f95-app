import { exeFilename } from './libraryExes';
import type { SectionKind } from './installSections';

export function shouldAutoAssign(args: {
  jobCount: number;
  sectionKind: SectionKind;
  exePath: string | null;
}): boolean {
  return args.jobCount === 1 && args.sectionKind === 'current_os' && !!args.exePath;
}

export function defaultExeLabel(sectionLabel: string, exePath: string | null): string {
  const trimmed = sectionLabel.trim();
  if (trimmed) return trimmed;
  if (!exePath) return '';
  return exeFilename(exePath);
}

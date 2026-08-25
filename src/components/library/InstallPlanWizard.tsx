import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameDownload } from '../../types/game';
import type { InstallLibraryWithDisk } from '../../types/install-library';
import * as downloads from '../../lib/downloads';
import * as ipc from '../../lib/ipc';
import * as libraries from '../../lib/libraries';
import * as library from '../../lib/library';
import {
  attachDownload,
  createPlan,
  markJobAssign,
  markPlanStatus,
  type CreatePlanJobInput,
  type InstallJob,
} from '../../lib/installPlans';
import {
  buildInstallCatalog,
  defaultPackageKind,
  defaultPlatformId,
  defaultSeasonId,
  type InstallPackage,
  type InstallPackageKind,
  type InstallPlatform,
  type InstallSeason,
} from '../../lib/installCatalog';
import { resolveInitialWizardStep } from '../../lib/installWizardSteps';
import {
  classifySectionLabel,
  detectInstallPlatform,
  pickPreferredHost,
  type SectionKind,
} from '../../lib/installSections';
import {
  HOST_COLORS,
  shouldShowHostBadge,
  STREAMABLE_HOSTS,
} from '../../lib/downloadHosts';
import { useOffline } from '../../contexts/Offline';
import { useT } from '../../lib/i18n';
import { formatIpcError } from '../../lib/ipcError';
import { dialog } from '../../lib/dialog';
import { InstallLocationModal } from '../InstallLocationModal';
import '../../styles/install-plan.css';

export interface InstallPlanWizardProps {
  open: boolean;
  threadId: string;
  title: string;
  links: GameDownload[];
  gameVersion: string | null;
  intent: 'install' | 'update';
  onClose: () => void;
  onStarted?: () => void;
  onBrowseAll?: () => void;
  /** Runs once before plan creation (e.g. library.add + setStatus). */
  prepareStart?: () => Promise<void>;
  /** When true, open on the season step if it is in the visible step list. */
  preferSeasonStep?: boolean;
}

type WizardStep = 'platform' | 'season' | 'package' | 'hosts';

const FULL_HOST_KEY = 'full';

function partHostKey(part: number | null): string {
  return part == null ? FULL_HOST_KEY : String(part);
}

function findPlatform(
  catalog: InstallPlatform[],
  id: string | null,
): InstallPlatform | null {
  if (id == null) return null;
  return catalog.find((p) => p.id === id) ?? null;
}

function findSeason(
  platform: InstallPlatform | null,
  id: string | null,
): InstallSeason | null {
  if (!platform || id == null) return null;
  return platform.seasons.find((s) => s.id === id) ?? null;
}

function findPackage(
  season: InstallSeason | null,
  kind: InstallPackageKind | null,
): InstallPackage | null {
  if (!season || kind == null) return null;
  return season.packages.find((p) => p.kind === kind) ?? null;
}

function visibleStepsFor(
  catalog: InstallPlatform[],
  platform: InstallPlatform | null,
  season: InstallSeason | null,
): WizardStep[] {
  const steps: WizardStep[] = [];
  if (catalog.length > 1) steps.push('platform');
  if (platform && platform.seasons.length > 1) steps.push('season');
  if (season && season.packages.length > 1) steps.push('package');
  steps.push('hosts');
  return steps;
}

function sectionLabelFor(
  season: InstallSeason,
  platform: InstallPlatform,
  pkg: InstallPackage,
): string {
  const packageWord = pkg.kind === 'full' ? 'Full' : 'Splits';
  return `${season.label} · ${platform.label} · ${packageWord}`;
}

function preferredHostsForPackage(
  pkg: InstallPackage,
): Record<string, GameDownload> {
  const next: Record<string, GameDownload> = {};
  for (const part of pkg.parts) {
    const preferred = pickPreferredHost(part.links);
    if (preferred) next[partHostKey(part.part)] = preferred;
  }
  return next;
}

function hostPresentOnEveryPart(
  pkg: InstallPackage,
  host: string,
): boolean {
  return pkg.parts.every((part) => part.links.some((l) => l.host === host));
}

function pickLinkForHost(
  links: GameDownload[],
  host: string,
): GameDownload | null {
  return links.find((l) => l.host === host) ?? null;
}

export function InstallPlanWizard({
  open,
  threadId,
  title,
  links,
  gameVersion,
  intent,
  onClose,
  onStarted,
  onBrowseAll,
  prepareStart,
  preferSeasonStep = false,
}: InstallPlanWizardProps) {
  const { t } = useT();
  const { isOffline } = useOffline();

  const os = useMemo(() => detectInstallPlatform(), []);
  const catalog = useMemo(() => buildInstallCatalog(links), [links]);

  const [step, setStep] = useState<WizardStep>('platform');
  const [platformId, setPlatformId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [packageKind, setPackageKind] = useState<InstallPackageKind | null>(
    null,
  );
  const [hosts, setHosts] = useState<Record<string, GameDownload>>({});
  const [changingKey, setChangingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingJobs, setPendingJobs] = useState<CreatePlanJobInput[] | null>(
    null,
  );

  const selectedPlatform = findPlatform(catalog, platformId);
  const selectedSeason = findSeason(selectedPlatform, seasonId);
  const selectedPackage = findPackage(selectedSeason, packageKind);
  const steps = useMemo(
    () => visibleStepsFor(catalog, selectedPlatform, selectedSeason),
    [catalog, selectedPlatform, selectedSeason],
  );

  useEffect(() => {
    if (!open) return;

    const nextPlatformId = defaultPlatformId(catalog, os);
    const platform = findPlatform(catalog, nextPlatformId);
    const nextSeasonId = platform ? defaultSeasonId(platform) : null;
    const season = findSeason(platform, nextSeasonId);
    const nextPackageKind = season ? defaultPackageKind(season) : null;
    const pkg = findPackage(season, nextPackageKind);

    setPlatformId(nextPlatformId);
    setSeasonId(nextSeasonId);
    setPackageKind(nextPackageKind);
    setHosts(pkg ? preferredHostsForPackage(pkg) : {});
    setChangingKey(null);
    setBusy(false);
    setPickerOpen(false);
    setPendingJobs(null);

    const initialSteps = visibleStepsFor(catalog, platform, season);
    setStep(resolveInitialWizardStep(initialSteps, preferSeasonStep));
  }, [open, catalog, os, preferSeasonStep]);

  if (!open) return null;

  const heading =
    intent === 'update'
      ? t('library.install.modalTitleUpdate', { title })
      : t('install.wizard.title', { title });

  const stepIndex = steps.indexOf(step);
  const canGoBack = stepIndex > 0;
  const isLastStep = step === 'hosts';

  function seasonDisplayLabel(season: InstallSeason): string {
    return season.id === '__current__'
      ? t('install.wizard.seasonCurrent')
      : season.label;
  }

  function packageDisplayLabel(pkg: InstallPackage): string {
    if (pkg.kind === 'full') return t('install.wizard.package.full');
    return t('install.wizard.package.splits', { count: pkg.parts.length });
  }

  function applyPlatform(id: string) {
    const platform = findPlatform(catalog, id);
    const nextSeasonId = platform ? defaultSeasonId(platform) : null;
    const season = findSeason(platform, nextSeasonId);
    const nextPackageKind = season ? defaultPackageKind(season) : null;
    const pkg = findPackage(season, nextPackageKind);
    setPlatformId(id);
    setSeasonId(nextSeasonId);
    setPackageKind(nextPackageKind);
    setHosts(pkg ? preferredHostsForPackage(pkg) : {});
    setChangingKey(null);
  }

  function applySeason(id: string) {
    const season = findSeason(selectedPlatform, id);
    const nextPackageKind = season ? defaultPackageKind(season) : null;
    const pkg = findPackage(season, nextPackageKind);
    setSeasonId(id);
    setPackageKind(nextPackageKind);
    setHosts(pkg ? preferredHostsForPackage(pkg) : {});
    setChangingKey(null);
  }

  function applyPackage(kind: InstallPackageKind) {
    const pkg = findPackage(selectedSeason, kind);
    setPackageKind(kind);
    setHosts(pkg ? preferredHostsForPackage(pkg) : {});
    setChangingKey(null);
  }

  function goNext() {
    if (step === 'platform' && !platformId) {
      void dialog.alert(t('install.wizard.noSelection'), { kind: 'info' });
      return;
    }
    if (step === 'season' && !seasonId) {
      void dialog.alert(t('install.wizard.noSelection'), { kind: 'info' });
      return;
    }
    if (step === 'package' && !packageKind) {
      void dialog.alert(t('install.wizard.noSelection'), { kind: 'info' });
      return;
    }

    const nextSteps = visibleStepsFor(
      catalog,
      findPlatform(catalog, platformId),
      findSeason(findPlatform(catalog, platformId), seasonId),
    );
    const idx = nextSteps.indexOf(step);
    const next = nextSteps[idx + 1];
    if (!next) return;

    if (next === 'hosts') {
      const platform = findPlatform(catalog, platformId);
      const season = findSeason(platform, seasonId);
      const pkg = findPackage(season, packageKind);
      if (pkg) {
        setHosts((prev) => {
          const preferred = preferredHostsForPackage(pkg);
          const merged = { ...preferred };
          for (const [key, link] of Object.entries(prev)) {
            if (merged[key] && preferred[key]) {
              const part = pkg.parts.find(
                (p) => partHostKey(p.part) === key,
              );
              if (part?.links.some((l) => l.url === link.url)) {
                merged[key] = link;
              }
            }
          }
          return merged;
        });
      }
      setChangingKey(null);
    }
    setStep(next);
  }

  function goBack() {
    const idx = steps.indexOf(step);
    if (idx <= 0) return;
    setChangingKey(null);
    setStep(steps[idx - 1]!);
  }

  function buildJobs(): CreatePlanJobInput[] | null {
    if (!selectedPlatform || !selectedSeason || !selectedPackage) {
      void dialog.alert(t('install.wizard.noSelection'), { kind: 'info' });
      return null;
    }

    const sectionLabel = sectionLabelFor(
      selectedSeason,
      selectedPlatform,
      selectedPackage,
    );
    const sectionKind: SectionKind = classifySectionLabel(
      selectedPlatform.label,
      os,
    );

    if (selectedPackage.kind === 'full') {
      const part = selectedPackage.parts[0];
      if (!part) {
        void dialog.alert(
          t('install.wizard.noHost', { section: sectionLabel }),
          { kind: 'error' },
        );
        return null;
      }
      const link =
        hosts[FULL_HOST_KEY] ?? pickPreferredHost(part.links);
      if (!link) {
        void dialog.alert(
          t('install.wizard.noHost', { section: sectionLabel }),
          { kind: 'error' },
        );
        return null;
      }
      return [
        {
          sectionLabel,
          sectionKind,
          sourceUrl: link.url,
          host: link.host,
          sortOrder: 0,
          bundleId: null,
        },
      ];
    }

    const bundleId = crypto.randomUUID();
    const jobs: CreatePlanJobInput[] = [];
    for (const part of selectedPackage.parts) {
      const key = partHostKey(part.part);
      const link = hosts[key] ?? pickPreferredHost(part.links);
      if (!link) {
        void dialog.alert(
          t('install.wizard.noHost', {
            section: t('install.wizard.partLabel', {
              n: part.part ?? 0,
            }),
          }),
          { kind: 'error' },
        );
        return null;
      }
      jobs.push({
        sectionLabel,
        sectionKind,
        sourceUrl: link.url,
        host: link.host,
        sortOrder: part.part ?? 0,
        bundleId,
      });
    }
    return jobs;
  }

  async function enqueuePlan(
    jobs: CreatePlanJobInput[],
    libraryPath?: string,
  ) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    setBusy(true);
    let planId: string | null = null;
    let createdJobs: InstallJob[] = [];
    const startedJobIds = new Set<string>();
    try {
      await prepareStart?.();

      const created = await createPlan({
        threadId,
        intent,
        jobs,
      });
      planId = created.plan.id;
      createdJobs = created.jobs;

      for (const job of createdJobs) {
        const row = await downloads.create({
          threadId,
          host: job.host,
          sourceUrl: job.sourceUrl,
          gameVersion,
        });
        await attachDownload(job.id, row.id);
        await ipc.downloadStart({
          id: row.id,
          sourceUrl: row.sourceUrl,
          threadId: row.threadId,
          libraryPath,
          platformGroup: job.sectionLabel,
        });
        startedJobIds.add(job.id);
        // Set downloading only after the first successful start so a total
        // failure before any start leaves the prior library status intact.
        if (startedJobIds.size === 1) {
          await library.setStatus(threadId, 'downloading');
        }
      }

      onStarted?.();
      onClose();
    } catch (err) {
      if (planId) {
        const errMsg = formatIpcError(err);
        try {
          for (const job of createdJobs) {
            if (!startedJobIds.has(job.id)) {
              await markJobAssign(job.id, 'failed', {
                errorMessage: errMsg,
              });
            }
          }
          await markPlanStatus(planId, 'failed');
        } catch (markErr) {
          console.warn('[install] failed to mark plan after start error', markErr);
        }
      }
      await dialog.alert(t('dl.start.failed', { error: formatIpcError(err) }), {
        kind: 'error',
      });
    } finally {
      setBusy(false);
      setPendingJobs(null);
    }
  }

  async function onStart() {
    const jobs = buildJobs();
    if (!jobs || jobs.length === 0) return;

    await libraries.ensureSeeded();
    const libs = await libraries.listWithDisk();
    const lib = await libraries.getDefault();
    if (libs.length <= 1) {
      await enqueuePlan(jobs, lib?.path);
      return;
    }
    setPendingJobs(jobs);
    setPickerOpen(true);
  }

  async function onLibraryPicked(lib: InstallLibraryWithDisk) {
    setPickerOpen(false);
    if (!pendingJobs) return;
    const jobs = pendingJobs;
    setPendingJobs(null);
    await enqueuePlan(jobs, lib.path);
  }

  function useHostForAll(host: string) {
    if (!selectedPackage || selectedPackage.kind !== 'splits') return;
    setHosts((prev) => {
      const next = { ...prev };
      for (const part of selectedPackage.parts) {
        const link = pickLinkForHost(part.links, host);
        if (link) next[partHostKey(part.part)] = link;
      }
      return next;
    });
    setChangingKey(null);
  }

  const commonSplitHost =
    selectedPackage?.kind === 'splits'
      ? (() => {
          const firstLinks = selectedPackage.parts[0]?.links ?? [];
          const preferred = pickPreferredHost(firstLinks);
          if (
            preferred &&
            hostPresentOnEveryPart(selectedPackage, preferred.host)
          ) {
            return preferred.host;
          }
          for (const link of firstLinks) {
            if (hostPresentOnEveryPart(selectedPackage, link.host)) {
              return link.host;
            }
          }
          return null;
        })()
      : null;

  const emptyCatalog = catalog.length === 0;

  function renderStepBody() {
    if (emptyCatalog) {
      return <p className="dl-meta-text">{t('dl.empty')}</p>;
    }

    if (step === 'platform') {
      return (
        <ul className="install-wizard-option-list" role="radiogroup">
          {catalog.map((p) => (
            <OptionRadioRow
              key={p.id}
              id={`install-platform-${p.id}`}
              name="install-platform"
              checked={platformId === p.id}
              label={p.label}
              disabled={busy}
              onSelect={() => applyPlatform(p.id)}
            />
          ))}
        </ul>
      );
    }

    if (step === 'season' && selectedPlatform) {
      return (
        <ul className="install-wizard-option-list" role="radiogroup">
          {selectedPlatform.seasons.map((s) => (
            <OptionRadioRow
              key={s.id}
              id={`install-season-${s.id}`}
              name="install-season"
              checked={seasonId === s.id}
              label={seasonDisplayLabel(s)}
              disabled={busy}
              onSelect={() => applySeason(s.id)}
            />
          ))}
        </ul>
      );
    }

    if (step === 'package' && selectedSeason) {
      return (
        <ul className="install-wizard-option-list" role="radiogroup">
          {selectedSeason.packages.map((pkg) => (
            <OptionRadioRow
              key={pkg.kind}
              id={`install-package-${pkg.kind}`}
              name="install-package"
              checked={packageKind === pkg.kind}
              label={packageDisplayLabel(pkg)}
              disabled={busy}
              onSelect={() => applyPackage(pkg.kind)}
            />
          ))}
        </ul>
      );
    }

    if (step === 'hosts' && selectedPackage) {
      return (
        <>
          {selectedPackage.kind === 'splits' && commonSplitHost && (
            <div className="install-wizard-use-all">
              <button
                type="button"
                className="dl-action-btn"
                disabled={busy}
                onClick={() => useHostForAll(commonSplitHost)}
              >
                {t('install.wizard.useHostForAll', {
                  host: commonSplitHost,
                })}
              </button>
            </div>
          )}
          <ul className="install-wizard-host-list">
            {selectedPackage.parts.map((part) => {
              const key = partHostKey(part.part);
              const selected =
                hosts[key] ?? pickPreferredHost(part.links);
              const isChanging = changingKey === key;
              const rowLabel =
                selectedPackage.kind === 'full'
                  ? sectionLabelFor(
                      selectedSeason!,
                      selectedPlatform!,
                      selectedPackage,
                    )
                  : t('install.wizard.partLabel', { n: part.part ?? 0 });
              return (
                <li key={key} className="install-wizard-host-row">
                  <div className="install-wizard-host-head">
                    <div className="install-wizard-host-title">
                      <span className="install-wizard-section-name">
                        {rowLabel}
                      </span>
                    </div>
                    {!isChanging && selected && (
                      <div className="install-wizard-host-pick">
                        <HostChip download={selected} />
                        <button
                          type="button"
                          className="dl-action-btn"
                          disabled={busy}
                          onClick={() => setChangingKey(key)}
                        >
                          {t('install.wizard.changeHost')}
                        </button>
                      </div>
                    )}
                    {!isChanging && !selected && (
                      <span className="install-assign-error">
                        {t('install.wizard.noHost', { section: rowLabel })}
                      </span>
                    )}
                  </div>
                  {isChanging && (
                    <ul className="install-wizard-host-options">
                      {part.links.map((link) => {
                        const active = selected?.url === link.url;
                        return (
                          <li key={`${key}\0${link.url}`}>
                            <button
                              type="button"
                              className={`install-wizard-host-option${active ? ' is-active' : ''}`}
                              disabled={busy}
                              onClick={() => {
                                setHosts((prev) => ({
                                  ...prev,
                                  [key]: link,
                                }));
                                setChangingKey(null);
                              }}
                            >
                              <HostChip download={link} />
                              {STREAMABLE_HOSTS.has(link.host) ? null : (
                                <span className="install-wizard-host-note">
                                  {t('dl.btn.queue')}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      );
    }

    return <p className="dl-meta-text">{t('dl.empty')}</p>;
  }

  function stepLabel(): string {
    switch (step) {
      case 'platform':
        return t('install.wizard.choosePlatform');
      case 'season':
        return t('install.wizard.chooseSeason');
      case 'package':
        return t('install.wizard.choosePackage');
      case 'hosts':
        return t('install.wizard.confirmHosts');
    }
  }

  const startDisabled =
    busy ||
    emptyCatalog ||
    !selectedPlatform ||
    !selectedSeason ||
    !selectedPackage;

  return createPortal(
    <>
      <div className="install-assign-overlay" onClick={onClose}>
        <div
          className="install-assign-modal install-wizard-modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-wizard-title"
        >
          <h2 id="install-wizard-title" className="install-assign-title">
            {heading}
          </h2>

          <p className="install-wizard-step-label">{stepLabel()}</p>
          {renderStepBody()}

          <div className="install-assign-actions">
            {onBrowseAll && (
              <button
                type="button"
                className="dl-action-btn"
                disabled={busy}
                onClick={onBrowseAll}
              >
                {t('install.wizard.browseAll')}
              </button>
            )}
            {canGoBack ? (
              <button
                type="button"
                className="dl-action-btn"
                disabled={busy}
                onClick={goBack}
              >
                {t('common.back')}
              </button>
            ) : (
              <button
                type="button"
                className="dl-action-btn"
                disabled={busy}
                onClick={onClose}
              >
                {t('common.cancel')}
              </button>
            )}
            {isLastStep ? (
              <button
                type="button"
                className="dl-action-btn dl-action-btn-accent"
                disabled={startDisabled}
                onClick={() => void onStart()}
              >
                {busy ? '…' : t('install.wizard.start')}
              </button>
            ) : (
              <button
                type="button"
                className="dl-action-btn dl-action-btn-accent"
                disabled={busy || emptyCatalog}
                onClick={goNext}
              >
                {t('install.wizard.next')}
              </button>
            )}
          </div>
        </div>
      </div>

      <InstallLocationModal
        open={pickerOpen}
        title={t('modal.install.title', { game: title })}
        description={t('modal.install.hint')}
        primaryLabel={t('modal.install.confirm')}
        onCancel={() => {
          setPickerOpen(false);
          setPendingJobs(null);
        }}
        onConfirm={onLibraryPicked}
      />
    </>,
    document.body,
  );
}

function OptionRadioRow({
  id,
  name,
  checked,
  label,
  disabled,
  onSelect,
}: {
  id: string;
  name: string;
  checked: boolean;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="install-wizard-option-row">
      <label htmlFor={id} className="install-wizard-option-label">
        <input
          id={id}
          type="radio"
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
        />
        <span className="install-wizard-section-name">{label}</span>
      </label>
    </li>
  );
}

function HostChip({ download }: { download: GameDownload }) {
  const color = HOST_COLORS[download.host] ?? 'var(--text-muted)';
  const labelText = download.text?.trim() || download.host;
  const showHost = shouldShowHostBadge(labelText, download.host);
  return (
    <span className="install-wizard-host-chip">
      <span
        className="dl-item-dot"
        style={{ background: color }}
        aria-hidden
      />
      <span className="install-wizard-host-chip-label" title={labelText}>
        {labelText}
      </span>
      {showHost && (
        <span className="dl-item-host">{download.host}</span>
      )}
    </span>
  );
}

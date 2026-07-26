import { useEffect, useMemo, useState } from 'react';
import type { GameDownload } from '../../types/game';
import type { InstallLibraryWithDisk } from '../../types/install-library';
import * as downloads from '../../lib/downloads';
import * as ipc from '../../lib/ipc';
import * as libraries from '../../lib/libraries';
import * as library from '../../lib/library';
import {
  attachDownload,
  createPlan,
  type CreatePlanJobInput,
} from '../../lib/installPlans';
import {
  buildInstallSections,
  detectInstallPlatform,
  pickPreferredHost,
  type InstallSection,
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
}

type WizardStep = 1 | 2;

function kindKey(kind: SectionKind): string {
  return `install.kind.${kind}`;
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
}: InstallPlanWizardProps) {
  const { t } = useT();
  const { isOffline } = useOffline();

  const platform = useMemo(() => detectInstallPlatform(), []);
  const sections = useMemo(
    () => buildInstallSections(links, platform),
    [links, platform],
  );

  const [step, setStep] = useState<WizardStep>(1);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [hosts, setHosts] = useState<Record<string, GameDownload>>({});
  const [changingLabel, setChangingLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingJobs, setPendingJobs] = useState<CreatePlanJobInput[] | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const nextChecked: Record<string, boolean> = {};
    for (const s of sections) {
      nextChecked[s.label] = s.defaultChecked;
    }
    setChecked(nextChecked);
    setHosts({});
    setChangingLabel(null);
    setStep(1);
    setBusy(false);
    setPickerOpen(false);
    setPendingJobs(null);
  }, [open, sections]);

  if (!open) return null;

  const heading =
    intent === 'update'
      ? t('library.install.modalTitleUpdate', { title })
      : t('install.wizard.title', { title });

  const checkedSections = sections.filter((s) => checked[s.label]);

  function toggleSection(label: string) {
    setChecked((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function goToHosts() {
    if (checkedSections.length === 0) {
      void dialog.alert(t('install.wizard.noSelection'), { kind: 'info' });
      return;
    }
    const nextHosts: Record<string, GameDownload> = { ...hosts };
    for (const s of checkedSections) {
      if (!nextHosts[s.label]) {
        const preferred = pickPreferredHost(s.links);
        if (preferred) nextHosts[s.label] = preferred;
      }
    }
    setHosts(nextHosts);
    setChangingLabel(null);
    setStep(2);
  }

  function buildJobs(): CreatePlanJobInput[] | null {
    const jobs: CreatePlanJobInput[] = [];
    let sortOrder = 0;
    for (const s of checkedSections) {
      const link = hosts[s.label] ?? pickPreferredHost(s.links);
      if (!link) {
        void dialog.alert(
          t('install.wizard.noHost', { section: s.label }),
          { kind: 'error' },
        );
        return null;
      }
      jobs.push({
        sectionLabel: s.label,
        sectionKind: s.kind,
        sourceUrl: link.url,
        host: link.host,
        sortOrder: sortOrder++,
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
    try {
      await prepareStart?.();
      await library.setStatus(threadId, 'downloading');

      const { jobs: createdJobs } = await createPlan({
        threadId,
        intent,
        jobs,
      });

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
      }

      onStarted?.();
      onClose();
    } catch (err) {
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
    if (libs.length <= 1) {
      await enqueuePlan(jobs, libs[0]?.path);
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

  return (
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

          {step === 1 ? (
            <>
              <p className="install-wizard-step-label">
                {t('install.wizard.chooseParts')}
              </p>
              {sections.length === 0 ? (
                <p className="dl-meta-text">{t('dl.empty')}</p>
              ) : (
                <ul className="install-wizard-section-list">
                  {sections.map((s) => (
                    <SectionCheckRow
                      key={s.label}
                      section={s}
                      checked={!!checked[s.label]}
                      onToggle={() => toggleSection(s.label)}
                      kindLabel={t(kindKey(s.kind))}
                    />
                  ))}
                </ul>
              )}
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
                <button
                  type="button"
                  className="dl-action-btn"
                  disabled={busy}
                  onClick={onClose}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="dl-action-btn dl-action-btn-accent"
                  disabled={busy || sections.length === 0}
                  onClick={goToHosts}
                >
                  {t('install.wizard.next')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="install-wizard-step-label">
                {t('install.wizard.confirmHosts')}
              </p>
              <ul className="install-wizard-host-list">
                {checkedSections.map((s) => {
                  const selected = hosts[s.label] ?? pickPreferredHost(s.links);
                  const isChanging = changingLabel === s.label;
                  return (
                    <li key={s.label} className="install-wizard-host-row">
                      <div className="install-wizard-host-head">
                        <div className="install-wizard-host-title">
                          <span className="install-wizard-section-name">
                            {s.label}
                          </span>
                          <span
                            className={`install-wizard-kind install-wizard-kind--${s.kind}`}
                          >
                            {t(kindKey(s.kind))}
                          </span>
                        </div>
                        {!isChanging && selected && (
                          <div className="install-wizard-host-pick">
                            <HostChip download={selected} />
                            <button
                              type="button"
                              className="dl-action-btn"
                              disabled={busy}
                              onClick={() => setChangingLabel(s.label)}
                            >
                              {t('install.wizard.changeHost')}
                            </button>
                          </div>
                        )}
                        {!isChanging && !selected && (
                          <span className="install-assign-error">
                            {t('install.wizard.noHost', { section: s.label })}
                          </span>
                        )}
                      </div>
                      {isChanging && (
                        <ul className="install-wizard-host-options">
                          {s.links.map((link) => {
                            const active = selected?.url === link.url;
                            return (
                              <li key={`${s.label}\0${link.url}`}>
                                <button
                                  type="button"
                                  className={`install-wizard-host-option${active ? ' is-active' : ''}`}
                                  disabled={busy}
                                  onClick={() => {
                                    setHosts((prev) => ({
                                      ...prev,
                                      [s.label]: link,
                                    }));
                                    setChangingLabel(null);
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
                <button
                  type="button"
                  className="dl-action-btn"
                  disabled={busy}
                  onClick={() => {
                    setChangingLabel(null);
                    setStep(1);
                  }}
                >
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  className="dl-action-btn dl-action-btn-accent"
                  disabled={busy || checkedSections.length === 0}
                  onClick={() => void onStart()}
                >
                  {busy ? '…' : t('install.wizard.start')}
                </button>
              </div>
            </>
          )}
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
    </>
  );
}

function SectionCheckRow({
  section,
  checked,
  onToggle,
  kindLabel,
}: {
  section: InstallSection;
  checked: boolean;
  onToggle: () => void;
  kindLabel: string;
}) {
  const id = `install-section-${section.label}`;
  return (
    <li className="install-wizard-section-row">
      <label htmlFor={id} className="install-wizard-section-label">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
        />
        <span className="install-wizard-section-name">{section.label}</span>
        <span
          className={`install-wizard-kind install-wizard-kind--${section.kind}`}
        >
          {kindLabel}
        </span>
        <span className="install-wizard-host-count">
          {section.links.length}
        </span>
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { SaveSlotList } from './SaveSlotList';
import { SaveVarTree } from './SaveVarTree';
import { SaveEditPanel } from './SaveEditPanel';
import { UnityUnlockPanel } from './UnityUnlockPanel';
import { RpgmEditorTabs } from './rpgm/RpgmEditorTabs';
import type { SaveEditorSlot } from './unitySlotUi';
import { LoadingState } from '../../ui/LoadingState';
import { useRunningGames } from '../../../contexts/RunningGames';
import { dialog } from '../../../lib/dialog';
import { useT } from '../../../lib/i18n';
import { formatIpcError } from '../../../lib/ipcError';
import * as ipc from '../../../lib/ipc';
import * as library from '../../../lib/library';
import {
  resolveSaveEditorEngine,
  type SaveEditorEngine,
} from '../../../lib/saveEditorGate';
import {
  collectSaveEditorInstallRoots,
  defaultSaveEditorInstallRoot,
  type SaveEditorInstallRoot,
} from '../../../lib/saveEditorInstallRoots';
import type { LibraryGame } from '../../../types/library';
import type { ExtraSaveRoot } from '../../../types/renpySave';
import type {
  RenpySaveBackup,
  RenpySavePatch,
  RenpyVarNode,
} from '../../../types/renpySave';
import './saveEditor.css';

interface Props {
  game: LibraryGame;
  onClose: () => void;
  /** Optional prefetched F95 developer (otherwise fetched via gameDetail). */
  developer?: string | null;
}

function findNode(root: RenpyVarNode | null, path: string): RenpyVarNode | null {
  if (!root) return null;
  if (root.path === path) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, path);
    if (hit) return hit;
  }
  return null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return Object.is(a, b);
}

export function SaveEditor({ game, onClose, developer: developerProp }: Props) {
  const { t } = useT();
  const { running } = useRunningGames();
  const isRunning = running.has(game.threadId);

  const [installRoots, setInstallRoots] = useState<SaveEditorInstallRoot[]>(() =>
    collectSaveEditorInstallRoots([], game.installPath),
  );
  const [installPath, setInstallPath] = useState<string | null>(game.installPath);
  const [rootsReady, setRootsReady] = useState(false);

  const [engine, setEngine] = useState<SaveEditorEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);

  const [developer, setDeveloper] = useState<string | null>(developerProp ?? null);
  const [unityMetaReady, setUnityMetaReady] = useState(developerProp !== undefined);
  const [localLowDir, setLocalLowDir] = useState<string | null>(null);
  const [unityCompany, setUnityCompany] = useState<string | null>(null);
  const [unityProduct, setUnityProduct] = useState<string | null>(null);

  const [slots, setSlots] = useState<SaveEditorSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [extraRoots, setExtraRoots] = useState<library.LibrarySaveExtraRoot[]>([]);
  const [extraRootsReady, setExtraRootsReady] = useState(false);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Slot key the currently displayed tree/backups belong to (null while loading or idle). */
  const [treeSlotKey, setTreeSlotKey] = useState<string | null>(null);
  const [tree, setTree] = useState<RenpyVarNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const treeLoadGenRef = useRef(0);
  const slotsLoadGenRef = useRef(0);
  const selectedKeyRef = useRef<string | null>(null);
  selectedKeyRef.current = selectedKey;
  const sessionPasswordsRef = useRef(new Map<string, string>());

  const [search, setSearch] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [patches, setPatches] = useState<Map<string, unknown>>(() => new Map());

  const [backups, setBackups] = useState<RenpySaveBackup[]>([]);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const treeMatchesSelection = treeSlotKey != null && treeSlotKey === selectedKey;
  const dirtyCount = patches.size;
  const selectedNode = useMemo(
    () => (selectedPath && treeMatchesSelection ? findNode(tree, selectedPath) : null),
    [tree, selectedPath, treeMatchesSelection],
  );

  const draftValue = useMemo(() => {
    if (!selectedNode) return undefined;
    if (patches.has(selectedNode.path)) return patches.get(selectedNode.path);
    return selectedNode.value;
  }, [selectedNode, patches]);

  const dirtyPaths = useMemo(() => new Set(patches.keys()), [patches]);

  const installStatus = game.installStatus;
  /** Stable key so parent re-renders with a new `storeTags` array don't remount the engine. */
  const storeTagsKey = (game.storeTags ?? []).join('\0');
  const extraRootsArg = useMemo<ExtraSaveRoot[]>(
    () => extraRoots.map((r) => ({ id: r.id, path: r.path })),
    [extraRoots],
  );
  const unityOpts = useMemo(
    () => ({ developer, title: game.title, extraRoots: extraRootsArg }),
    [developer, game.title, extraRootsArg],
  );

  useEffect(() => {
    return () => {
      sessionPasswordsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (developerProp !== undefined) {
      setDeveloper(developerProp);
    }
  }, [developerProp]);

  useEffect(() => {
    let cancelled = false;
    setRootsReady(false);
    void library
      .listExes(game.threadId)
      .then((exes) => {
        if (cancelled) return;
        const roots = collectSaveEditorInstallRoots(exes, game.installPath);
        setInstallRoots(roots);
        const preferred = defaultSaveEditorInstallRoot(roots, game.installPath);
        setInstallPath(preferred?.path ?? game.installPath);
      })
      .catch(() => {
        if (cancelled) return;
        const roots = collectSaveEditorInstallRoots([], game.installPath);
        setInstallRoots(roots);
        setInstallPath(game.installPath);
      })
      .finally(() => {
        if (!cancelled) setRootsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [game.threadId, game.installPath]);

  useEffect(() => {
    let cancelled = false;
    setExtraRootsReady(false);
    void library
      .listSaveExtraRoots(game.threadId)
      .then((roots) => {
        if (!cancelled) setExtraRoots(roots);
      })
      .catch(() => {
        if (!cancelled) setExtraRoots([]);
      })
      .finally(() => {
        if (!cancelled) setExtraRootsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [game.threadId]);

  useEffect(() => {
    if (!rootsReady) return;

    let cancelled = false;
    treeLoadGenRef.current += 1;
    slotsLoadGenRef.current += 1;
    setEngineReady(false);
    setEngine(null);
    setSlots([]);
    setSlotsLoading(true);
    setSlotsError(null);
    setSelectedKey(null);
    selectedKeyRef.current = null;
    setTree(null);
    setTreeSlotKey(null);
    setTreeLoading(false);
    setTreeError(null);
    setNeedsUnlock(false);
    setUnlockError(null);
    setSelectedPath(null);
    setPatches(new Map());
    setBackups([]);
    setActionError(null);
    setSearch('');
    setLocalLowDir(null);
    setUnityCompany(null);
    setUnityProduct(null);
    setUnityMetaReady(false);
    setDeveloper(developerProp !== undefined ? developerProp : null);
    sessionPasswordsRef.current.clear();

    if (!installPath) {
      setEngineReady(true);
      setSlotsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    void resolveSaveEditorEngine({
      installStatus,
      installPath,
      storeTags: game.storeTags,
    })
      .then((resolved) => {
        if (cancelled) return;
        setEngine(resolved);
      })
      .catch((err) => {
        if (cancelled) return;
        setEngine(null);
        setSlotsError(formatIpcError(err));
      })
      .finally(() => {
        if (!cancelled) setEngineReady(true);
      });

    return () => {
      cancelled = true;
    };
    // Seed developer from prop when the install identity changes; late prefetch
    // updates via the sync effect + Unity meta effect without remounting the engine.
    // storeTagsKey: content-stable so new array identities from parent refreshes
    // do not re-probe and leave the UI stuck on "Loading saves…".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootsReady, installPath, installStatus, storeTagsKey]);

  useEffect(() => {
    if (!engineReady || engine !== 'unity' || !installPath) {
      if (engineReady && engine !== 'unity') {
        setUnityMetaReady(true);
        setLocalLowDir(null);
        setUnityCompany(null);
        setUnityProduct(null);
      }
      return;
    }

    let cancelled = false;
    setUnityMetaReady(developerProp !== undefined);

    const loadDeveloper =
      developerProp !== undefined
        ? Promise.resolve(developerProp)
        : ipc
            .gameDetail(game.threadId)
            .then((detail) => detail.developer ?? null)
            .catch(() => null);

    void (async () => {
      const dev = await loadDeveloper;
      if (cancelled) return;
      setDeveloper(dev);
      try {
        const probe = await ipc.unitySavesProbe(installPath, {
          developer: dev,
          title: game.title,
        });
        if (cancelled) return;
        setLocalLowDir(probe.localLowDir);
        setUnityCompany(probe.company);
        setUnityProduct(probe.product);
      } catch {
        if (cancelled) return;
        setLocalLowDir(null);
        setUnityCompany(null);
        setUnityProduct(null);
      } finally {
        if (!cancelled) setUnityMetaReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [engine, engineReady, installPath, game.threadId, game.title, developerProp]);

  const switchInstallPath = useCallback(
    async (nextPath: string) => {
      if (nextPath === installPath) return;
      if (dirtyCount > 0) {
        const ok = await dialog.confirm(t('saveEditor.discardConfirm'), {
          title: t('saveEditor.discardTitle'),
          kind: 'warning',
          confirmLabel: t('common.confirm'),
          cancelLabel: t('common.cancel'),
        });
        if (!ok) return;
      }
      setInstallPath(nextPath);
    },
    [installPath, dirtyCount, t],
  );

  const loadSlots = useCallback(async () => {
    if (!installPath || !engineReady || !extraRootsReady) {
      return;
    }
    if (!engine) {
      setSlots([]);
      setSlotsLoading(false);
      setSlotsError(null);
      return;
    }
    if (engine === 'unity' && !unityMetaReady) {
      return;
    }
    // Separate from treeLoadGenRef so selecting/reading a slot cannot leave
    // the slot list stuck on "Loading saves…".
    const generation = ++slotsLoadGenRef.current;
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const list =
        engine === 'rpgm'
          ? await ipc.rpgmSavesList(installPath, extraRootsArg)
          : engine === 'unity'
            ? await ipc.unitySavesList(installPath, unityOpts)
            : await ipc.renpySavesList(installPath, extraRootsArg);
      if (generation !== slotsLoadGenRef.current) return;
      setSlots(list);
    } catch (err) {
      if (generation !== slotsLoadGenRef.current) return;
      setSlots([]);
      setSlotsError(formatIpcError(err));
    } finally {
      if (generation === slotsLoadGenRef.current) {
        setSlotsLoading(false);
      }
    }
  }, [
    installPath,
    engine,
    engineReady,
    extraRootsReady,
    unityMetaReady,
    unityOpts,
    extraRootsArg,
  ]);

  const loadBackups = useCallback(
    async (slotKey: string, generation: number) => {
      if (!engine) return;
      try {
        const list =
          engine === 'rpgm'
            ? await ipc.rpgmSaveBackupsList({
                threadId: game.threadId,
                slotKey,
              })
            : engine === 'unity'
              ? await ipc.unitySaveBackupsList({
                  threadId: game.threadId,
                  slotKey,
                })
              : await ipc.renpySaveBackupsList({
                  threadId: game.threadId,
                  slotKey,
                });
        if (generation !== treeLoadGenRef.current) return;
        setBackups(list);
      } catch {
        if (generation !== treeLoadGenRef.current) return;
        setBackups([]);
      }
    },
    [game.threadId, engine],
  );

  const loadTree = useCallback(
    async (slotKey: string) => {
      if (!installPath || !engine) return;
      const generation = ++treeLoadGenRef.current;
      setTreeLoading(true);
      setTreeError(null);
      setTree(null);
      setTreeSlotKey(null);
      setSelectedPath(null);
      setBackups([]);
      setNeedsUnlock(false);
      setUnlockError(null);
      try {
        if (engine === 'unity') {
          const password = sessionPasswordsRef.current.get(slotKey) ?? null;
          const result = await ipc.unitySaveRead({
            installPath,
            slotKey,
            ...unityOpts,
            password,
          });
          if (generation !== treeLoadGenRef.current || selectedKeyRef.current !== slotKey) {
            return;
          }
          if (result.needsPassword || !result.tree) {
            setTree(null);
            setTreeSlotKey(null);
            setNeedsUnlock(true);
            setBackups([]);
            return;
          }
          setTree(result.tree);
          setTreeSlotKey(slotKey);
          setNeedsUnlock(false);
          await loadBackups(slotKey, generation);
          return;
        }

        const root =
          engine === 'rpgm'
            ? await ipc.rpgmSaveRead({ installPath, slotKey, extraRoots: extraRootsArg })
            : await ipc.renpySaveRead({ installPath, slotKey, extraRoots: extraRootsArg });
        if (generation !== treeLoadGenRef.current || selectedKeyRef.current !== slotKey) return;
        setTree(root);
        setTreeSlotKey(slotKey);
        await loadBackups(slotKey, generation);
      } catch (err) {
        if (generation !== treeLoadGenRef.current || selectedKeyRef.current !== slotKey) return;
        setTree(null);
        setTreeSlotKey(null);
        setNeedsUnlock(false);
        setTreeError(formatIpcError(err));
        setBackups([]);
      } finally {
        if (generation === treeLoadGenRef.current) {
          setTreeLoading(false);
        }
      }
    },
    [installPath, engine, loadBackups, unityOpts, extraRootsArg],
  );

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const confirmDiscardIfDirty = useCallback(async (): Promise<boolean> => {
    if (patches.size === 0) return true;
    return dialog.confirm(t('saveEditor.discardConfirm'), {
      title: t('saveEditor.discardTitle'),
      kind: 'warning',
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
    });
  }, [patches.size, t]);

  const selectSlot = useCallback(
    async (slot: SaveEditorSlot) => {
      if (slot.key === selectedKey) return;
      const ok = await confirmDiscardIfDirty();
      if (!ok) return;
      setPatches(new Map());
      setSearch('');
      setActionError(null);
      setUnlockError(null);
      selectedKeyRef.current = slot.key;
      setSelectedKey(slot.key);
      await loadTree(slot.key);
    },
    [selectedKey, confirmDiscardIfDirty, loadTree],
  );

  const handleUnlock = useCallback(
    async (password: string) => {
      if (!installPath || engine !== 'unity' || !selectedKey) return;
      const slotKey = selectedKey;
      const generation = treeLoadGenRef.current;
      setUnlocking(true);
      setUnlockError(null);
      setActionError(null);
      try {
        const result = await ipc.unitySaveRead({
          installPath,
          slotKey,
          ...unityOpts,
          password,
        });
        if (selectedKeyRef.current !== slotKey || generation !== treeLoadGenRef.current) {
          return;
        }
        if (result.needsPassword || !result.tree) {
          setUnlockError(t('error.saveEditor.unity.badPassword'));
          return;
        }
        sessionPasswordsRef.current.set(slotKey, password);
        setTree(result.tree);
        setTreeSlotKey(slotKey);
        setNeedsUnlock(false);
        setUnlockError(null);
        await loadBackups(slotKey, generation);
      } catch (err) {
        if (selectedKeyRef.current === slotKey) {
          setUnlockError(formatIpcError(err));
        }
      } finally {
        setUnlocking(false);
      }
    },
    [installPath, engine, selectedKey, unityOpts, loadBackups, t],
  );

  const handleClose = useCallback(async () => {
    const ok = await confirmDiscardIfDirty();
    if (ok) onClose();
  }, [confirmDiscardIfDirty, onClose]);

  const handleSelectVar = useCallback((node: RenpyVarNode) => {
    if (!node.editable) return;
    setSelectedPath(node.path);
  }, []);

  const handleSelectPath = useCallback(
    (path: string) => {
      const node = findNode(tree, path);
      if (!node?.editable) return;
      setSelectedPath(path);
    },
    [tree],
  );

  const handleDraftChange = useCallback(
    (value: unknown) => {
      if (!selectedNode?.editable) return;
      const path = selectedNode.path;
      const original = selectedNode.value;
      setPatches((prev) => {
        const next = new Map(prev);
        if (valuesEqual(value, original)) next.delete(path);
        else next.set(path, value);
        return next;
      });
    },
    [selectedNode],
  );

  const handlePatch = useCallback(
    (path: string, value: unknown) => {
      if (!treeMatchesSelection || !tree || isRunning) return;
      const node = findNode(tree, path);
      if (!node?.editable) return;
      const original = node.value;
      setPatches((prev) => {
        const next = new Map(prev);
        if (valuesEqual(value, original)) next.delete(path);
        else next.set(path, value);
        return next;
      });
    },
    [tree, treeMatchesSelection, isRunning],
  );

  const handleApply = useCallback(async () => {
    if (
      !installPath ||
      !engine ||
      !selectedKey ||
      patches.size === 0 ||
      isRunning ||
      treeSlotKey !== selectedKey
    ) {
      return;
    }
    const slotKey = selectedKey;
    const generation = treeLoadGenRef.current;
    setApplying(true);
    setActionError(null);
    const patchList: RenpySavePatch[] = [...patches.entries()].map(([path, value]) => ({
      path,
      value,
    }));
    const writeArgs = {
      threadId: game.threadId,
      installPath,
      slotKey,
      patches: patchList,
      extraRoots: extraRootsArg,
    };
    try {
      const root =
        engine === 'rpgm'
          ? await ipc.rpgmSaveWrite(writeArgs)
          : engine === 'unity'
            ? await ipc.unitySaveWrite({
                ...writeArgs,
                ...unityOpts,
                password: sessionPasswordsRef.current.get(slotKey) ?? null,
              })
            : await ipc.renpySaveWrite(writeArgs);
      if (selectedKeyRef.current !== slotKey || generation !== treeLoadGenRef.current) return;
      setTree(root);
      setTreeSlotKey(slotKey);
      setPatches(new Map());
      await loadBackups(slotKey, generation);
    } catch (err) {
      if (selectedKeyRef.current === slotKey) {
        setActionError(formatIpcError(err));
      }
    } finally {
      setApplying(false);
    }
  }, [
    installPath,
    engine,
    selectedKey,
    treeSlotKey,
    patches,
    isRunning,
    game.threadId,
    loadBackups,
    unityOpts,
    extraRootsArg,
  ]);

  const handleRestore = useCallback(
    async (backup: RenpySaveBackup) => {
      if (!installPath || !engine || !selectedKey || isRunning || treeSlotKey !== selectedKey) {
        return;
      }
      const slotKey = selectedKey;
      const ok = await dialog.confirm(
        t('saveEditor.restoreConfirm', { name: backup.fileName }),
        {
          title: t('saveEditor.restoreTitle'),
          kind: 'warning',
          confirmLabel: t('saveEditor.restore'),
          cancelLabel: t('common.cancel'),
        },
      );
      if (!ok || selectedKeyRef.current !== slotKey) return;

      const discardOk = await confirmDiscardIfDirty();
      if (!discardOk || selectedKeyRef.current !== slotKey) return;

      setRestoring(backup.fileName);
      setActionError(null);
      const restoreArgs = {
        threadId: game.threadId,
        installPath,
        slotKey,
        backupFileName: backup.fileName,
        extraRoots: extraRootsArg,
      };
      try {
        if (engine === 'rpgm') {
          await ipc.rpgmSaveBackupRestore(restoreArgs);
        } else if (engine === 'unity') {
          await ipc.unitySaveBackupRestore({
            ...restoreArgs,
            ...unityOpts,
          });
        } else {
          await ipc.renpySaveBackupRestore(restoreArgs);
        }
        if (selectedKeyRef.current !== slotKey) return;
        setPatches(new Map());
        await loadTree(slotKey);
      } catch (err) {
        if (selectedKeyRef.current === slotKey) {
          setActionError(formatIpcError(err));
        }
      } finally {
        setRestoring(null);
      }
    },
    [
      installPath,
      engine,
      selectedKey,
      treeSlotKey,
      isRunning,
      t,
      confirmDiscardIfDirty,
      game.threadId,
      loadTree,
      unityOpts,
      extraRootsArg,
    ],
  );

  const handleAddFolder = useCallback(async () => {
    const selected = await openFileDialog({
      multiple: false,
      directory: true,
      title: t('saveEditor.extraFolder.pickTitle'),
    });
    if (!selected || typeof selected !== 'string') return;
    try {
      const added = await library.addSaveExtraRoot(game.threadId, selected);
      setExtraRoots((prev) => [...prev, added]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'DUPLICATE_EXTRA_ROOT_PATH') {
        setActionError(t('saveEditor.extraFolder.duplicate'));
        return;
      }
      setActionError(formatIpcError(err));
    }
  }, [game.threadId, t]);

  const handleRemoveFolder = useCallback(
    async (id: string) => {
      try {
        await library.removeSaveExtraRoot(id);
        setExtraRoots((prev) => prev.filter((r) => r.id !== id));
        if (selectedKey?.startsWith(`extra:${id}/`)) {
          setSelectedKey(null);
          selectedKeyRef.current = null;
          setTree(null);
          setTreeSlotKey(null);
          setPatches(new Map());
          setBackups([]);
          setNeedsUnlock(false);
        }
      } catch (err) {
        setActionError(formatIpcError(err));
      }
    },
    [selectedKey],
  );

  if (!installPath) {
    return (
      <div className="save-editor">
        <header className="save-editor-head">
          <button type="button" className="save-editor-back" onClick={onClose}>
            ← {t('saveEditor.back')}
          </button>
          <div className="save-editor-head-center">
            <h1 className="save-editor-title">{t('saveEditor.title')}</h1>
          </div>
        </header>
        <p className="save-editor-empty">{t('saveEditor.noInstallPath')}</p>
      </div>
    );
  }

  const waitingUnityMeta = engine === 'unity' && !unityMetaReady;
  const waitingRoots = !rootsReady;
  const unityIdentity =
    unityCompany && unityProduct ? `${unityCompany}/${unityProduct}` : null;

  return (
    <div className="save-editor">
      <header className="save-editor-head">
        <button type="button" className="save-editor-back" onClick={() => void handleClose()}>
          ← {t('saveEditor.back')}
        </button>
        <div className="save-editor-head-center">
          <h1 className="save-editor-title">{t('saveEditor.title')}</h1>
          <span className="save-editor-subtitle" title={game.title}>
            {game.title}
          </span>
          {installRoots.length > 1 && (
            <label className="save-editor-install-picker">
              <span className="save-editor-install-picker-label">
                {t('saveEditor.installRoot')}
              </span>
              <select
                className="save-editor-install-select"
                value={installPath}
                disabled={isRunning || applying || restoring != null}
                onChange={(e) => void switchInstallPath(e.target.value)}
                title={installPath}
              >
                {installRoots.map((root) => (
                  <option key={root.key} value={root.path} title={root.path}>
                    {root.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {engine === 'unity' && unityIdentity && (
            <span className="save-editor-roots-hint" title={unityIdentity}>
              {t('saveEditor.unity.productHint', { identity: unityIdentity })}
            </span>
          )}
          {engine === 'unity' && localLowDir && (
            <span className="save-editor-roots-hint" title={localLowDir}>
              {t('saveEditor.unity.rootsHint', { path: localLowDir })}
            </span>
          )}
        </div>
      </header>

      {isRunning && <div className="save-editor-banner">{t('saveEditor.running')}</div>}
      {(slotsError || treeError || actionError) && (
        <div className="save-editor-error">{slotsError || treeError || actionError}</div>
      )}

      {waitingRoots || !engineReady || !extraRootsReady || waitingUnityMeta ? (
        <div className="save-editor-status">
          <LoadingState label={t('saveEditor.loadingSlots')} variant="compact" />
        </div>
      ) : (
        <div className="save-editor-body">
          <SaveSlotList
            slots={slots}
            selectedKey={selectedKey}
            onSelect={(slot) => void selectSlot(slot)}
            extraRoots={extraRoots}
            onAddFolder={() => void handleAddFolder()}
            onRemoveFolder={(id) => void handleRemoveFolder(id)}
            busy={isRunning || applying || restoring != null || slotsLoading}
            loading={slotsLoading}
            emptyHint={
              slots.length === 0 && !slotsError && !slotsLoading
                ? engine === 'unity'
                  ? t('saveEditor.unity.emptyHint')
                  : t('saveEditor.emptyHint')
                : null
            }
          />
          {slotsLoading && slots.length === 0 ? null : treeLoading ? (
            <div className="save-editor-col">
              <div className="save-editor-col-head">{t('saveEditor.search')}</div>
              <div className="save-editor-status">
                <LoadingState label={t('saveEditor.loadingTree')} variant="compact" />
              </div>
            </div>
          ) : needsUnlock && selectedKey ? (
            <UnityUnlockPanel
              key={selectedKey}
              unlocking={unlocking}
              error={unlockError}
              disabled={isRunning}
              onUnlock={(password) => void handleUnlock(password)}
            />
          ) : engine === 'rpgm' && tree && treeMatchesSelection ? (
            <RpgmEditorTabs
              key={treeSlotKey}
              tree={tree}
              patches={patches}
              dirtyPaths={dirtyPaths}
              onPatch={handlePatch}
              search={search}
              onSearch={setSearch}
              selectedPath={selectedPath}
              onSelectPath={handleSelectPath}
              selectedNode={selectedNode}
              draftValue={draftValue}
              onDraft={handleDraftChange}
              disabled={isRunning}
            />
          ) : (
            <SaveVarTree
              root={tree}
              search={search}
              onSearchChange={setSearch}
              selectedPath={selectedPath}
              dirtyPaths={dirtyPaths}
              onSelect={handleSelectVar}
            />
          )}
          <SaveEditPanel
            selected={treeMatchesSelection ? selectedNode : null}
            draftValue={draftValue}
            onDraftChange={handleDraftChange}
            dirtyCount={treeMatchesSelection ? dirtyCount : 0}
            applying={applying}
            readOnly={isRunning || !treeMatchesSelection}
            restoreDisabled={isRunning || !treeMatchesSelection}
            applyDisabled={isRunning || !treeMatchesSelection}
            onApply={() => void handleApply()}
            backups={treeMatchesSelection ? backups : []}
            restoring={restoring}
            onRestore={(b) => void handleRestore(b)}
          />
        </div>
      )}
    </div>
  );
}

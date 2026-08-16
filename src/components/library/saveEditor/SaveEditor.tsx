import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  resolveSaveEditorEngine,
  type SaveEditorEngine,
} from '../../../lib/saveEditorGate';
import type { LibraryGame } from '../../../types/library';
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
  const installPath = game.installPath;

  const [engine, setEngine] = useState<SaveEditorEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);

  const [developer, setDeveloper] = useState<string | null>(developerProp ?? null);
  const [unityMetaReady, setUnityMetaReady] = useState(developerProp !== undefined);
  const [localLowDir, setLocalLowDir] = useState<string | null>(null);

  const [slots, setSlots] = useState<SaveEditorSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);

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
  const storeTags = game.storeTags;
  const unityOpts = useMemo(
    () => ({ developer, title: game.title }),
    [developer, game.title],
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
    treeLoadGenRef.current += 1;
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
      storeTags,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installPath, installStatus, storeTags]);

  useEffect(() => {
    if (!engineReady || engine !== 'unity' || !installPath) {
      if (engineReady && engine !== 'unity') {
        setUnityMetaReady(true);
        setLocalLowDir(null);
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
      } catch {
        if (cancelled) return;
        setLocalLowDir(null);
      } finally {
        if (!cancelled) setUnityMetaReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [engine, engineReady, installPath, game.threadId, game.title, developerProp]);

  const loadSlots = useCallback(async () => {
    if (!installPath || !engineReady) {
      if (!installPath) {
        setSlots([]);
        setSlotsLoading(false);
        setSlotsError(null);
      }
      return;
    }
    if (!engine) {
      setSlots([]);
      setSlotsLoading(false);
      setSlotsError(null);
      return;
    }
    if (engine === 'unity' && !unityMetaReady) {
      setSlotsLoading(true);
      return;
    }
    // Capture gen bumped by engine re-resolve so a stale list cannot overwrite.
    const generation = treeLoadGenRef.current;
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const list =
        engine === 'rpgm'
          ? await ipc.rpgmSavesList(installPath)
          : engine === 'unity'
            ? await ipc.unitySavesList(installPath, unityOpts)
            : await ipc.renpySavesList(installPath);
      if (generation !== treeLoadGenRef.current) return;
      setSlots(list);
    } catch (err) {
      if (generation !== treeLoadGenRef.current) return;
      setSlots([]);
      setSlotsError(formatIpcError(err));
    } finally {
      if (generation === treeLoadGenRef.current) {
        setSlotsLoading(false);
      }
    }
  }, [installPath, engine, engineReady, unityMetaReady, unityOpts]);

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
            ? await ipc.rpgmSaveRead({ installPath, slotKey })
            : await ipc.renpySaveRead({ installPath, slotKey });
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
    [installPath, engine, loadBackups, unityOpts],
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
    ],
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

      {!engineReady || waitingUnityMeta || slotsLoading ? (
        <div className="save-editor-status">
          <LoadingState label={t('saveEditor.loadingSlots')} variant="compact" />
        </div>
      ) : slots.length === 0 && !slotsError ? (
        <div className="save-editor-empty">
          <p>{t('saveEditor.empty')}</p>
          <p className="save-editor-empty-hint">
            {engine === 'unity' ? t('saveEditor.unity.emptyHint') : t('saveEditor.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="save-editor-body">
          <SaveSlotList
            slots={slots}
            selectedKey={selectedKey}
            onSelect={(slot) => void selectSlot(slot)}
          />
          {treeLoading ? (
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

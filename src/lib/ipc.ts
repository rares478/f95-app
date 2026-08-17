import { invoke } from '@tauri-apps/api/core';
import type { ProfileDto, PaginatedActivity, PaginatedProfilePosts } from '../types';
import type { SamFilters, SamOptionsResult, SamPage } from '../types/sam';
import type { SamCategory } from '../types/sam';
import type { GameDetail } from '../types/game';
import type { ForumSearchPage } from '../types/forumSearch';
import type {
  BbcodePreviewResult,
  ResolveF95UrlResult,
  ResolvePostResult,
  ThreadPostsPage,
  ThreadReplyResult,
} from '../types/threadPosts';
import type { CbzPreviewResult, InstallMediaIndex } from '../types/media';
import type { F95AlertsListResult, F95AlertsPopupResult } from '../types/alerts';
import type { FollowedUser } from '../types/social';
import type { RssFeed, RssFeedOptions } from '../types/rss';
import type { RunningInfo } from '../types/session';
import type {
  OverlayAnchorStatus,
  OverlayCompactGeom,
  OverlayContext,
  OverlayLayout,
} from '../types/overlay';
import type {
  ExtraSaveRoot,
  RenpyProbeResult,
  RenpySaveBackup,
  RenpySavePatch,
  RenpySaveSlot,
  RenpyVarNode,
} from '../types/renpySave';
import type { RpgmProbeResult } from '../types/rpgmSave';
import type { WolfProbeResult } from '../types/wolfSave';
import type {
  UnityProbeResult,
  UnitySaveReadResult,
  UnitySaveSlot,
} from '../types/unitySave';
import * as settings from './settings';
import {
  rememberDownloadLibrary,
  resolveDownloadLibraryPath,
} from './downloadLibraryPath';
import {
  getExperimentalSettings,
  loadExperimentalSettings,
} from './experimentalSettings';

export async function login(username: string, password: string): Promise<void> {
  await invoke<void>('login', { username, password });
}

export async function isLoggedIn(): Promise<boolean> {
  return invoke<boolean>('is_logged_in');
}

export async function hasLocalSession(): Promise<boolean> {
  return invoke<boolean>('has_local_session');
}

export interface NetworkStatus {
  internet: boolean;
  f95Reachable: boolean;
}

export async function checkNetwork(): Promise<NetworkStatus> {
  return invoke<NetworkStatus>('check_network');
}

export async function logout(): Promise<void> {
  await invoke<void>('logout');
}

export async function samList(filters: SamFilters): Promise<SamPage> {
  return invoke<SamPage>('sam_list', { filters });
}

export async function samOptions(category: SamCategory): Promise<SamOptionsResult> {
  return invoke<SamOptionsResult>('sam_options', { category });
}

export async function gameDetail(threadId: string): Promise<GameDetail> {
  return invoke<GameDetail>('game_detail', { threadId });
}

export async function forumSearch(params: {
  query: string;
  titleOnly?: boolean;
  searchIn?: 'titles' | 'posts';
  sort?: 'relevance' | 'date';
  page?: number;
}): Promise<ForumSearchPage> {
  return invoke<ForumSearchPage>('forum_search', {
    query: params.query,
    titleOnly: params.titleOnly ?? false,
    searchIn: params.searchIn ?? 'posts',
    sort: params.sort ?? 'relevance',
    page: params.page ?? 1,
  });
}

export async function threadPosts(threadId: string, page = 1): Promise<ThreadPostsPage> {
  return invoke<ThreadPostsPage>('thread_posts', { threadId, page });
}

export async function threadReply(
  threadId: string,
  message: string,
): Promise<ThreadReplyResult> {
  return invoke<ThreadReplyResult>('thread_reply', { threadId, message });
}

export async function bbcodePreview(
  threadId: string,
  bbCode: string,
): Promise<BbcodePreviewResult> {
  return invoke<BbcodePreviewResult>('bbcode_preview', { threadId, bbCode });
}

export async function resolvePost(postId: string): Promise<ResolvePostResult> {
  return invoke<ResolvePostResult>('resolve_post', { postId });
}

/** Resolve any F95 thread/post URL to thread id, forum, and page (follows XF redirects). */
export async function resolveF95Url(url: string): Promise<ResolveF95UrlResult> {
  return invoke<ResolveF95UrlResult>('resolve_post', { url });
}

export async function getFollowing(): Promise<FollowedUser[]> {
  return invoke<FollowedUser[]>('get_following');
}

export async function getProfile(): Promise<ProfileDto> {
  return invoke<ProfileDto>('get_profile');
}

export async function getMemberProfile(userId: string): Promise<ProfileDto> {
  return invoke<ProfileDto>('get_member_profile', { userId });
}

export async function getMemberProfilePosts(
  userId: string,
  page = 1,
): Promise<PaginatedProfilePosts> {
  return invoke<PaginatedProfilePosts>('get_member_profile_posts', { userId, page });
}

export async function getMemberActivity(
  userId: string,
  page = 1,
): Promise<PaginatedActivity> {
  return invoke<PaginatedActivity>('get_member_activity', { userId, page });
}

export async function fetchRssFeed(options: RssFeedOptions = {}): Promise<RssFeed> {
  return invoke<RssFeed>('fetch_rss_feed', {
    category: options.category ?? 'games',
  });
}

export async function fetchAlertsPopup(): Promise<F95AlertsPopupResult> {
  return invoke<F95AlertsPopupResult>('fetch_alerts_popup');
}

export async function fetchAlertsList(page = 1): Promise<F95AlertsListResult> {
  return invoke<F95AlertsListResult>('fetch_alerts_list', { page });
}

async function ensureUploadhavenSession(): Promise<void> {
  const [cookies, email, isPro] = await Promise.all([
    settings.get(settings.KEY_UPLOADHAVEN_COOKIES),
    settings.get(settings.KEY_UPLOADHAVEN_EMAIL),
    settings.get(settings.KEY_UPLOADHAVEN_IS_PRO),
  ]);
  if (!cookies) return;
  await setUploadhavenSession({
    cookieHeader: cookies,
    email: email ?? undefined,
    isPro: isPro === '1' || isPro === 'true',
  });
}

async function ensureBuzzheavierAccount(): Promise<void> {
  const accountId = await settings.get(settings.KEY_BUZZHEAVIER_ACCOUNT_ID);
  if (!accountId) return;
  await setBuzzheavierAccount({ accountId });
}

export async function downloadStart(args: {
  id: number;
  sourceUrl: string;
  threadId: string;
  libraryPath?: string | null;
  /** F95 section label, e.g. "Win/Linux" — helps pick the PC file in multi-build folders. */
  platformGroup?: string | null;
}): Promise<void> {
  await ensureUploadhavenSession();
  await ensureBuzzheavierAccount();
  const libraryPath = await resolveDownloadLibraryPath(args.libraryPath);
  await rememberDownloadLibrary(args.id, libraryPath);
  return invoke('download_start', { ...args, libraryPath });
}

export async function downloadContinueChoice(args: {
  id: number;
  choiceId: string;
  threadId: string;
  libraryPath?: string | null;
}): Promise<void> {
  const libraryPath = await resolveDownloadLibraryPath(args.libraryPath);
  await rememberDownloadLibrary(args.id, libraryPath);
  return invoke('download_continue_choice', { ...args, libraryPath });
}

export async function downloadCancel(id: number): Promise<void> {
  return invoke('download_cancel', { id });
}

export async function openCaptchaWindow(args: {
  downloadId: number;
  url: string;
  host: string;
}): Promise<void> {
  return invoke('open_captcha_window', {
    downloadId: args.downloadId,
    url: args.url,
    host: args.host,
  });
}

export async function downloadContinueCaptcha(args: {
  id: number;
  sourceUrl: string;
  pageUrl: string;
  threadId: string;
  libraryPath?: string | null;
}): Promise<void> {
  const libraryPath = await resolveDownloadLibraryPath(args.libraryPath);
  await rememberDownloadLibrary(args.id, libraryPath);
  return invoke('download_continue_captcha', {
    id: args.id,
    sourceUrl: args.sourceUrl,
    pageUrl: args.pageUrl,
    threadId: args.threadId,
    libraryPath,
  });
}

export async function revealInExplorer(path: string): Promise<void> {
  return invoke('reveal_in_explorer', { path });
}

export interface ExtractResult {
  destDir: string;
  exePath: string | null;
}

export async function extractArchive(args: {
  archivePath: string;
  gameTitle: string;
  downloadId?: number | null;
  destDir?: string | null;
  preferHtml?: boolean;
}): Promise<ExtractResult> {
  return invoke<ExtractResult>('extract_archive', args);
}

export async function findMainExe(args: {
  root: string;
  gameTitle: string;
  preferHtml?: boolean;
}): Promise<string | null> {
  return invoke<string | null>('find_main_exe', args);
}

export async function deletePath(path: string): Promise<void> {
  return invoke('delete_path', { path });
}

export interface CreateShortcutsResult {
  desktop: boolean;
  startMenu: boolean;
  message: string;
}

export async function createGameShortcuts(args: {
  exePath: string;
  title: string;
}): Promise<CreateShortcutsResult> {
  return invoke<CreateShortcutsResult>('create_game_shortcuts', args);
}

export async function scanInstallMedia(args: {
  installPath: string;
  category: string;
}): Promise<InstallMediaIndex> {
  return invoke<InstallMediaIndex>('scan_install_media', args);
}

export async function resolveMediaPreview(args: {
  path: string;
  variant: 'thumb' | 'display';
}): Promise<string> {
  return invoke<string>('resolve_media_preview', args);
}

export async function resolveRemoteImagePreview(args: {
  url: string;
  variant: 'grid' | 'library';
}): Promise<string> {
  return invoke<string>('resolve_remote_image_preview', args);
}

export async function extractCbzPreview(args: {
  archivePath: string;
  maxPages?: number;
}): Promise<CbzPreviewResult> {
  return invoke<CbzPreviewResult>('extract_cbz_preview', args);
}

export async function launchGame(args: {
  threadId: string;
  title: string;
  exePath: string;
  sessionId: number;
}): Promise<number> {
  return invoke<number>('launch_game', args);
}

export async function stopGame(threadId: string): Promise<void> {
  return invoke('stop_game', { threadId });
}

export async function runningGames(): Promise<RunningInfo[]> {
  return invoke<RunningInfo[]>('running_games');
}

export interface MigrationResult {
  copied: number;
  bytes_copied: number;
  destinations: string[];
}

export async function migrateSaves(args: {
  oldInstallDir: string;
  newInstallDir: string;
}): Promise<MigrationResult> {
  return invoke<MigrationResult>('migrate_saves', args);
}

export async function renpySavesProbe(installPath: string): Promise<RenpyProbeResult> {
  return invoke<RenpyProbeResult>('renpy_saves_probe', { installPath });
}

export async function renpySavesList(
  installPath: string,
  extraRoots?: ExtraSaveRoot[],
): Promise<RenpySaveSlot[]> {
  return invoke<RenpySaveSlot[]>('renpy_saves_list', {
    installPath,
    extraRoots: extraRoots ?? null,
  });
}

export async function renpySaveRead(args: {
  installPath: string;
  slotKey: string;
  extraRoots?: ExtraSaveRoot[];
}): Promise<RenpyVarNode> {
  return invoke<RenpyVarNode>('renpy_save_read', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function renpySaveWrite(args: {
  threadId: string;
  installPath: string;
  slotKey: string;
  patches: RenpySavePatch[];
  extraRoots?: ExtraSaveRoot[];
}): Promise<RenpyVarNode> {
  return invoke<RenpyVarNode>('renpy_save_write', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function renpySaveBackupsList(args: {
  threadId: string;
  slotKey: string;
}): Promise<RenpySaveBackup[]> {
  return invoke<RenpySaveBackup[]>('renpy_save_backups_list', args);
}

export async function renpySaveBackupRestore(args: {
  threadId: string;
  installPath: string;
  slotKey: string;
  backupFileName: string;
  extraRoots?: ExtraSaveRoot[];
}): Promise<void> {
  return invoke<void>('renpy_save_backup_restore', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function rpgmSavesProbe(installPath: string): Promise<RpgmProbeResult> {
  return invoke<RpgmProbeResult>('rpgm_saves_probe', { installPath });
}

export async function rpgmSavesList(
  installPath: string,
  extraRoots?: ExtraSaveRoot[],
): Promise<RenpySaveSlot[]> {
  return invoke<RenpySaveSlot[]>('rpgm_saves_list', {
    installPath,
    extraRoots: extraRoots ?? null,
  });
}

export async function rpgmSaveRead(args: {
  installPath: string;
  slotKey: string;
  extraRoots?: ExtraSaveRoot[];
}): Promise<RenpyVarNode> {
  return invoke<RenpyVarNode>('rpgm_save_read', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function rpgmSaveWrite(args: {
  threadId: string;
  installPath: string;
  slotKey: string;
  patches: RenpySavePatch[];
  extraRoots?: ExtraSaveRoot[];
}): Promise<RenpyVarNode> {
  return invoke<RenpyVarNode>('rpgm_save_write', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function rpgmSaveBackupsList(args: {
  threadId: string;
  slotKey: string;
}): Promise<RenpySaveBackup[]> {
  return invoke<RenpySaveBackup[]>('rpgm_save_backups_list', args);
}

export async function rpgmSaveBackupRestore(args: {
  threadId: string;
  installPath: string;
  slotKey: string;
  backupFileName: string;
  extraRoots?: ExtraSaveRoot[];
}): Promise<void> {
  return invoke<void>('rpgm_save_backup_restore', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function wolfSavesProbe(installPath: string): Promise<WolfProbeResult> {
  return invoke<WolfProbeResult>('wolf_saves_probe', { installPath });
}

export async function wolfSavesList(
  installPath: string,
  extraRoots?: ExtraSaveRoot[],
): Promise<RenpySaveSlot[]> {
  return invoke<RenpySaveSlot[]>('wolf_saves_list', {
    installPath,
    extraRoots: extraRoots ?? null,
  });
}

export async function wolfSaveRead(args: {
  installPath: string;
  slotKey: string;
  extraRoots?: ExtraSaveRoot[];
}): Promise<RenpyVarNode> {
  return invoke<RenpyVarNode>('wolf_save_read', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function wolfSaveWrite(args: {
  threadId: string;
  installPath: string;
  slotKey: string;
  patches: RenpySavePatch[];
  extraRoots?: ExtraSaveRoot[];
}): Promise<RenpyVarNode> {
  return invoke<RenpyVarNode>('wolf_save_write', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function wolfSaveBackupsList(args: {
  threadId: string;
  slotKey: string;
}): Promise<RenpySaveBackup[]> {
  return invoke<RenpySaveBackup[]>('wolf_save_backups_list', args);
}

export async function wolfSaveBackupRestore(args: {
  threadId: string;
  installPath: string;
  slotKey: string;
  backupFileName: string;
  extraRoots?: ExtraSaveRoot[];
}): Promise<void> {
  return invoke<void>('wolf_save_backup_restore', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export type UnitySaveMetaOpts = {
  developer?: string | null;
  title?: string | null;
  extraRoots?: ExtraSaveRoot[];
};

export async function unitySavesProbe(
  installPath: string,
  opts?: UnitySaveMetaOpts,
): Promise<UnityProbeResult> {
  return invoke<UnityProbeResult>('unity_saves_probe', {
    installPath,
    developer: opts?.developer ?? null,
    title: opts?.title ?? null,
  });
}

export async function unitySavesList(
  installPath: string,
  opts?: UnitySaveMetaOpts,
): Promise<UnitySaveSlot[]> {
  return invoke<UnitySaveSlot[]>('unity_saves_list', {
    installPath,
    developer: opts?.developer ?? null,
    title: opts?.title ?? null,
    extraRoots: opts?.extraRoots ?? null,
  });
}

export async function unitySaveRead(args: {
  installPath: string;
  slotKey: string;
  developer?: string | null;
  title?: string | null;
  password?: string | null;
  extraRoots?: ExtraSaveRoot[];
}): Promise<UnitySaveReadResult> {
  return invoke<UnitySaveReadResult>('unity_save_read', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function unitySaveWrite(args: {
  threadId: string;
  installPath: string;
  slotKey: string;
  patches: RenpySavePatch[];
  developer?: string | null;
  title?: string | null;
  password?: string | null;
  extraRoots?: ExtraSaveRoot[];
}): Promise<RenpyVarNode> {
  return invoke<RenpyVarNode>('unity_save_write', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function unitySaveBackupsList(args: {
  threadId: string;
  slotKey: string;
}): Promise<RenpySaveBackup[]> {
  return invoke<RenpySaveBackup[]>('unity_save_backups_list', args);
}

export async function unitySaveBackupRestore(args: {
  threadId: string;
  installPath: string;
  slotKey: string;
  backupFileName: string;
  developer?: string | null;
  title?: string | null;
  extraRoots?: ExtraSaveRoot[];
}): Promise<void> {
  return invoke<void>('unity_save_backup_restore', {
    ...args,
    extraRoots: args.extraRoots ?? null,
  });
}

export async function deleteInstallDir(args: {
  path: string;
  safeRoots?: string[];
}): Promise<boolean> {
  return invoke<boolean>('delete_install_dir', args);
}

export async function defaultDownloadsPath(): Promise<string> {
  return invoke<string>('default_downloads_path');
}

export interface DiskInfo {
  freeBytes: number;
  available: boolean;
}

export interface DirectorySize {
  usedBytes: number;
  available: boolean;
}

export async function diskInfo(path: string): Promise<DiskInfo> {
  return invoke<DiskInfo>('disk_info', { path });
}

export async function directorySize(path: string): Promise<DirectorySize> {
  return invoke<DirectorySize>('directory_size', { path });
}

export interface MoveStartResult {
  destInstallPath: string;
  totalBytes: number;
}

export async function moveInstallStart(args: {
  threadId: string;
  oldInstallPath: string;
  oldExePath: string | null;
  newLibraryPath: string;
}): Promise<MoveStartResult> {
  return invoke<MoveStartResult>('move_install_start', args);
}

export async function moveInstallCancel(threadId: string): Promise<void> {
  return invoke('move_install_cancel', { threadId });
}

export async function setGofileCredentials(args: {
  token: string | null;
  accountId?: string | null;
}): Promise<void> {
  return invoke('set_gofile_credentials', {
    token: args.token ?? null,
    accountId: args.accountId ?? null,
  });
}

export interface GofileVerifyResult {
  valid: boolean;
  tier: string | null;
  email: string | null;
  message: string;
}

export async function verifyGofileCredentials(): Promise<GofileVerifyResult> {
  return invoke<GofileVerifyResult>('verify_gofile_credentials');
}

export async function setMegaSession(args: { session: string | null }): Promise<void> {
  return invoke('set_mega_session', { session: args.session ?? null });
}

export interface MegaLoginResult {
  session: string;
  email: string;
  message: string;
}

export async function loginMega(args: {
  email: string;
  password: string;
  mfa?: string | null;
}): Promise<MegaLoginResult> {
  return invoke<MegaLoginResult>('login_mega', {
    email: args.email,
    password: args.password,
    mfa: args.mfa ?? null,
  });
}

export interface MegaVerifyResult {
  valid: boolean;
  email: string | null;
  usedBytes: number | null;
  totalBytes: number | null;
  message: string;
}

export async function verifyMegaSession(): Promise<MegaVerifyResult> {
  return invoke<MegaVerifyResult>('verify_mega_session');
}

export async function setUploadhavenSession(args: {
  cookieHeader: string | null;
  email?: string | null;
  isPro?: boolean;
}): Promise<void> {
  return invoke('set_uploadhaven_session', {
    cookieHeader: args.cookieHeader ?? null,
    email: args.email ?? null,
    isPro: args.isPro ?? false,
  });
}

export interface UploadHavenLoginResult {
  cookieHeader: string;
  email: string;
  isPro: boolean;
  message: string;
}

export async function loginUploadhaven(args: {
  email: string;
  password: string;
}): Promise<UploadHavenLoginResult> {
  return invoke<UploadHavenLoginResult>('login_uploadhaven', args);
}

export interface UploadHavenVerifyResult {
  valid: boolean;
  email: string | null;
  isPro: boolean;
  message: string;
  cookieHeader?: string | null;
}

export async function verifyUploadhavenSession(): Promise<UploadHavenVerifyResult> {
  return invoke<UploadHavenVerifyResult>('verify_uploadhaven_session');
}

export async function setBuzzheavierAccount(args: {
  accountId: string | null;
}): Promise<void> {
  return invoke('set_buzzheavier_account', {
    accountId: args.accountId ?? null,
  });
}

export interface BuzzheavierVerifyResult {
  valid: boolean;
  email: string | null;
  storageUsed: string | null;
  storageLimit: string | null;
  message: string;
}

export async function verifyBuzzheavierAccount(): Promise<BuzzheavierVerifyResult> {
  return invoke<BuzzheavierVerifyResult>('verify_buzzheavier_account');
}

export async function setDatanodesKey(args: { key: string | null }): Promise<void> {
  return invoke('set_datanodes_key', { key: args.key ?? null });
}

export interface DatanodesVerifyResult {
  valid: boolean;
  email: string | null;
  storageLeft: string | null;
  premiumExpire: string | null;
  message: string;
}

export async function verifyDatanodesKey(): Promise<DatanodesVerifyResult> {
  return invoke<DatanodesVerifyResult>('verify_datanodes_key');
}

export async function setMixdropCredentials(args: {
  email: string | null;
  apiKey: string | null;
}): Promise<void> {
  return invoke('set_mixdrop_credentials', {
    email: args.email ?? null,
    apiKey: args.apiKey ?? null,
  });
}

export interface MixdropVerifyResult {
  valid: boolean;
  message: string;
}

export async function verifyMixdropCredentials(): Promise<MixdropVerifyResult> {
  return invoke<MixdropVerifyResult>('verify_mixdrop_credentials');
}

export async function completeLogin(): Promise<void> {
  return invoke('complete_login');
}

export async function restartToLogin(): Promise<void> {
  return invoke('restart_to_login');
}

export async function pingSidecar(): Promise<void> {
  return invoke('ping_sidecar');
}

export function buildOverlayLayout(): OverlayLayout {
  const exp = getExperimentalSettings();
  const layout: OverlayLayout = {
    displayMode: exp.overlayDisplayMode,
  };
  if (exp.overlayDisplayMode === 'compact') {
    layout.geom = { ...exp.overlayCompactGeom };
  }
  return layout;
}

export async function overlayEnsure(): Promise<void> {
  return invoke('overlay_ensure');
}

export async function overlaySetContext(context: OverlayContext): Promise<void> {
  return invoke('overlay_set_context', { context });
}

export async function overlayGetContext(): Promise<OverlayContext | null> {
  return invoke<OverlayContext | null>('overlay_get_context');
}

export async function overlayClearContext(): Promise<void> {
  return invoke('overlay_clear_context');
}

export async function overlayGetAnchorStatus(): Promise<OverlayAnchorStatus> {
  return invoke<OverlayAnchorStatus>('overlay_get_anchor_status');
}

export async function overlayShow(): Promise<OverlayAnchorStatus> {
  await loadExperimentalSettings();
  return invoke<OverlayAnchorStatus>('overlay_show', { layout: buildOverlayLayout() });
}

export async function overlayHide(): Promise<void> {
  return invoke('overlay_hide');
}

export async function overlayToggle(): Promise<boolean> {
  await loadExperimentalSettings();
  return invoke<boolean>('overlay_toggle', { layout: buildOverlayLayout() });
}

export interface OverlaySyncHotkeyResult {
  registered: boolean;
  hotkey: string;
  message: string | null;
}

export async function overlaySyncHotkey(
  enabled: boolean,
  hotkey: string,
): Promise<OverlaySyncHotkeyResult> {
  return invoke<OverlaySyncHotkeyResult>('overlay_sync_hotkey', { enabled, hotkey });
}

export async function overlayIsVisible(): Promise<boolean> {
  return invoke<boolean>('overlay_is_visible');
}

export async function overlayShowGameHint(payload: {
  title: string;
  hotkey: string;
  pid?: number;
}): Promise<void> {
  return invoke('overlay_show_game_hint', payload);
}

export async function overlayGetGameHintPayload(): Promise<{
  title: string;
  hotkey: string;
} | null> {
  return invoke<{ title: string; hotkey: string } | null>('overlay_get_game_hint_payload');
}

export async function overlayHideGameHint(): Promise<void> {
  return invoke('overlay_hide_game_hint');
}

export async function overlayPauseFollow(durationMs: number): Promise<void> {
  return invoke('overlay_pause_follow', { durationMs });
}

export async function overlaySyncCompactFromWindow(): Promise<OverlayCompactGeom> {
  return invoke<OverlayCompactGeom>('overlay_sync_compact_from_window');
}

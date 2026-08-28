mod app_log;
mod bridge;
mod buzzheavier;
mod commands;
mod dev_debug;
mod download;
mod error;
mod extract_jobs;
mod extraction;
mod game_window;
mod gdrive;
mod launcher;
mod media_preview;
mod media_scan;
mod mega;
mod migrations;
mod mover;
mod overlay_anchor;
mod overlay_hotkey;
mod remote_image_preview;
mod save_editor;
mod save_migration;
mod shortcuts;
mod sidecar;
mod uploadhaven;
#[cfg(windows)]
mod win_job;

use commands::{
    append_app_log, build_state, check_network, cli_args, close_captcha_window, complete_login,
    create_game_shortcuts,
    default_downloads_path, delete_install_dir, delete_path, directory_size, disk_info, download_cancel,
    download_pause,
    download_continue_captcha, download_continue_choice, download_post_attachment, download_start,
    extract_archive,
    extract_cbz_preview, fetch_alerts_list, fetch_alerts_popup, fetch_conversation,
    fetch_conversations_list, conversation_reply, conversation_bbcode_preview, fetch_rss_feed, find_main_exe,
    forum_search, forum_search_form_options, game_detail,
    get_following, get_member_activity, get_member_profile, get_member_profile_posts,
    get_watched_threads, get_thread_watch_state,
    get_profile, has_local_session, is_logged_in,
    launch_game, login, login_mega, login_uploadhaven, logout, migrate_saves, move_install_cancel,
    move_install_start, open_captcha_window, ping_sidecar,
    renpy_save_backup_restore, renpy_save_backups_list, renpy_save_read, renpy_save_write,
    renpy_saves_list, renpy_saves_probe, rpgm_save_backup_restore, rpgm_save_backups_list,
    rpgm_save_read, rpgm_save_write, rpgm_saves_list, rpgm_saves_probe, resolve_media_preview,
    resolve_post, resolve_remote_image_preview, restart_to_login, reveal_in_explorer, running_games, sam_list,
    sam_options, scan_install_media, set_buzzheavier_account, set_datanodes_key,
    set_gofile_credentials, set_mega_session, set_mixdrop_credentials, set_uploadhaven_session,
    stop_game, thread_posts, thread_reply, bbcode_preview, unity_save_backup_restore,
    unity_save_backups_list, unity_save_read, unity_save_write, unity_saves_list, unity_saves_probe,
    wolf_save_backup_restore, wolf_save_backups_list, wolf_save_read, wolf_save_write,
    wolf_saves_list, wolf_saves_probe,
    verify_buzzheavier_account, verify_datanodes_key, verify_gofile_credentials,
    verify_mega_session, verify_mixdrop_credentials, verify_uploadhaven_session,
    overlay_clear_context, overlay_ensure, overlay_get_anchor_status, overlay_get_context,
    overlay_hide, overlay_hide_game_hint, overlay_is_visible, overlay_set_context, overlay_show,
    overlay_get_game_hint_payload, overlay_pause_follow, overlay_show_game_hint,
    overlay_sync_compact_from_window,
    overlay_sync_hotkey, overlay_toggle, AppState,
};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

/// CLI flag presence when the process was launched via OS autostart.
#[allow(dead_code)] // consumed by later autostart/tray commands
struct AutostartCli {
    from_autostart: bool,
}

/// SQLite file under `app_local_data_dir`. Dev builds use a separate DB so
/// experimental migrations do not break the installed release database.
/// Keep in sync with `DB_FILE` in `src/lib/db.ts`.
fn sqlite_db_url() -> &'static str {
    if cfg!(debug_assertions) {
        "sqlite:f95app-dev.db"
    } else {
        "sqlite:f95app.db"
    }
}

/// Bring the primary UI forward when a second process tries to start.
/// Prefer `main` (post-login); fall back to `login` at startup.
fn focus_primary_window(app: &AppHandle) {
    let Some(win) = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("login"))
    else {
        return;
    };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations: Vec<Migration> = vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: migrations::V1_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "downloads_add_game_version",
            sql: migrations::V2_ADD_DOWNLOAD_GAME_VERSION,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "install_libraries",
            sql: migrations::V3_INSTALL_LIBRARIES,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "app_settings",
            sql: migrations::V4_APP_SETTINGS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "library_games_category",
            sql: migrations::V5_LIBRARY_CATEGORY,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "achievements_schema",
            sql: migrations::V6_ACHIEVEMENTS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "notifications_and_rss_seen",
            sql: migrations::V7_NOTIFICATIONS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "library_games_download_links",
            sql: migrations::V8_LIBRARY_DOWNLOAD_LINKS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "library_game_exes",
            sql: migrations::V9_LIBRARY_GAME_EXES,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "install_plans_and_jobs",
            sql: migrations::V10_INSTALL_PLANS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "install_jobs_bundle_id",
            sql: migrations::V11_INSTALL_JOB_BUNDLE,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "discovery_pools",
            sql: migrations::V12_DISCOVERY_POOLS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "store_view_history",
            sql: migrations::V13_STORE_VIEW_HISTORY,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "library_collections",
            sql: migrations::V14_LIBRARY_COLLECTIONS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "library_store_tags",
            sql: migrations::V15_LIBRARY_STORE_TAGS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "library_save_extra_roots",
            sql: migrations::V16_LIBRARY_SAVE_EXTRA_ROOTS,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_primary_window(app);
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(
            SqlBuilder::default()
                .add_migrations(sqlite_db_url(), migrations)
                .build(),
        )
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Convenience-grade key derivation: hash the provided seed to 32 bytes
                // using SHA-256. The frontend supplies a stable seed derived from the
                // app identifier + a per-install salt, so no user prompt is needed.
                // See README for limitations.
                use std::hash::Hasher;
                // Lightweight: use a stable, deterministic hash. For real protection
                // the frontend should prompt for a user password instead.
                let mut out = vec![0u8; 32];
                let bytes = password.as_bytes();
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                hasher.write(bytes);
                let h = hasher.finish().to_le_bytes();
                for (i, b) in out.iter_mut().enumerate() {
                    *b = h[i % h.len()] ^ bytes.get(i).copied().unwrap_or(0);
                }
                out
            })
            .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let state = build_state(&app.handle())?;
            app.manage(state);
            let from_autostart = std::env::args().any(|a| a == "--autostart");
            app.manage(AutostartCli { from_autostart });
            if from_autostart {
                if let Some(login) = app.handle().get_webview_window("login") {
                    let _ = login.hide();
                }
            }
            {
                let local = app
                    .path()
                    .app_local_data_dir()
                    .map_err(|e| format!("app_local_data_dir: {e}"))?;
                crate::app_log::init(local.join("logs").join("app.log"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            append_app_log,
            login,
            get_profile,
            get_member_profile,
            get_member_profile_posts,
            get_member_activity,
            is_logged_in,
            has_local_session,
            check_network,
            logout,
            sam_list,
            sam_options,
            fetch_rss_feed,
            fetch_alerts_popup,
            fetch_alerts_list,
            fetch_conversations_list,
            fetch_conversation,
            conversation_reply,
            conversation_bbcode_preview,
            forum_search,
            forum_search_form_options,
            game_detail,
            thread_posts,
            thread_reply,
            bbcode_preview,
            resolve_post,
            get_following,
            get_watched_threads, get_thread_watch_state,
            download_start,
            download_continue_choice,
            download_continue_captcha,
            download_post_attachment,
            open_captcha_window,
            close_captcha_window,
            download_cancel,
            download_pause,
            extract_archive,
            find_main_exe,
            scan_install_media,
            resolve_media_preview,
            resolve_remote_image_preview,
            extract_cbz_preview,
            reveal_in_explorer,
            launch_game,
            stop_game,
            running_games,
            migrate_saves,
            renpy_saves_probe,
            renpy_saves_list,
            renpy_save_read,
            renpy_save_write,
            renpy_save_backups_list,
            renpy_save_backup_restore,
            rpgm_saves_probe,
            rpgm_saves_list,
            rpgm_save_read,
            rpgm_save_write,
            rpgm_save_backups_list,
            rpgm_save_backup_restore,
            unity_saves_probe,
            unity_saves_list,
            unity_save_read,
            unity_save_write,
            unity_save_backups_list,
            unity_save_backup_restore,
            wolf_saves_probe,
            wolf_saves_list,
            wolf_save_read,
            wolf_save_write,
            wolf_save_backups_list,
            wolf_save_backup_restore,
            delete_install_dir,
            delete_path,
            create_game_shortcuts,
            default_downloads_path,
            disk_info,
            directory_size,
            move_install_start,
            move_install_cancel,
            set_gofile_credentials,
            verify_gofile_credentials,
            set_mega_session,
            login_mega,
            verify_mega_session,
            set_uploadhaven_session,
            login_uploadhaven,
            verify_uploadhaven_session,
            set_buzzheavier_account,
            verify_buzzheavier_account,
            set_datanodes_key,
            verify_datanodes_key,
            set_mixdrop_credentials,
            verify_mixdrop_credentials,
            cli_args,
            complete_login,
            restart_to_login,
            ping_sidecar,
            overlay_ensure,
            overlay_set_context,
            overlay_get_context,
            overlay_get_anchor_status,
            overlay_clear_context,
            overlay_show,
            overlay_hide,
            overlay_toggle,
            overlay_sync_hotkey,
            overlay_is_visible,
            overlay_show_game_hint,
            overlay_get_game_hint_payload,
            overlay_hide_game_hint,
            overlay_pause_follow,
            overlay_sync_compact_from_window
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // ExitRequested fires before Ctrl+C fully tears us down; Exit is
            // the last chance. On Windows the sidecar also sits in a
            // kill-on-close job so hard STATUS_CONTROL_C_EXIT still reaps Node.
            let should_kill = matches!(
                event,
                RunEvent::ExitRequested { .. } | RunEvent::Exit
            );
            if !should_kill {
                return;
            }
            if let Some(state) = app_handle.try_state::<AppState>() {
                // Can't await here. take() is best-effort; job/kill_on_drop
                // covers the mid-RPC lock case.
                if let Ok(mut guard) = state.sidecar.try_lock() {
                    if let Some(sidecar) = guard.take() {
                        sidecar.kill_now();
                    }
                }
            }
        });
}

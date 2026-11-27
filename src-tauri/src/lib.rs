mod carddav;
mod commands;
mod crypto;
mod db;
mod mail_protocol;
mod models;

use chrono::Local;
use commands::{run_sync_all_internal, AppState};
use db::Database;
use mail_protocol::send_email_blocking;
use models::SendEmailPayload;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = Database::initialize().expect("Failed to initialize local SQLite database");
    let db_arc = Arc::new(Mutex::new(database));
    let db_for_state = Arc::clone(&db_arc);
    let db_for_bg = Arc::clone(&db_arc);
    let db_for_close = Arc::clone(&db_arc);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState { db: db_for_state })
        .setup(move |app| {
            // Setup Windows System Tray with native menu
            let open_item = MenuItem::with_id(app, "open", "打开素笺 LinenMail", true, None::<&str>)?;
            let sync_item = MenuItem::with_id(app, "sync", "立即同步全部邮箱", true, None::<&str>)?;
            let compose_item = MenuItem::with_id(app, "compose", "撰写新邮件", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &sync_item, &compose_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("素笺 LinenMail · 本地邮件引擎运行中")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "compose" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                        let _ = app.emit("linenmail://tray-compose", ());
                    }
                    "sync" => {
                        let handle = app.clone();
                        let state = app.state::<AppState>();
                        let db = Arc::clone(&state.db);
                        tauri::async_runtime::spawn(async move {
                            let _ = run_sync_all_internal(&handle, db, true).await;
                        });
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _tray = tray_builder.build(app)?;

            // Background scheduler: periodic IMAP sync + scheduled email dispatch
            let bg_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut last_sync = Instant::now();
                loop {
                    tokio::time::sleep(Duration::from_secs(30)).await;

                    // 1. Dispatch due scheduled emails
                    let due_items = {
                        let now_ms = Local::now().timestamp_millis();
                        db_for_bg
                            .lock()
                            .ok()
                            .and_then(|db| db.list_due_scheduled_emails(now_ms).ok())
                            .unwrap_or_default()
                    };

                    for item in due_items {
                        let db_send = Arc::clone(&db_for_bg);
                        let payload = SendEmailPayload {
                            account_id: item.account_id.clone(),
                            recipients: item.recipients.clone(),
                            cc: item.cc.clone(),
                            subject: item.subject.clone(),
                            body: item.body.clone(),
                            attachments: item.attachments.clone(),
                        };
                        let send_res =
                            tokio::task::spawn_blocking(move || send_email_blocking(&db_send, &payload))
                                .await;
                        if let Ok(Ok(_)) = send_res {
                            if let Ok(db) = db_for_bg.lock() {
                                let _ = db.mark_scheduled_status(&item.id, "sent");
                            }
                            let _ = bg_handle.emit("linenmail://scheduled-sent", &item.id);
                        }
                    }

                    // 2. Check sync frequency and perform incremental background sync
                    let freq = db_for_bg
                        .lock()
                        .ok()
                        .and_then(|db| db.get_system_settings().ok())
                        .map(|s| s.sync_frequency)
                        .unwrap_or_else(|| "每 5 分钟".into());

                    let interval_secs = match freq.as_str() {
                        "实时推送" => Some(60u64),
                        "每 5 分钟" => Some(300u64),
                        "每 15 分钟" => Some(900u64),
                        _ => None,
                    };

                    if let Some(secs) = interval_secs {
                        if last_sync.elapsed() >= Duration::from_secs(secs) {
                            last_sync = Instant::now();
                            let _ = run_sync_all_internal(&bg_handle, Arc::clone(&db_for_bg), true).await;
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(move |window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let minimize = db_for_close
                    .lock()
                    .ok()
                    .and_then(|db| db.get_system_settings().ok())
                    .map(|s| s.minimize_to_tray)
                    .unwrap_or(true);
                if minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_workspace,
            commands::test_account_connection,
            commands::save_account,
            commands::set_default_account,
            commands::delete_account,
            commands::sync_all_accounts,
            commands::load_older_emails,
            commands::send_email,
            commands::schedule_email,
            commands::cancel_scheduled_email,
            commands::save_draft,
            commands::delete_draft,
            commands::update_email_flags,
            commands::delete_email,
            commands::pick_attachment_files,
            commands::download_attachment,
            commands::get_cache_stats,
            commands::clear_attachment_cache,
            commands::save_filter_rule,
            commands::toggle_filter_rule,
            commands::save_smart_folder,
            commands::toggle_smart_folder,
            commands::delete_smart_folder,
            commands::save_label,
            commands::delete_label,
            commands::save_llm_profile,
            commands::activate_llm_profile,
            commands::invoke_llm_chat,
            commands::save_user_profile,
            commands::save_system_settings,
            commands::toggle_contact_star,
            commands::send_test_notification,
            commands::get_carddav_config,
            commands::sync_carddav_contacts,
            commands::import_contacts_file,
            commands::refresh_imap_folders,
            commands::sync_imap_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LinenMail desktop application");
}

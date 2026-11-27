use crate::carddav::{parse_csv_contacts, parse_vcards, sync_carddav_contacts_async};
use crate::db::{format_bytes, sanitize_filename, Database};
use crate::mail_protocol::{
    create_imap_folder_blocking, load_older_emails_blocking, move_email_to_folder_blocking,
    move_emails_to_folder_batch_blocking, refetch_attachment_blocking,
    refresh_imap_folders_blocking, send_email_blocking, sync_account_blocking,
    sync_flag_to_imap_blocking, sync_imap_folder_blocking, test_connection_blocking,
};
use crate::models::*;
use chrono::Local;
use std::fs;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
}

#[tauri::command]
pub fn get_workspace(state: State<'_, AppState>) -> Result<WorkspaceSnapshot, String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.get_workspace_snapshot()
}

#[tauri::command]
pub async fn test_account_connection(
    input: TestConnectionInput,
) -> Result<TestConnectionResult, String> {
    tokio::task::spawn_blocking(move || test_connection_blocking(&input))
        .await
        .map_err(|e| format!("连接测试任务中断: {}", e))
}

#[tauri::command]
pub fn save_account(
    state: State<'_, AppState>,
    input: AccountConfigInput,
) -> Result<ConnectedAccount, String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.save_account(&input)
}

#[tauri::command]
pub fn set_default_account(state: State<'_, AppState>, account_id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.set_default_account(&account_id)
}

#[tauri::command]
pub fn delete_account(state: State<'_, AppState>, account_id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.delete_account(&account_id)
}

#[tauri::command]
pub async fn sync_all_accounts(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncSummary, String> {
    let db_arc = Arc::clone(&state.db);
    let summary = run_sync_all_internal(&app, db_arc, true).await?;
    Ok(summary)
}

#[tauri::command]
pub async fn load_older_emails(
    state: State<'_, AppState>,
    batch_size: Option<usize>,
    folder_key: Option<String>,
) -> Result<LoadOlderResult, String> {
    let limit = batch_size.unwrap_or(50).clamp(10, 100);
    let target_key = folder_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "inbox".to_string());

    if target_key != "inbox" {
        let (acc_opt, folder_opt) = {
            let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
            let folder = db.get_imap_folder(&target_key)?;
            let acc = match &folder {
                Some(f) => db.get_account_with_secret(Some(&f.account_id))?,
                None => None,
            };
            (acc, folder)
        };
        let (Some(acc), Some(folder)) = (acc_opt, folder_opt) else {
            return Ok(LoadOlderResult {
                fetched_count: 0,
                has_more: false,
                errors: vec![],
            });
        };
        let db_for_task = Arc::clone(&state.db);
        let (fetched_count, has_more) = tokio::task::spawn_blocking(move || {
            load_older_emails_blocking(&db_for_task, &acc, limit, &folder.folder_key, &folder.raw_name)
        })
        .await
        .map_err(|e| format!("加载历史邮件任务中断: {}", e))??;

        return Ok(LoadOlderResult {
            fetched_count,
            has_more,
            errors: vec![],
        });
    }

    let accounts = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        db.list_accounts_with_secrets()?
    };

    let db_for_task = Arc::clone(&state.db);

    let (fetched_count, has_more, errors) = tokio::task::spawn_blocking(move || {
        let mut total_fetched = 0usize;
        let mut any_has_more = false;
        let mut errs = Vec::new();

        for acc in accounts {
            if !acc.account.has_credentials {
                continue;
            }
            match load_older_emails_blocking(&db_for_task, &acc, limit, "inbox", "INBOX") {
                Ok((cnt, more)) => {
                    total_fetched += cnt;
                    if more {
                        any_has_more = true;
                    }
                }
                Err(e) => errs.push(format!("{}: {}", acc.account.email, e)),
            }
        }
        (total_fetched, any_has_more, errs)
    })
    .await
    .map_err(|e| format!("加载历史邮件任务中断: {}", e))?;

    Ok(LoadOlderResult {
        fetched_count,
        has_more,
        errors,
    })
}

#[tauri::command]
pub async fn refresh_imap_folders(
    state: State<'_, AppState>,
) -> Result<Vec<ImapFolderItem>, String> {
    let accounts = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        db.list_accounts_with_secrets()?
    };
    let db_for_task = Arc::clone(&state.db);

    tokio::task::spawn_blocking(move || -> Result<Vec<ImapFolderItem>, String> {
        for acc in accounts {
            if !acc.account.has_credentials {
                continue;
            }
            let _ = refresh_imap_folders_blocking(&db_for_task, &acc);
        }
        let db = db_for_task.lock().map_err(|_| "数据库锁异常".to_string())?;
        db.list_imap_folders()
    })
    .await
    .map_err(|e| format!("刷新文件夹列表任务中断: {}", e))?
}

#[tauri::command]
pub async fn sync_imap_folder(
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<usize, String> {
    let (acc, folder) = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        let folder = db
            .get_imap_folder(&folder_id)?
            .ok_or_else(|| "未找到对应的邮箱文件夹".to_string())?;
        let acc = db
            .get_account_with_secret(Some(&folder.account_id))?
            .ok_or_else(|| "未找到该文件夹所属的邮箱账户".to_string())?;
        (acc, folder)
    };
    let db_for_task = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || sync_imap_folder_blocking(&db_for_task, &acc, &folder))
        .await
        .map_err(|e| format!("同步文件夹任务中断: {}", e))?
}

#[tauri::command]
pub async fn create_imap_folder(
    state: State<'_, AppState>,
    folder_name: String,
    account_id: Option<String>,
) -> Result<ImapFolderItem, String> {
    let acc = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        db.get_account_with_secret(account_id.as_deref())?
            .ok_or_else(|| "请先连接一个邮箱账户后再新建文件夹".to_string())?
    };
    let db_for_task = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || {
        create_imap_folder_blocking(&db_for_task, &acc, &folder_name)
    })
    .await
    .map_err(|e| format!("创建文件夹任务中断: {}", e))?
}

#[tauri::command]
pub async fn move_email_to_folder(
    state: State<'_, AppState>,
    email_id: String,
    target_folder_key: String,
) -> Result<(), String> {
    let (remote_info, target_mailbox_opt) = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        let remote_ref = db.get_email_remote_ref(&email_id)?;
        let target_mbx = if target_folder_key == "inbox" {
            Some("INBOX".to_string())
        } else if target_folder_key.starts_with("imap:") {
            db.get_imap_folder(&target_folder_key)?.map(|f| f.raw_name)
        } else {
            None
        };
        let acc = match &remote_ref {
            Some((aid, _, _)) => db.get_account_with_secret(Some(aid))?,
            None => None,
        };
        ((remote_ref, acc), target_mbx)
    };

    if let ((Some((_, uid, source_mailbox)), Some(acc)), Some(target_mailbox)) =
        (remote_info, target_mailbox_opt)
    {
        if acc.account.has_credentials {
            tokio::task::spawn_blocking(move || {
                move_email_to_folder_blocking(&acc, &source_mailbox, uid, &target_mailbox)
            })
            .await
            .map_err(|e| format!("移动远端邮件任务中断: {}", e))??;
        }
    }

    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.move_email_folder(&email_id, &target_folder_key, target_folder_key == "archive")
}

pub async fn run_sync_all_internal(
    app: &AppHandle,
    db_arc: Arc<Mutex<Database>>,
    emit_event: bool,
) -> Result<SyncSummary, String> {
    let accounts = {
        let db = db_arc.lock().map_err(|_| "数据库锁异常".to_string())?;
        db.list_accounts_with_secrets()?
    };

    let (notify_enabled, quiet_night) = {
        let db = db_arc.lock().map_err(|_| "数据库锁异常".to_string())?;
        let settings = db.get_system_settings()?;
        let profile = db.get_user_profile()?;
        (settings.desktop_notifications, profile.quiet_night_mode)
    };

    let db_for_task = Arc::clone(&db_arc);
    let (fetched_count, synced_accounts, errors, notifications) =
        tokio::task::spawn_blocking(move || {
            let mut total_fetched = 0usize;
            let mut synced_cnt = 0usize;
            let mut errs = Vec::new();
            let mut notifs = Vec::new();

            for acc in accounts {
                if !acc.account.has_credentials {
                    continue;
                }
                synced_cnt += 1;
                match sync_account_blocking(&db_for_task, &acc) {
                    Ok((cnt, mut ns)) => {
                        total_fetched += cnt;
                        notifs.append(&mut ns);
                    }
                    Err(e) => errs.push(format!("{}: {}", acc.account.email, e)),
                }
            }
            (total_fetched, synced_cnt, errs, notifs)
        })
        .await
        .map_err(|e| format!("同步任务中断: {}", e))?;

    let new_unread_count = notifications.len();

    // Send native Windows desktop notification for newly arrived unread emails
    if notify_enabled && new_unread_count > 0 && !is_in_quiet_hours(quiet_night) {
        let (title, body) = if new_unread_count == 1 {
            let n = &notifications[0];
            (format!("新邮件 · {}", n.sender), n.subject.clone())
        } else {
            let first = &notifications[0];
            (
                format!("收到 {} 封新邮件", new_unread_count),
                format!("{}：{}", first.sender, first.subject),
            )
        };
        let _ = app.notification().builder().title(&title).body(&body).show();
    }

    let summary = SyncSummary {
        fetched_count,
        new_unread_count,
        synced_accounts,
        errors,
        synced_at: Local::now().format("%H:%M:%S").to_string(),
    };

    if emit_event {
        let _ = app.emit("linenmail://sync-complete", &summary);
    }
    Ok(summary)
}

#[tauri::command]
pub async fn send_email(
    state: State<'_, AppState>,
    payload: SendEmailPayload,
) -> Result<EmailItem, String> {
    let db_arc = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || send_email_blocking(&db_arc, &payload))
        .await
        .map_err(|e| format!("发信任务中断: {}", e))?
}

#[tauri::command]
pub fn schedule_email(
    state: State<'_, AppState>,
    item: ScheduledEmailItem,
) -> Result<ScheduledEmailItem, String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    let mut record = item;
    if record.id.is_empty() {
        record.id = format!("sched-{}", Uuid::new_v4());
    }
    record.status = "pending".into();
    db.add_scheduled_email(&record)?;
    Ok(record)
}

#[tauri::command]
pub fn cancel_scheduled_email(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.cancel_scheduled_email(&id)
}

#[tauri::command]
pub fn save_draft(state: State<'_, AppState>, draft: DraftItem) -> Result<DraftItem, String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    let mut d = draft;
    if d.id.is_empty() {
        d.id = format!("draft-{}", Uuid::new_v4());
    }
    d.updated_at = Local::now().format("%H:%M").to_string();
    db.save_draft(&d)?;
    Ok(d)
}

#[tauri::command]
pub fn delete_draft(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.delete_draft(&id)
}

#[tauri::command]
pub async fn update_email_flags(
    state: State<'_, AppState>,
    email_id: String,
    unread: Option<bool>,
    starred: Option<bool>,
    archived: Option<bool>,
    tag: Option<String>,
) -> Result<(), String> {
    let remote_info = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        db.update_email_flags(&email_id, unread, starred, archived, tag)?;
        if let Some((aid, uid, mailbox)) = db.get_email_remote_ref(&email_id)? {
            db.get_account_with_secret(Some(&aid))?
                .map(|acc| (acc, uid, mailbox))
        } else {
            None
        }
    };

    // Best-effort sync flags back to remote IMAP server in background
    if let Some((acc, uid, mailbox)) = remote_info {
        let mut cmds = Vec::new();
        if let Some(u) = unread {
            cmds.push(if u { "-FLAGS (\\Seen)" } else { "+FLAGS (\\Seen)" });
        }
        if let Some(s) = starred {
            cmds.push(if s { "+FLAGS (\\Flagged)" } else { "-FLAGS (\\Flagged)" });
        }
        if !cmds.is_empty() {
            tokio::task::spawn_blocking(move || {
                for cmd in cmds {
                    let _ = sync_flag_to_imap_blocking(&acc, &mailbox, uid, cmd);
                }
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_email(state: State<'_, AppState>, email_id: String) -> Result<(), String> {
    let remote_info = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        let info = if let Some((aid, uid, mailbox)) = db.get_email_remote_ref(&email_id)? {
            db.get_account_with_secret(Some(&aid))?
                .map(|acc| (acc, uid, mailbox))
        } else {
            None
        };
        db.delete_email(&email_id)?;
        info
    };

    if let Some((acc, uid, mailbox)) = remote_info {
        tokio::task::spawn_blocking(move || {
            let _ = sync_flag_to_imap_blocking(&acc, &mailbox, uid, "+FLAGS (\\Deleted)");
        });
    }
    Ok(())
}

fn build_attachments_from_paths(paths: Vec<std::path::PathBuf>) -> Vec<EmailAttachment> {
    let mut result = Vec::new();
    for path in paths {
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("attachment.bin")
            .to_string();
        let size_bytes = meta.len() as i64;
        result.push(EmailAttachment {
            id: format!("att-{}", Uuid::new_v4()),
            name: sanitize_filename(&name),
            size: format_bytes(size_bytes),
            size_bytes,
            mime_type: guess_mime(&name),
            local_path: Some(path.to_string_lossy().to_string()),
            cached: true,
            content_base64: None,
        });
    }
    result
}

#[tauri::command]
pub async fn pick_attachment_files(app: AppHandle) -> Result<Vec<EmailAttachment>, String> {
    tokio::task::spawn_blocking(move || {
        let Some(files) = app.dialog().file().set_title("选择要添加的邮件附件").blocking_pick_files() else {
            return Ok(vec![]);
        };
        let paths: Vec<std::path::PathBuf> = files
            .into_iter()
            .filter_map(|fp| fp.into_path().ok())
            .collect();
        Ok(build_attachments_from_paths(paths))
    })
    .await
    .map_err(|e| format!("打开文件选择框失败: {}", e))?
}

#[tauri::command]
pub async fn read_attachment_paths(paths: Vec<String>) -> Result<Vec<EmailAttachment>, String> {
    tokio::task::spawn_blocking(move || {
        let path_bufs: Vec<std::path::PathBuf> = paths
            .into_iter()
            .map(|p| std::path::PathBuf::from(p.trim()))
            .collect();
        Ok(build_attachments_from_paths(path_bufs))
    })
    .await
    .map_err(|e| format!("读取拖拽附件失败: {}", e))?
}

#[tauri::command]
pub async fn download_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    attachment_id: String,
    fallback_name: Option<String>,
) -> Result<Option<String>, String> {
    let db_arc = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || {
        let (bytes, filename) = {
            let db = db_arc.lock().map_err(|_| "数据库锁异常".to_string())?;
            let rec = db.get_attachment_record(&attachment_id)?;
            if let Some(att_rec) = rec {
                let mut cached_bytes: Option<Vec<u8>> = None;
                if let Some(ref rel) = att_rec.cache_rel_path {
                    if let Ok(path) = db.safe_cache_path(rel) {
                        if path.exists() {
                            cached_bytes = fs::read(path).ok();
                        }
                    }
                }

                let data = if let Some(b) = cached_bytes {
                    b
                } else {
                    // On-demand IMAP refetch if local cache was cleaned
                    let remote = db.get_email_remote_ref(&att_rec.email_id)?;
                    if let Some((aid, uid, mailbox)) = remote {
                        if let Some(acc) = db.get_account_with_secret(Some(&aid))? {
                            let refetched =
                                refetch_attachment_blocking(&acc, &mailbox, uid, att_rec.part_index)?;
                            if let Ok(rel) = db.write_attachment_to_cache(&att_rec.id, &att_rec.name, &refetched) {
                                let _ = db.update_attachment_cache_path(&att_rec.id, &rel);
                            }
                            refetched
                        } else {
                            return Err("未找到所属邮箱账户，无法下载附件".into());
                        }
                    } else {
                        return Err("该附件未在本地缓存，且无关联的远端邮件记录".into());
                    }
                };
                (data, sanitize_filename(&att_rec.name))
            } else {
                let name = sanitize_filename(fallback_name.as_deref().unwrap_or("attachment.txt"));
                return Err(format!("本地数据库中未找到附件「{}」的二进制缓存", name));
            }
        };

        let Some(target) = app
            .dialog()
            .file()
            .set_title("保存邮件附件")
            .set_file_name(&filename)
            .blocking_save_file()
        else {
            return Ok(None);
        };

        let target_path = target
            .into_path()
            .map_err(|_| "所选保存路径不受支持".to_string())?;
        fs::write(&target_path, &bytes).map_err(|e| format!("保存附件文件失败: {}", e))?;
        Ok(Some(target_path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| format!("下载附件任务中断: {}", e))?
}

#[tauri::command]
pub fn get_cache_stats(state: State<'_, AppState>) -> Result<CacheStats, String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    Ok(db.get_cache_stats())
}

#[tauri::command]
pub fn clear_attachment_cache(state: State<'_, AppState>) -> Result<CacheStats, String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.clear_attachment_cache()
}

#[tauri::command]
pub async fn save_filter_rule(
    state: State<'_, AppState>,
    rule: FilterRuleItem,
    apply_existing: bool,
) -> Result<i64, String> {
    let remote_moves = if apply_existing {
        if let Some(ref target_key) = rule.action_folder {
            let tf = target_key.trim();
            if tf.starts_with("imap:") {
                let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
                if let Some(target_folder) = db.get_imap_folder(tf)? {
                    let refs = db.list_matching_remote_refs_for_rule(&rule, tf)?;
                    let acc = db.get_account_with_secret(Some(&target_folder.account_id))?;
                    acc.filter(|a| a.account.has_credentials).map(|a| {
                        let filtered: Vec<(u32, String)> = refs
                            .into_iter()
                            .filter(|(aid, _, _)| aid == &target_folder.account_id)
                            .map(|(_, uid, src)| (uid, src))
                            .collect();
                        (a, target_folder.raw_name, filtered)
                    })
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let matched = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        db.save_filter_rule(&rule, apply_existing)?
    };

    if let Some((acc, target_raw, items)) = remote_moves {
        if !items.is_empty() {
            let _ = tokio::task::spawn_blocking(move || {
                let _ = move_emails_to_folder_batch_blocking(&acc, &items, &target_raw);
            })
            .await;
        }
    }

    Ok(matched)
}

#[tauri::command]
pub async fn run_filter_rule(state: State<'_, AppState>, id: String) -> Result<i64, String> {
    let (rule, remote_moves) = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        let Some(rule) = db.get_filter_rule(&id)? else {
            return Err("未找到对应的过滤规则".into());
        };
        let moves = if let Some(ref target_key) = rule.action_folder {
            let tf = target_key.trim();
            if tf.starts_with("imap:") {
                if let Some(target_folder) = db.get_imap_folder(tf)? {
                    let refs = db.list_matching_remote_refs_for_rule(&rule, tf)?;
                    let acc = db.get_account_with_secret(Some(&target_folder.account_id))?;
                    acc.filter(|a| a.account.has_credentials).map(|a| {
                        let filtered: Vec<(u32, String)> = refs
                            .into_iter()
                            .filter(|(aid, _, _)| aid == &target_folder.account_id)
                            .map(|(_, uid, src)| (uid, src))
                            .collect();
                        (a, target_folder.raw_name, filtered)
                    })
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        (rule, moves)
    };

    let matched = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        db.apply_rule_to_existing_emails(&rule)?
    };

    if let Some((acc, target_raw, items)) = remote_moves {
        if !items.is_empty() {
            let _ = tokio::task::spawn_blocking(move || {
                let _ = move_emails_to_folder_batch_blocking(&acc, &items, &target_raw);
            })
            .await;
        }
    }

    Ok(matched)
}

#[tauri::command]
pub fn toggle_filter_rule(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.toggle_filter_rule(&id)
}

#[tauri::command]
pub fn delete_filter_rule(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.delete_filter_rule(&id)
}

#[tauri::command]
pub fn save_smart_folder(state: State<'_, AppState>, folder: SmartFolderItem) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.save_smart_folder(&folder)
}

#[tauri::command]
pub fn toggle_smart_folder(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.toggle_smart_folder(&id)
}

#[tauri::command]
pub fn delete_smart_folder(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.delete_smart_folder(&id)
}

#[tauri::command]
pub fn save_label(
    state: State<'_, AppState>,
    id: String,
    name: String,
    dot_class: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.save_label(&id, &name, &dot_class)
}

#[tauri::command]
pub fn delete_label(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.delete_label(&id)
}

#[tauri::command]
pub fn save_llm_profile(state: State<'_, AppState>, profile: LlmProfile) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.save_llm_profile(&profile)
}

#[tauri::command]
pub fn activate_llm_profile(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.activate_llm_profile(&id)
}

#[tauri::command]
pub async fn invoke_llm_chat(
    state: State<'_, AppState>,
    req: LlmChatRequest,
) -> Result<String, String> {
    let (base_url, api_key, model, temperature) = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        let stored = db.get_llm_profile_secret(req.profile_id.as_deref())?;
        let (s_url, s_key, s_model, s_temp) = match stored {
            Some((p, k)) => (p.base_url, k, p.model, p.temperature),
            None => (
                "https://api.openai.com/v1".into(),
                String::new(),
                "gpt-4o-mini".into(),
                0.3,
            ),
        };
        (
            req.base_url.filter(|s| !s.trim().is_empty()).unwrap_or(s_url),
            req.api_key.filter(|s| !s.trim().is_empty()).unwrap_or(s_key),
            req.model.filter(|s| !s.trim().is_empty()).unwrap_or(s_model),
            req.temperature.unwrap_or(s_temp),
        )
    };

    validate_llm_endpoint(&base_url)?;
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败: {}", e))?;

    let mut request_builder = client.post(&endpoint).json(&serde_json::json!({
        "model": model,
        "temperature": temperature,
        "messages": req.messages,
    }));

    if !api_key.is_empty() {
        request_builder = request_builder.bearer_auth(&api_key);
    }

    let resp = request_builder
        .send()
        .await
        .map_err(|e| format!("请求 AI 接口失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("AI 接口返回错误状态码 {}", status));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 AI 响应失败: {}", e))?;
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "AI 返回内容为空".to_string())?;
    Ok(content.to_string())
}

static EDGE_TRANSLATE_TOKEN: std::sync::OnceLock<Mutex<Option<(String, std::time::Instant)>>> =
    std::sync::OnceLock::new();

const TRANSLATE_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

fn edge_lang_code(lang: &str) -> &'static str {
    match lang {
        "zh-CN" | "zh" | "zh-Hans" => "zh-Hans",
        "en" | "en-US" => "en",
        "ja" => "ja",
        "ko" => "ko",
        _ => "zh-Hans",
    }
}

fn google_lang_code(lang: &str) -> &'static str {
    match lang {
        "zh-CN" | "zh" | "zh-Hans" => "zh-CN",
        "en" | "en-US" => "en",
        "ja" => "ja",
        "ko" => "ko",
        _ => "zh-CN",
    }
}

async fn get_edge_translate_token(
    client: &reqwest::Client,
    force_new: bool,
) -> Result<String, String> {
    let cache = EDGE_TRANSLATE_TOKEN.get_or_init(|| Mutex::new(None));
    if !force_new {
        if let Ok(guard) = cache.lock() {
            if let Some((ref tok, instant)) = *guard {
                if instant.elapsed() < std::time::Duration::from_secs(480) && !tok.is_empty() {
                    return Ok(tok.clone());
                }
            }
        }
    }

    let resp = client
        .get("https://edge.microsoft.com/translate/auth")
        .header(reqwest::header::USER_AGENT, TRANSLATE_UA)
        .send()
        .await
        .map_err(|e| format!("获取微软翻译令牌失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("微软翻译鉴权返回状态码 {}", resp.status()));
    }

    let token = resp
        .text()
        .await
        .map_err(|e| format!("读取微软翻译令牌失败: {}", e))?
        .trim()
        .to_string();

    if token.is_empty() {
        return Err("微软翻译鉴权返回为空".into());
    }

    if let Ok(mut guard) = cache.lock() {
        *guard = Some((token.clone(), std::time::Instant::now()));
    }
    Ok(token)
}

async fn translate_texts_via_edge(
    client: &reqwest::Client,
    texts: &[String],
    target_lang: &str,
) -> Result<Vec<String>, String> {
    let to_code = edge_lang_code(target_lang);
    let url = format!(
        "https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to={}",
        to_code
    );

    let mut token = get_edge_translate_token(client, false).await?;
    let mut results = Vec::with_capacity(texts.len());

    let mut idx = 0usize;
    while idx < texts.len() {
        let mut batch: Vec<&str> = Vec::new();
        let mut char_total = 0usize;
        while idx < texts.len() && batch.len() < 25 {
            let item = texts[idx].as_str();
            let item_len = item.chars().count().max(1);
            if !batch.is_empty() && char_total + item_len > 5500 {
                break;
            }
            batch.push(item);
            char_total += item_len;
            idx += 1;
        }

        let payload: Vec<serde_json::Value> = batch
            .iter()
            .map(|t| serde_json::json!({ "Text": t }))
            .collect();

        let mut resp = client
            .post(&url)
            .header(reqwest::header::USER_AGENT, TRANSLATE_UA)
            .bearer_auth(&token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("请求微软翻译失败: {}", e))?;

        if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
            token = get_edge_translate_token(client, true).await?;
            resp = client
                .post(&url)
                .header(reqwest::header::USER_AGENT, TRANSLATE_UA)
                .bearer_auth(&token)
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("重试微软翻译失败: {}", e))?;
        }

        if !resp.status().is_success() {
            return Err(format!("微软翻译接口返回状态码 {}", resp.status()));
        }

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("解析微软翻译结果失败: {}", e))?;

        let arr = json
            .as_array()
            .ok_or_else(|| "微软翻译返回格式异常".to_string())?;
        if arr.len() != batch.len() {
            return Err("微软翻译返回段落数不匹配".into());
        }

        for (i, item) in arr.iter().enumerate() {
            let translated = item["translations"][0]["text"]
                .as_str()
                .unwrap_or(batch[i])
                .to_string();
            results.push(translated);
        }
    }

    Ok(results)
}

async fn translate_single_via_google(
    client: &reqwest::Client,
    text: &str,
    to_code: &str,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(String::new());
    }
    let resp = client
        .get("https://translate.googleapis.com/translate_a/single")
        .header(reqwest::header::USER_AGENT, TRANSLATE_UA)
        .query(&[
            ("client", "gtx"),
            ("sl", "auto"),
            ("tl", to_code),
            ("dt", "t"),
            ("q", text),
        ])
        .send()
        .await
        .map_err(|e| format!("请求谷歌翻译失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("谷歌翻译接口返回状态码 {}", resp.status()));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析谷歌翻译结果失败: {}", e))?;

    let mut out = String::new();
    if let Some(segments) = json.get(0).and_then(|v| v.as_array()) {
        for seg in segments {
            if let Some(piece) = seg.get(0).and_then(|v| v.as_str()) {
                out.push_str(piece);
            }
        }
    }
    if out.is_empty() {
        Ok(text.to_string())
    } else {
        Ok(out)
    }
}

async fn translate_texts_via_google(
    client: &reqwest::Client,
    texts: &[String],
    target_lang: &str,
) -> Result<Vec<String>, String> {
    let to_code = google_lang_code(target_lang);
    let mut results = Vec::with_capacity(texts.len());
    const SEP: &str = "\n<<<LM_P>>>\n";

    let mut idx = 0usize;
    while idx < texts.len() {
        let mut batch: Vec<&str> = Vec::new();
        let mut char_total = 0usize;
        while idx < texts.len() && batch.len() < 12 {
            let item = texts[idx].as_str();
            let item_len = item.chars().count().max(1);
            if !batch.is_empty() && char_total + item_len > 2600 {
                break;
            }
            batch.push(item);
            char_total += item_len;
            idx += 1;
        }

        if batch.len() == 1 {
            results.push(translate_single_via_google(client, batch[0], to_code).await?);
            continue;
        }

        let joined = batch.join(SEP);
        let translated = translate_single_via_google(client, &joined, to_code).await?;
        let parts: Vec<String> = translated
            .split("<<<LM_P>>>")
            .map(|s| s.trim().to_string())
            .collect();

        if parts.len() == batch.len() {
            results.extend(parts);
        } else {
            for item in batch {
                results.push(translate_single_via_google(client, item, to_code).await?);
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn get_email_translation(
    state: State<'_, AppState>,
    email_id: String,
    target_lang: Option<String>,
    engine: Option<String>,
) -> Result<Option<EmailTranslationRecord>, String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    if let (Some(lang), Some(eng)) = (target_lang, engine) {
        db.get_email_translation(&email_id, &lang, &eng)
    } else {
        db.get_latest_email_translation(&email_id)
    }
}

#[tauri::command]
pub fn save_email_translation(
    state: State<'_, AppState>,
    record: EmailTranslationRecord,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.save_email_translation(&record)
}

#[tauri::command]
pub async fn translate_email_free(
    state: State<'_, AppState>,
    req: FreeTranslateRequest,
) -> Result<EmailTranslationRecord, String> {
    if !req.force_refresh {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        if let Some(cached) = db.get_email_translation(&req.email_id, &req.target_lang, "free")? {
            return Ok(cached);
        }
    }

    let mut all_texts = Vec::with_capacity(1 + req.paragraphs.len());
    all_texts.push(req.subject.clone());
    all_texts.extend(req.paragraphs.iter().cloned());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("初始化翻译 HTTP 客户端失败: {}", e))?;

    let (translated_all, provider_label) =
        match translate_texts_via_edge(&client, &all_texts, &req.target_lang).await {
            Ok(list) => (list, "微软免费翻译".to_string()),
            Err(edge_err) => {
                match translate_texts_via_google(&client, &all_texts, &req.target_lang).await {
                    Ok(list) => (list, "谷歌免费翻译".to_string()),
                    Err(google_err) => {
                        return Err(format!(
                            "免配置翻译通道暂不可用（微软：{}；谷歌：{}），请检查网络或切换至自定义 AI 翻译",
                            edge_err, google_err
                        ));
                    }
                }
            }
        };

    let subject = translated_all
        .first()
        .cloned()
        .unwrap_or_else(|| req.subject.clone());
    let paragraphs = if translated_all.len() > 1 {
        translated_all[1..].to_vec()
    } else {
        vec![]
    };

    let record = EmailTranslationRecord {
        email_id: req.email_id,
        target_lang: req.target_lang,
        engine: "free".to_string(),
        subject,
        paragraphs,
        provider_label,
        updated_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };

    {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        let _ = db.save_email_translation(&record);
    }

    Ok(record)
}

#[tauri::command]
pub fn save_user_profile(state: State<'_, AppState>, profile: UserProfile) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.set_kv("user_profile", &profile)
}

#[tauri::command]
pub fn save_system_settings(
    state: State<'_, AppState>,
    settings: SystemSettingsState,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.set_kv("system_settings", &settings)
}

#[tauri::command]
pub fn toggle_contact_star(
    state: State<'_, AppState>,
    email: String,
) -> Result<Vec<String>, String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.toggle_contact_star(&email)
}

#[tauri::command]
pub fn send_test_notification(app: AppHandle) -> Result<(), String> {
    app.notification()
        .builder()
        .title("素笺 LinenMail")
        .body("桌面新邮件提醒已就绪，后台同步时将自动静默通知。")
        .show()
        .map_err(|e| format!("发送桌面通知失败: {}", e))
}

#[tauri::command]
pub fn get_carddav_config(state: State<'_, AppState>) -> Result<CardDavConfigState, String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.get_carddav_config_state()
}

#[tauri::command]
pub async fn sync_carddav_contacts(
    state: State<'_, AppState>,
    input: CardDavConfigInput,
) -> Result<ContactSyncResult, String> {
    let server_url = input.server_url.trim().to_string();
    if server_url.is_empty() {
        return Err("请填写 CardDAV 服务器地址".into());
    }

    let (resolved_user, resolved_pass) = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        let mut user = input.username.trim().to_string();
        let mut pass = input.password.trim().to_string();

        if input.use_default_account && (user.is_empty() || pass.is_empty()) {
            if let Some(acc) = db.get_account_with_secret(None)? {
                if user.is_empty() {
                    user = acc.account.email.clone();
                }
                if pass.is_empty() {
                    pass = acc.auth_code.clone();
                }
            }
        }

        if pass.is_empty() {
            pass = db.get_carddav_stored_password()?;
        }

        (user, pass)
    };

    if resolved_user.is_empty() || resolved_pass.is_empty() {
        return Err("缺少 CardDAV 登录账号或授权码，请先连接邮箱或手动填写".into());
    }

    let contacts = sync_carddav_contacts_async(&server_url, &resolved_user, &resolved_pass).await?;

    let (imported_count, total_directory_count) = {
        let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        let imported = db.upsert_directory_contacts_batch(&contacts)?;
        let _ = db.save_carddav_config(&input, Some(imported));
        let total = db.list_directory_contacts()?.len();
        (imported, total)
    };

    let msg = if imported_count > 0 {
        format!("已从 CardDAV 同步 {} 位企业通讯录联系人", imported_count)
    } else {
        "连接成功，但服务器未返回带邮箱地址的联系人".into()
    };

    Ok(ContactSyncResult {
        imported_count,
        total_directory_count,
        source_label: "CardDAV 企业通讯录".into(),
        message: msg,
    })
}

#[tauri::command]
pub async fn import_contacts_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<ContactSyncResult>, String> {
    let db_arc = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || {
        let Some(picked) = app
            .dialog()
            .file()
            .set_title("导入通讯录文件（vCard / CSV）")
            .add_filter("通讯录文件 (vCard / CSV)", &["vcf", "csv"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };

        let path = picked
            .into_path()
            .map_err(|_| "所选文件路径不受支持".to_string())?;
        let bytes = fs::read(&path).map_err(|e| format!("读取通讯录文件失败: {}", e))?;
        let raw_text = String::from_utf8_lossy(&bytes).to_string();

        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let contacts = if ext == "csv" || (!raw_text.contains("BEGIN:VCARD") && raw_text.contains(',')) {
            parse_csv_contacts(&raw_text, "import")
        } else {
            parse_vcards(&raw_text, "import")
        };

        if contacts.is_empty() {
            return Err("未在文件中解析到有效联系人邮箱，请确认文件为标准 UTF-8 编码的 .vcf 或 .csv 格式".into());
        }

        let db = db_arc.lock().map_err(|_| "数据库锁异常".to_string())?;
        let imported_count = db.upsert_directory_contacts_batch(&contacts)?;
        let total_directory_count = db.list_directory_contacts()?.len();

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("通讯录文件")
            .to_string();

        Ok(Some(ContactSyncResult {
            imported_count,
            total_directory_count,
            source_label: file_name.clone(),
            message: format!("已从「{}」导入 {} 位联系人", file_name, imported_count),
        }))
    })
    .await
    .map_err(|e| format!("导入通讯录任务中断: {}", e))?
}

fn validate_llm_endpoint(raw: &str) -> Result<(), String> {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.starts_with("https://") {
        return Ok(());
    }
    if trimmed.starts_with("http://localhost:")
        || trimmed.starts_with("http://127.0.0.1:")
        || trimmed == "http://localhost"
        || trimmed == "http://127.0.0.1"
    {
        return Ok(());
    }
    Err("出于安全考虑，仅支持 HTTPS 协议或本地 localhost/127.0.0.1 大模型接口".into())
}

fn guess_mime(filename: &str) -> String {
    let lower = filename.to_lowercase();
    if lower.ends_with(".pdf") {
        "application/pdf".into()
    } else if lower.ends_with(".png") {
        "image/png".into()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".into()
    } else if lower.ends_with(".csv") {
        "text/csv".into()
    } else if lower.ends_with(".txt") || lower.ends_with(".md") {
        "text/plain".into()
    } else if lower.ends_with(".zip") {
        "application/zip".into()
    } else {
        "application/octet-stream".into()
    }
}

fn is_in_quiet_hours(quiet_night_mode: bool) -> bool {
    if !quiet_night_mode {
        return false;
    }
    use chrono::Timelike;
    let hour = Local::now().hour();
    hour >= 21 || hour < 8
}

use crate::carddav::{parse_csv_contacts, parse_vcards, sync_carddav_contacts_async};
use crate::db::{format_bytes, sanitize_filename, Database};
use crate::mail_protocol::{
    load_older_emails_blocking, refetch_attachment_blocking, refresh_imap_folders_blocking,
    send_email_blocking, sync_account_blocking, sync_flag_to_imap_blocking,
    sync_imap_folder_blocking, test_connection_blocking,
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

#[tauri::command]
pub async fn pick_attachment_files(app: AppHandle) -> Result<Vec<EmailAttachment>, String> {
    tokio::task::spawn_blocking(move || {
        let Some(files) = app.dialog().file().set_title("选择要添加的邮件附件").blocking_pick_files() else {
            return Ok(vec![]);
        };
        let mut result = Vec::new();
        for fp in files {
            let Ok(path) = fp.into_path() else {
                continue;
            };
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
        Ok(result)
    })
    .await
    .map_err(|e| format!("打开文件选择框失败: {}", e))?
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
pub fn save_filter_rule(
    state: State<'_, AppState>,
    rule: FilterRuleItem,
    apply_existing: bool,
) -> Result<i64, String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.save_filter_rule(&rule, apply_existing)
}

#[tauri::command]
pub fn toggle_filter_rule(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db.toggle_filter_rule(&id)
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

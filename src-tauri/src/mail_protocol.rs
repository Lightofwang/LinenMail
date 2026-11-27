use crate::db::{format_bytes, format_full_time, format_short_time, sanitize_filename, AccountSecretRecord, Database};
use crate::models::*;
use base64::{engine::general_purpose::{STANDARD as B64, STANDARD_NO_PAD as B64_NO_PAD}, Engine};
use chrono::Local;
use imap::types::Flag;
use lettre::message::{header::ContentType, Attachment, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use mail_parser::{MessageParser, MimeHeaders};
use native_tls::TlsConnector;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;
use uuid::Uuid;

pub fn test_connection_blocking(input: &TestConnectionInput) -> TestConnectionResult {
    let start = Instant::now();
    let email = input.email.trim();
    let auth = input.auth_code.trim();
    let imap_host = input.imap_host.trim();
    let smtp_host = input.smtp_host.trim();

    if email.is_empty() || auth.is_empty() || imap_host.is_empty() || smtp_host.is_empty() {
        return TestConnectionResult {
            success: false,
            imap_ok: false,
            smtp_ok: false,
            latency_ms: 0,
            message: "请完整填写邮箱地址、授权码以及 IMAP/SMTP 服务器地址".into(),
        };
    }

    // 1. Test IMAP TLS login
    let imap_res = (|| -> Result<(), String> {
        let tls = TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS 初始化失败: {}", e))?;
        let client = imap::connect((imap_host, input.imap_port), imap_host, &tls)
            .map_err(|e| format!("无法连接 IMAP {}:{} ({})", imap_host, input.imap_port, e))?;
        let mut session = client
            .login(email, auth)
            .map_err(|(e, _)| format!("IMAP 认证失败，请核对邮箱授权码 ({})", e))?;
        let _ = session.logout();
        Ok(())
    })();

    let imap_ok = imap_res.is_ok();
    if let Err(err) = imap_res {
        return TestConnectionResult {
            success: false,
            imap_ok: false,
            smtp_ok: false,
            latency_ms: start.elapsed().as_millis() as u64,
            message: err,
        };
    }

    // 2. Test SMTP TLS login
    let smtp_res = (|| -> Result<(), String> {
        let mailer = build_smtp_transport(smtp_host, input.smtp_port, email, auth)?;
        let ok = mailer
            .test_connection()
            .map_err(|e| format!("SMTP 认证失败，请检查端口与授权码 ({})", e))?;
        if !ok {
            return Err("SMTP 服务器拒绝连接".into());
        }
        Ok(())
    })();

    let latency_ms = start.elapsed().as_millis() as u64;
    match smtp_res {
        Ok(()) => TestConnectionResult {
            success: true,
            imap_ok,
            smtp_ok: true,
            latency_ms,
            message: format!("IMAP 与 SMTP 加密握手均已通过（{}ms）", latency_ms),
        },
        Err(err) => TestConnectionResult {
            success: false,
            imap_ok,
            smtp_ok: false,
            latency_ms,
            message: err,
        },
    }
}

fn build_smtp_transport(
    smtp_host: &str,
    smtp_port: u16,
    email: &str,
    auth_code: &str,
) -> Result<SmtpTransport, String> {
    let creds = Credentials::new(email.to_string(), auth_code.to_string());
    let builder = if smtp_port == 587 {
        SmtpTransport::starttls_relay(smtp_host)
            .map_err(|e| format!("SMTP STARTTLS 配置失败: {}", e))?
    } else {
        SmtpTransport::relay(smtp_host)
            .map_err(|e| format!("SMTP SSL/TLS 配置失败: {}", e))?
    };
    Ok(builder.port(smtp_port).credentials(creds).build())
}

pub struct SyncedMailNotification {
    pub sender: String,
    pub subject: String,
}

pub fn sync_account_blocking(
    db_mutex: &Mutex<Database>,
    rec: &AccountSecretRecord,
) -> Result<(usize, Vec<SyncedMailNotification>), String> {
    let host = rec.account.imap_host.as_deref().unwrap_or("").trim();
    let port = rec.account.imap_port.unwrap_or(993);
    if host.is_empty() || rec.auth_code.is_empty() {
        return Ok((0, vec![]));
    }

    let is_initial_sync = rec.last_uid == 0;

    let tls = TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS 初始化失败: {}", e))?;
    let client = imap::connect((host, port), host, &tls)
        .map_err(|e| format!("连接 {} 失败: {}", host, e))?;
    let mut session = client
        .login(&rec.account.email, &rec.auth_code)
        .map_err(|(e, _)| format!("账户 {} IMAP 登录失败: {}", rec.account.email, e))?;

    // Discover all user-created & system IMAP folders on every sync
    let _ = discover_imap_folders_in_session(&mut session, db_mutex, rec);

    session
        .select("INBOX")
        .map_err(|e| format!("打开收件箱失败: {}", e))?;

    let uid_query = if !is_initial_sync {
        format!("UID {}:*", rec.last_uid + 1)
    } else {
        "ALL".to_string()
    };

    let mut uids: Vec<u32> = session
        .uid_search(&uid_query)
        .map_err(|e| format!("检索邮件 UID 失败: {}", e))?
        .into_iter()
        .filter(|&u| u > rec.last_uid)
        .collect();
    uids.sort_unstable();

    // On initial sync, keep it snappy by pulling the latest 30 messages
    if is_initial_sync && uids.len() > 30 {
        uids = uids.split_off(uids.len() - 30);
    }

    if uids.is_empty() {
        let _ = repair_stored_replacement_emails(&mut session, db_mutex, rec);
        let now_str = Local::now().format("%H:%M:%S").to_string();
        if let Ok(db) = db_mutex.lock() {
            let _ = db.update_account_sync_cursor(&rec.account.id, rec.last_uid, &now_str);
        }
        let _ = session.logout();
        return Ok((0, vec![]));
    }

    // Never emit Windows desktop notifications during initial sync!
    let (fetched_count, max_uid, notifications) = fetch_and_store_uids(
        &mut session,
        db_mutex,
        rec,
        &uids,
        rec.last_uid,
        "inbox",
        !is_initial_sync,
    )?;

    let _ = repair_stored_replacement_emails(&mut session, db_mutex, rec);

    let now_str = Local::now().format("%H:%M:%S").to_string();
    if let Ok(db) = db_mutex.lock() {
        let _ = db.update_account_sync_cursor(&rec.account.id, max_uid, &now_str);
    }
    let _ = session.logout();
    Ok((fetched_count, notifications))
}

fn discover_imap_folders_in_session<T: std::io::Read + std::io::Write>(
    session: &mut imap::Session<T>,
    db_mutex: &Mutex<Database>,
    rec: &AccountSecretRecord,
) -> Result<Vec<ImapFolderItem>, String> {
    let mailboxes = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("获取邮箱文件夹列表失败: {}", e))?;

    let mut discovered: Vec<ImapFolderItem> = Vec::new();
    for mbx in mailboxes.iter() {
        if mbx
            .attributes()
            .iter()
            .any(|a| matches!(a, imap::types::NameAttribute::NoSelect))
        {
            continue;
        }
        let raw_name = mbx.name().to_string();
        if raw_name.trim().is_empty() || raw_name.eq_ignore_ascii_case("INBOX") {
            continue;
        }
        let delimiter = mbx.delimiter().map(|d| d.to_string()).unwrap_or_else(|| "/".into());
        let decoded = decode_imap_utf7(&raw_name);
        let (kind, display_name) = classify_imap_folder(&raw_name, &decoded);

        let folder_id = format!("{}:{}", rec.account.id, raw_name);
        let folder_key = format!("imap:{}:{}", rec.account.id, raw_name);
        discovered.push(ImapFolderItem {
            id: folder_id,
            account_id: rec.account.id.clone(),
            account_email: rec.account.email.clone(),
            raw_name,
            display_name,
            folder_key,
            delimiter,
            kind,
            last_uid: 0,
            synced_at: None,
            email_count: 0,
            unread_count: 0,
        });
    }

    if let Ok(db) = db_mutex.lock() {
        let _ = db.replace_account_imap_folders(&rec.account.id, &discovered);
    }
    Ok(discovered)
}

pub fn refresh_imap_folders_blocking(
    db_mutex: &Mutex<Database>,
    rec: &AccountSecretRecord,
) -> Result<Vec<ImapFolderItem>, String> {
    let host = rec.account.imap_host.as_deref().unwrap_or("").trim();
    let port = rec.account.imap_port.unwrap_or(993);
    if host.is_empty() || rec.auth_code.is_empty() {
        return Ok(vec![]);
    }
    let tls = TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS 初始化失败: {}", e))?;
    let client = imap::connect((host, port), host, &tls)
        .map_err(|e| format!("连接 {} 失败: {}", host, e))?;
    let mut session = client
        .login(&rec.account.email, &rec.auth_code)
        .map_err(|(e, _)| format!("账户 {} IMAP 登录失败: {}", rec.account.email, e))?;

    let res = discover_imap_folders_in_session(&mut session, db_mutex, rec);
    let _ = session.logout();
    res
}

/// Creates a new mailbox folder on the remote IMAP server (with Modified UTF-7 encoding for Chinese names)
/// and refreshes the local SQLite folder registry.
pub fn create_imap_folder_blocking(
    db_mutex: &Mutex<Database>,
    rec: &AccountSecretRecord,
    folder_name: &str,
) -> Result<ImapFolderItem, String> {
    let clean_name = folder_name.trim();
    if clean_name.is_empty() {
        return Err("文件夹名称不能为空".into());
    }
    if clean_name.contains('/') || clean_name.contains('\\') {
        return Err("文件夹名称不能包含斜杠 / 或 \\".into());
    }

    let host = rec.account.imap_host.as_deref().unwrap_or("").trim();
    let port = rec.account.imap_port.unwrap_or(993);
    if host.is_empty() || rec.auth_code.is_empty() {
        return Err("请先配置并连接邮箱账户后再创建文件夹".into());
    }

    let tls = TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS 初始化失败: {}", e))?;
    let client = imap::connect((host, port), host, &tls)
        .map_err(|e| format!("连接 {} 失败: {}", host, e))?;
    let mut session = client
        .login(&rec.account.email, &rec.auth_code)
        .map_err(|(e, _)| format!("账户 {} IMAP 登录失败: {}", rec.account.email, e))?;

    // Inspect existing server hierarchy to match QQ/Exmail ("其他文件夹/") or INBOX prefix conventions
    let mut delimiter = "/".to_string();
    let mut uses_qq_root = false;
    let mut uses_inbox_prefix = false;
    if let Ok(mailboxes) = session.list(Some(""), Some("*")) {
        for mbx in mailboxes.iter() {
            if let Some(d) = mbx.delimiter() {
                if !d.is_empty() {
                    delimiter = d.to_string();
                }
            }
            let decoded = decode_imap_utf7(mbx.name());
            if decoded.starts_with("其他文件夹/") || decoded.starts_with("其他文件夹.") {
                uses_qq_root = true;
            } else if decoded.starts_with("INBOX.") || decoded.starts_with("INBOX/") {
                uses_inbox_prefix = true;
            }
        }
    }

    let encoded_leaf = encode_imap_utf7(clean_name);
    let mut candidates: Vec<String> = Vec::new();
    if uses_qq_root {
        candidates.push(format!("{}{}{}", encode_imap_utf7("其他文件夹"), delimiter, encoded_leaf));
        candidates.push(encoded_leaf.clone());
    } else if uses_inbox_prefix {
        candidates.push(format!("INBOX{}{}", delimiter, encoded_leaf));
        candidates.push(encoded_leaf.clone());
    } else {
        candidates.push(encoded_leaf.clone());
        candidates.push(format!("{}{}{}", encode_imap_utf7("其他文件夹"), delimiter, encoded_leaf));
        candidates.push(format!("INBOX{}{}", delimiter, encoded_leaf));
    }

    let mut created_raw: Option<String> = None;
    let mut last_err = String::new();
    for cand in &candidates {
        match session.create(cand) {
            Ok(()) => {
                created_raw = Some(cand.clone());
                break;
            }
            Err(e) => {
                last_err = format!("{}", e);
            }
        }
    }

    let raw_name = match created_raw {
        Some(r) => r,
        None => {
            let _ = session.logout();
            return Err(format!("服务器创建文件夹失败：{}", last_err));
        }
    };

    let discovered = discover_imap_folders_in_session(&mut session, db_mutex, rec).unwrap_or_default();
    let _ = session.logout();

    if let Some(found) = discovered
        .into_iter()
        .find(|f| f.raw_name == raw_name || f.display_name == clean_name)
    {
        return Ok(found);
    }

    // Fallback: insert immediately if remote LIST lags briefly behind CREATE
    let folder_id = format!("{}:{}", rec.account.id, raw_name);
    let folder_key = format!("imap:{}:{}", rec.account.id, raw_name);
    let fallback = ImapFolderItem {
        id: folder_id,
        account_id: rec.account.id.clone(),
        account_email: rec.account.email.clone(),
        raw_name,
        display_name: clean_name.to_string(),
        folder_key,
        delimiter,
        kind: "custom".into(),
        last_uid: 0,
        synced_at: None,
        email_count: 0,
        unread_count: 0,
    };
    if let Ok(db) = db_mutex.lock() {
        let _ = db.upsert_single_imap_folder(&fallback);
    }
    Ok(fallback)
}

/// Moves an email between IMAP mailboxes using RFC 3501 UID COPY + STORE \Deleted + EXPUNGE.
pub fn move_email_to_folder_blocking(
    rec: &AccountSecretRecord,
    source_mailbox: &str,
    uid: u32,
    target_mailbox: &str,
) -> Result<(), String> {
    if source_mailbox.eq_ignore_ascii_case(target_mailbox) {
        return Ok(());
    }
    let host = rec.account.imap_host.as_deref().unwrap_or("").trim();
    let port = rec.account.imap_port.unwrap_or(993);
    if host.is_empty() || rec.auth_code.is_empty() {
        return Ok(());
    }

    let tls = TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS 初始化失败: {}", e))?;
    let client = imap::connect((host, port), host, &tls)
        .map_err(|e| format!("连接 {} 失败: {}", host, e))?;
    let mut session = client
        .login(&rec.account.email, &rec.auth_code)
        .map_err(|(e, _)| format!("账户 {} IMAP 登录失败: {}", rec.account.email, e))?;

    session
        .select(source_mailbox)
        .map_err(|e| format!("打开源文件夹失败: {}", e))?;

    let uid_str = uid.to_string();
    session
        .uid_copy(&uid_str, target_mailbox)
        .map_err(|e| format!("复制邮件到目标文件夹失败: {}", e))?;
    let _ = session.uid_store(&uid_str, "+FLAGS.SILENT (\\Deleted)");
    let _ = session.expunge();
    let _ = session.logout();
    Ok(())
}

/// Moves multiple emails into a target IMAP folder in a single TLS IMAP session, grouped by source mailbox.
pub fn move_emails_to_folder_batch_blocking(
    rec: &AccountSecretRecord,
    items: &[(u32, String)],
    target_mailbox: &str,
) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let host = rec.account.imap_host.as_deref().unwrap_or("").trim();
    let port = rec.account.imap_port.unwrap_or(993);
    if host.is_empty() || rec.auth_code.is_empty() {
        return Ok(());
    }

    let mut by_source: std::collections::HashMap<&str, Vec<u32>> = std::collections::HashMap::new();
    for (uid, src) in items {
        if !src.eq_ignore_ascii_case(target_mailbox) {
            by_source.entry(src.as_str()).or_default().push(*uid);
        }
    }
    if by_source.is_empty() {
        return Ok(());
    }

    let tls = TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS 初始化失败: {}", e))?;
    let client = imap::connect((host, port), host, &tls)
        .map_err(|e| format!("连接 {} 失败: {}", host, e))?;
    let mut session = client
        .login(&rec.account.email, &rec.auth_code)
        .map_err(|(e, _)| format!("账户 {} IMAP 登录失败: {}", rec.account.email, e))?;

    for (src_mbx, uids) in by_source {
        if session.select(src_mbx).is_err() {
            continue;
        }
        for chunk in uids.chunks(50) {
            let uid_set = chunk
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",");
            if session.uid_copy(&uid_set, target_mailbox).is_ok() {
                let _ = session.uid_store(&uid_set, "+FLAGS.SILENT (\\Deleted)");
            }
        }
        let _ = session.expunge();
    }

    let _ = session.logout();
    Ok(())
}

/// Silently syncs one user-created or remote IMAP folder (latest 30 on first open, incremental afterwards).
pub fn sync_imap_folder_blocking(
    db_mutex: &Mutex<Database>,
    rec: &AccountSecretRecord,
    folder: &ImapFolderItem,
) -> Result<usize, String> {
    let host = rec.account.imap_host.as_deref().unwrap_or("").trim();
    let port = rec.account.imap_port.unwrap_or(993);
    if host.is_empty() || rec.auth_code.is_empty() {
        return Ok(0);
    }

    let is_initial = folder.last_uid == 0;

    let tls = TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS 初始化失败: {}", e))?;
    let client = imap::connect((host, port), host, &tls)
        .map_err(|e| format!("连接 {} 失败: {}", host, e))?;
    let mut session = client
        .login(&rec.account.email, &rec.auth_code)
        .map_err(|(e, _)| format!("账户 {} IMAP 登录失败: {}", rec.account.email, e))?;

    session
        .select(&folder.raw_name)
        .map_err(|e| format!("打开文件夹「{}」失败: {}", folder.display_name, e))?;

    let uid_query = if !is_initial {
        format!("UID {}:*", folder.last_uid + 1)
    } else {
        "ALL".to_string()
    };

    let mut uids: Vec<u32> = session
        .uid_search(&uid_query)
        .map_err(|e| format!("检索文件夹邮件 UID 失败: {}", e))?
        .into_iter()
        .filter(|&u| u > folder.last_uid)
        .collect();
    uids.sort_unstable();

    if is_initial && uids.len() > 30 {
        uids = uids.split_off(uids.len() - 30);
    }

    let now_str = Local::now().format("%H:%M:%S").to_string();
    if uids.is_empty() {
        if let Ok(db) = db_mutex.lock() {
            let _ = db.update_imap_folder_cursor(&folder.id, folder.last_uid, &now_str);
        }
        let _ = session.logout();
        return Ok(0);
    }

    let (fetched_count, max_uid, _notifs) = fetch_and_store_uids(
        &mut session,
        db_mutex,
        rec,
        &uids,
        folder.last_uid,
        &folder.folder_key,
        false,
    )?;

    if let Ok(db) = db_mutex.lock() {
        let _ = db.update_imap_folder_cursor(&folder.id, max_uid, &now_str);
    }
    let _ = session.logout();
    Ok(fetched_count)
}

/// Silently re-fetches previously synced emails that contain U+FFFD replacement chars
/// (caused by CESU-8 surrogate-pair emojis from Chinese enterprise mailers) and updates them in place.
fn repair_stored_replacement_emails<T: std::io::Read + std::io::Write>(
    session: &mut imap::Session<T>,
    db_mutex: &Mutex<Database>,
    rec: &AccountSecretRecord,
) -> usize {
    let candidates = {
        let Ok(db) = db_mutex.lock() else {
            return 0;
        };
        db.list_unrepaired_replacement_emails(&rec.account.id)
    };
    if candidates.is_empty() {
        return 0;
    }

    let uid_to_id: std::collections::HashMap<u32, String> = candidates
        .iter()
        .map(|(id, uid)| (*uid, id.clone()))
        .collect();
    let uid_set = candidates
        .iter()
        .map(|(_, u)| u.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let attempted_ids: Vec<String> = candidates.iter().map(|(id, _)| id.clone()).collect();

    let mut repaired_count = 0usize;
    if let Ok(fetches) = session.uid_fetch(&uid_set, "(UID BODY.PEEK[])") {
        let parser = MessageParser::default();
        for fetch in fetches.iter() {
            let (Some(uid), Some(raw)) = (fetch.uid, fetch.body()) else {
                continue;
            };
            let Some(email_id) = uid_to_id.get(&uid) else {
                continue;
            };
            let repaired_raw = repair_raw_mime_cesu8(raw);
            let Some(parsed) = parser.parse(&*repaired_raw) else {
                continue;
            };

            let subject = parsed
                .subject()
                .map(|s| decode_html_entities(s.trim()))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "（无主题）".into());
            let plain_body = extract_clean_body_text(&parsed);
            let mut paragraphs: Vec<String> = plain_body
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .map(|l| l.to_string())
                .collect();
            if paragraphs.is_empty() {
                paragraphs.push("（此邮件暂无纯文本正文）".into());
            }
            let preview: String = paragraphs
                .first()
                .cloned()
                .unwrap_or_default()
                .chars()
                .take(80)
                .collect();

            if let Ok(db) = db_mutex.lock() {
                if db
                    .update_email_repaired_content(email_id, &subject, &preview, &paragraphs)
                    .is_ok()
                {
                    repaired_count += 1;
                }
            }
        }
    }

    if let Ok(db) = db_mutex.lock() {
        db.mark_replacement_emails_attempted(&attempted_ids);
    }
    repaired_count
}

/// Silently loads one batch of older historical emails strictly before the oldest
/// locally synced UID for this account & folder. Never triggers desktop notifications.
pub fn load_older_emails_blocking(
    db_mutex: &Mutex<Database>,
    rec: &AccountSecretRecord,
    batch_size: usize,
    folder_key: &str,
    mailbox_name: &str,
) -> Result<(usize, bool), String> {
    let host = rec.account.imap_host.as_deref().unwrap_or("").trim();
    let port = rec.account.imap_port.unwrap_or(993);
    if host.is_empty() || rec.auth_code.is_empty() {
        return Ok((0, false));
    }

    let oldest_uid = {
        let db = db_mutex.lock().map_err(|_| "数据库锁异常".to_string())?;
        db.get_oldest_remote_uid(&rec.account.id, folder_key)
    };

    if oldest_uid == Some(1) {
        return Ok((0, false));
    }

    let tls = TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS 初始化失败: {}", e))?;
    let client = imap::connect((host, port), host, &tls)
        .map_err(|e| format!("连接 {} 失败: {}", host, e))?;
    let mut session = client
        .login(&rec.account.email, &rec.auth_code)
        .map_err(|(e, _)| format!("账户 {} IMAP 登录失败: {}", rec.account.email, e))?;

    session
        .select(mailbox_name)
        .map_err(|e| format!("打开文件夹失败: {}", e))?;

    let uid_query = match oldest_uid {
        Some(min_u) if min_u > 1 => format!("UID 1:{}", min_u - 1),
        _ => "ALL".to_string(),
    };

    let mut uids: Vec<u32> = session
        .uid_search(&uid_query)
        .map_err(|e| format!("检索历史邮件 UID 失败: {}", e))?
        .into_iter()
        .filter(|&u| match oldest_uid {
            Some(min_u) => u < min_u,
            None => true,
        })
        .collect();
    uids.sort_unstable();

    if uids.is_empty() {
        let _ = session.logout();
        return Ok((0, false));
    }

    let limit = batch_size.clamp(10, 100);
    let has_more = uids.len() > limit;
    if has_more {
        uids = uids.split_off(uids.len() - limit);
    }

    // Always silent: collect_notifications = false
    let (fetched_count, _max_uid, _notifs) =
        fetch_and_store_uids(&mut session, db_mutex, rec, &uids, rec.last_uid, folder_key, false)?;

    let _ = session.logout();
    Ok((fetched_count, has_more))
}

fn fetch_and_store_uids<T: std::io::Read + std::io::Write>(
    session: &mut imap::Session<T>,
    db_mutex: &Mutex<Database>,
    rec: &AccountSecretRecord,
    uids: &[u32],
    initial_max_uid: u32,
    folder_key: &str,
    collect_notifications: bool,
) -> Result<(usize, u32, Vec<SyncedMailNotification>), String> {
    let uid_set = uids
        .iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let fetches = session
        .uid_fetch(&uid_set, "(UID FLAGS BODY.PEEK[])")
        .map_err(|e| format!("拉取邮件内容失败: {}", e))?;

    let mut fetched_count = 0usize;
    let mut max_uid = initial_max_uid;
    let mut notifications = Vec::new();
    let mut pending_imap_moves: Vec<(u32, String)> = Vec::new();
    let parser = MessageParser::default();

    for fetch in fetches.iter() {
        let uid = match fetch.uid {
            Some(u) => u,
            None => continue,
        };
        if uid > max_uid {
            max_uid = uid;
        }
        let Some(raw) = fetch.body() else {
            continue;
        };
        let repaired_raw = repair_raw_mime_cesu8(raw);
        let Some(parsed) = parser.parse(&*repaired_raw) else {
            continue;
        };

        let msg_id = parsed.message_id().map(|s| s.to_string());
        let is_seen = fetch.flags().iter().any(|f| matches!(f, Flag::Seen));
        let is_flagged = fetch.flags().iter().any(|f| matches!(f, Flag::Flagged));

        let (sender_name, sender_email) = parsed
            .from()
            .and_then(|a| a.first())
            .map(|addr| {
                let email_addr = addr.address().unwrap_or("unknown@unknown").to_string();
                let name = addr
                    .name()
                    .map(|n| n.trim().to_string())
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| email_addr.split('@').next().unwrap_or("发件人").to_string());
                (name, email_addr)
            })
            .unwrap_or_else(|| ("未知发件人".into(), "unknown@unknown".into()));

        let mut harvested_contacts: Vec<DirectoryContact> = Vec::new();
        let now_contact_ts = Local::now().format("%Y-%m-%d %H:%M").to_string();
        if sender_email.contains('@') && sender_email != "unknown@unknown" {
            harvested_contacts.push(DirectoryContact {
                email: sender_email.to_lowercase(),
                name: sender_name.clone(),
                role: String::new(),
                department: String::new(),
                source: "email".into(),
                updated_at: now_contact_ts.clone(),
            });
        }

        let mut to_emails: Vec<String> = Vec::new();
        if let Some(to_field) = parsed.to() {
            for addr in to_field.iter() {
                if let Some(email_addr) = addr.address() {
                    let clean_email = email_addr.trim().to_lowercase();
                    if clean_email.contains('@') {
                        to_emails.push(clean_email.clone());
                        let name = addr
                            .name()
                            .map(|n| decode_html_entities(n.trim()))
                            .filter(|n| !n.is_empty())
                            .unwrap_or_default();
                        harvested_contacts.push(DirectoryContact {
                            email: clean_email,
                            name,
                            role: String::new(),
                            department: String::new(),
                            source: "email".into(),
                            updated_at: now_contact_ts.clone(),
                        });
                    }
                }
            }
        }
        let recipient_str = if to_emails.is_empty() {
            rec.account.email.clone()
        } else {
            to_emails.join(", ")
        };

        let mut cc_emails: Vec<String> = Vec::new();
        if let Some(cc_field) = parsed.cc() {
            for addr in cc_field.iter() {
                if let Some(email_addr) = addr.address() {
                    let clean_email = email_addr.trim().to_lowercase();
                    if clean_email.contains('@') {
                        cc_emails.push(clean_email.clone());
                        let name = addr
                            .name()
                            .map(|n| decode_html_entities(n.trim()))
                            .filter(|n| !n.is_empty())
                            .unwrap_or_default();
                        harvested_contacts.push(DirectoryContact {
                            email: clean_email,
                            name,
                            role: String::new(),
                            department: String::new(),
                            source: "email".into(),
                            updated_at: now_contact_ts.clone(),
                        });
                    }
                }
            }
        }
        let cc_opt = if cc_emails.is_empty() {
            None
        } else {
            Some(cc_emails.join(", "))
        };

        let subject = parsed
            .subject()
            .map(|s| decode_html_entities(s.trim()))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "（无主题）".into());

        let ts_ms = parsed
            .date()
            .map(|d| d.to_timestamp() * 1000)
            .unwrap_or_else(|| Local::now().timestamp_millis());

        let plain_body = extract_clean_body_text(&parsed);

        let mut paragraphs: Vec<String> = plain_body
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect();

        if paragraphs.is_empty() {
            paragraphs.push("（此邮件暂无纯文本正文）".into());
        }

        let preview: String = paragraphs
            .first()
            .cloned()
            .unwrap_or_default()
            .chars()
            .take(80)
            .collect();

        let initials = sender_name
            .chars()
            .next()
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_else(|| "邮".into());

        let email_id = if folder_key == "inbox" {
            format!("mail-imap-{}-{}", rec.account.id, uid)
        } else {
            format!("mail-imap-{}-{:x}-{}", rec.account.id, fnv1a_hash(folder_key), uid)
        };

        let db = db_mutex.lock().map_err(|_| "数据库锁异常".to_string())?;
        if db.has_email_by_uid_or_msgid(&rec.account.id, folder_key, uid, msg_id.as_deref()) {
            continue;
        }

        // Extract and safely cache attachments
        let mut att_list = Vec::new();
        for att_part in parsed.attachments() {
            let att_id = format!("att-{}", Uuid::new_v4());
            let raw_name = att_part
                .attachment_name()
                .unwrap_or("attachment.bin");
            let clean_name = sanitize_filename(raw_name);
            let bytes = att_part.contents();
            let mime = att_part
                .content_type()
                .map(|ct| match ct.subtype() {
                    Some(sub) => format!("{}/{}", ct.ctype(), sub),
                    None => ct.ctype().to_string(),
                })
                .unwrap_or_else(|| "application/octet-stream".into());

            let rel_path = db.write_attachment_to_cache(&att_id, &clean_name, bytes).ok();
            let size_bytes = bytes.len() as i64;
            att_list.push(EmailAttachment {
                id: att_id,
                name: clean_name,
                size: format_bytes(size_bytes),
                size_bytes,
                mime_type: mime,
                local_path: rel_path.clone(),
                cached: rel_path.is_some(),
                content_base64: None,
            });
        }

        let first_att = att_list.first().cloned();
        let mut mail = EmailItem {
            id: email_id,
            account_id: Some(rec.account.id.clone()),
            remote_uid: Some(uid),
            sender: sender_name.clone(),
            email: sender_email,
            recipient: Some(recipient_str),
            cc: cc_opt,
            avatar_img: None,
            initials,
            subject: subject.clone(),
            preview,
            time: format_short_time(ts_ms),
            full_time: format_full_time(ts_ms),
            timestamp_ms: ts_ms,
            unread: !is_seen,
            starred: is_flagged,
            archived: false,
            folder: folder_key.to_string(),
            tag: infer_default_tag(&subject),
            attachment: first_att,
            attachments: att_list,
            paragraphs,
            signoff: String::new(),
        };

        // Run blocklist & filter rules only for INBOX messages so custom folder emails stay in place
        if folder_key == "inbox" && db.evaluate_incoming_email(&mut mail) {
            continue;
        }

        // If a filter rule moved this incoming INBOX email into a remote IMAP folder, queue server-side move
        if folder_key == "inbox" && mail.folder.starts_with("imap:") {
            if let Ok(Some(target_folder)) = db.get_imap_folder(&mail.folder) {
                if target_folder.account_id == rec.account.id {
                    pending_imap_moves.push((uid, target_folder.raw_name));
                    mail.remote_uid = None;
                }
            }
        }

        db.insert_email(&mail, msg_id.as_deref())?;
        let _ = db.upsert_directory_contacts_batch(&harvested_contacts);
        fetched_count += 1;

        if collect_notifications && mail.unread && !mail.archived {
            notifications.push(SyncedMailNotification {
                sender: mail.sender,
                subject: mail.subject,
            });
        }
    }

    if !pending_imap_moves.is_empty() {
        let mut expunge_needed = false;
        for (move_uid, target_raw) in pending_imap_moves {
            let uid_str = move_uid.to_string();
            if session.uid_copy(&uid_str, &target_raw).is_ok() {
                let _ = session.uid_store(&uid_str, "+FLAGS.SILENT (\\Deleted)");
                expunge_needed = true;
            }
        }
        if expunge_needed {
            let _ = session.expunge();
        }
    }

    Ok((fetched_count, max_uid, notifications))
}

pub fn sync_flag_to_imap_blocking(
    rec: &AccountSecretRecord,
    mailbox_name: &str,
    remote_uid: u32,
    flag_cmd: &str,
) -> Result<(), String> {
    let host = rec.account.imap_host.as_deref().unwrap_or("").trim();
    let port = rec.account.imap_port.unwrap_or(993);
    if host.is_empty() || rec.auth_code.is_empty() {
        return Ok(());
    }
    let tls = TlsConnector::builder().build().map_err(|e| e.to_string())?;
    let client = imap::connect((host, port), host, &tls).map_err(|e| e.to_string())?;
    let mut session = client
        .login(&rec.account.email, &rec.auth_code)
        .map_err(|(e, _)| e.to_string())?;
    session.select(mailbox_name).map_err(|e| e.to_string())?;
    let _ = session.uid_store(remote_uid.to_string(), flag_cmd);
    let _ = session.logout();
    Ok(())
}

pub fn refetch_attachment_blocking(
    rec: &AccountSecretRecord,
    mailbox_name: &str,
    remote_uid: u32,
    part_index: usize,
) -> Result<Vec<u8>, String> {
    let host = rec.account.imap_host.as_deref().unwrap_or("").trim();
    let port = rec.account.imap_port.unwrap_or(993);
    if host.is_empty() || rec.auth_code.is_empty() {
        return Err("账户缺少 IMAP 凭证，无法重新拉取附件".into());
    }
    let tls = TlsConnector::builder().build().map_err(|e| e.to_string())?;
    let client = imap::connect((host, port), host, &tls).map_err(|e| format!("连接 IMAP 失败: {}", e))?;
    let mut session = client
        .login(&rec.account.email, &rec.auth_code)
        .map_err(|(e, _)| format!("IMAP 认证失败: {}", e))?;
    session.select(mailbox_name).map_err(|e| format!("打开文件夹失败: {}", e))?;

    let fetches = session
        .uid_fetch(remote_uid.to_string(), "BODY.PEEK[]")
        .map_err(|e| format!("拉取原邮件失败: {}", e))?;
    let raw = fetches
        .iter()
        .next()
        .and_then(|f| f.body())
        .ok_or_else(|| "服务器上已找不到该邮件".to_string())?;
    let parsed = MessageParser::default()
        .parse(raw)
        .ok_or_else(|| "解析邮件 MIME 失败".to_string())?;

    let part = parsed
        .attachments()
        .nth(part_index)
        .ok_or_else(|| "原邮件中未找到对应附件".to_string())?;
    let bytes = part.contents().to_vec();
    let _ = session.logout();
    Ok(bytes)
}

pub fn send_email_blocking(
    db_mutex: &Mutex<Database>,
    payload: &SendEmailPayload,
) -> Result<EmailItem, String> {
    if payload.recipients.is_empty() {
        return Err("请至少填写一位收件人".into());
    }

    let (secret_rec_opt, profile) = {
        let db = db_mutex.lock().map_err(|_| "数据库锁异常".to_string())?;
        let acc = db.get_account_with_secret(payload.account_id.as_deref())?;
        let prof = db.get_user_profile()?;
        (acc, prof)
    };

    let mut prepared_attachments: Vec<(EmailAttachment, Vec<u8>)> = Vec::new();
    for att in &payload.attachments {
        let bytes = if let Some(ref b64) = att.content_base64 {
            B64.decode(b64).map_err(|e| format!("解码附件内容失败: {}", e))?
        } else if let Some(ref path_str) = att.local_path {
            let p = Path::new(path_str);
            if p.exists() && p.is_file() {
                fs::read(p).map_err(|e| format!("读取本地附件失败: {}", e))?
            } else {
                let cached_path = db_mutex
                    .lock()
                    .ok()
                    .and_then(|db| db.safe_cache_path(path_str).ok());
                if let Some(cp) = cached_path.filter(|cp| cp.exists() && cp.is_file()) {
                    fs::read(cp).map_err(|e| format!("读取缓存附件失败: {}", e))?
                } else {
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        };
        let mut cloned = att.clone();
        if cloned.id.is_empty() {
            cloned.id = format!("att-{}", Uuid::new_v4());
        }
        if !bytes.is_empty() {
            cloned.size_bytes = bytes.len() as i64;
            cloned.size = format_bytes(cloned.size_bytes);
        }
        prepared_attachments.push((cloned, bytes));
    }

    // If a configured SMTP account with credentials exists, send via real SMTP TLS!
    let mut used_account_id = None;
    if let Some(rec) = secret_rec_opt {
        used_account_id = Some(rec.account.id.clone());
        let smtp_host = rec.account.smtp_host.as_deref().unwrap_or("").trim();
        let smtp_port = rec.account.smtp_port.unwrap_or(465);
        if !smtp_host.is_empty() && !rec.auth_code.is_empty() {
            let from_mailbox: Mailbox = format!("{} <{}>", profile.name, rec.account.email)
                .parse()
                .or_else(|_| rec.account.email.parse())
                .map_err(|e| format!("发件人邮箱格式无效: {}", e))?;

            let mut builder = Message::builder()
                .from(from_mailbox)
                .subject(&payload.subject);

            for rcpt in &payload.recipients {
                let cleaned = rcpt.trim();
                if cleaned.is_empty() {
                    continue;
                }
                let mb: Mailbox = cleaned
                    .parse()
                    .map_err(|e| format!("收件人地址 {} 格式无效: {}", cleaned, e))?;
                builder = builder.to(mb);
            }

            if !payload.cc.trim().is_empty() {
                for cc_addr in payload.cc.split(|c| c == ',' || c == ';') {
                    let cleaned = cc_addr.trim();
                    if cleaned.is_empty() {
                        continue;
                    }
                    let mb: Mailbox = cleaned
                        .parse()
                        .map_err(|e| format!("抄送地址 {} 格式无效: {}", cleaned, e))?;
                    builder = builder.cc(mb);
                }
            }

            let email_msg = if prepared_attachments.iter().any(|(_, b)| !b.is_empty()) {
                let mut multipart = MultiPart::mixed().singlepart(SinglePart::plain(payload.body.clone()));
                for (att, bytes) in &prepared_attachments {
                    if bytes.is_empty() {
                        continue;
                    }
                    let content_type = att
                        .mime_type
                        .parse::<ContentType>()
                        .unwrap_or(ContentType::parse("application/octet-stream").unwrap());
                    multipart = multipart.singlepart(
                        Attachment::new(sanitize_filename(&att.name)).body(bytes.clone(), content_type),
                    );
                }
                builder
                    .multipart(multipart)
                    .map_err(|e| format!("构建带附件邮件失败: {}", e))?
            } else {
                builder
                    .body(payload.body.clone())
                    .map_err(|e| format!("构建邮件正文失败: {}", e))?
            };

            let mailer = build_smtp_transport(smtp_host, smtp_port, &rec.account.email, &rec.auth_code)?;
            mailer
                .send(&email_msg)
                .map_err(|e| format!("SMTP 发送失败: {}", e))?;
        }
    }

    // Store sent email + cached attachments in local SQLite
    let now_ms = Local::now().timestamp_millis();
    let sent_id = format!("mail-sent-{}", Uuid::new_v4());
    let db = db_mutex.lock().map_err(|_| "数据库锁异常".to_string())?;

    let mut stored_atts = Vec::new();
    for (mut att, bytes) in prepared_attachments {
        if !bytes.is_empty() {
            if let Ok(rel) = db.write_attachment_to_cache(&att.id, &att.name, &bytes) {
                att.local_path = Some(rel);
                att.cached = true;
            }
        }
        att.content_base64 = None;
        stored_atts.push(att);
    }

    let lines: Vec<String> = payload
        .body
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    let preview = lines
        .first()
        .cloned()
        .unwrap_or_else(|| "（无正文）".into())
        .chars()
        .take(72)
        .collect();

    let first_rcpt = payload.recipients[0].clone();
    let mail = EmailItem {
        id: sent_id,
        account_id: used_account_id,
        remote_uid: None,
        sender: format!("我 → {}", first_rcpt.split('@').next().unwrap_or(&first_rcpt)),
        email: first_rcpt,
        recipient: Some(payload.recipients.join(", ")),
        cc: if payload.cc.trim().is_empty() {
            None
        } else {
            Some(payload.cc.trim().to_string())
        },
        avatar_img: None,
        initials: profile.initial.clone(),
        subject: payload.subject.clone(),
        preview,
        time: format_short_time(now_ms),
        full_time: format_full_time(now_ms),
        timestamp_ms: now_ms,
        unread: false,
        starred: false,
        archived: false,
        folder: "sent".into(),
        tag: infer_default_tag(&payload.subject),
        attachment: stored_atts.first().cloned(),
        attachments: stored_atts,
        paragraphs: if lines.is_empty() {
            vec!["（无正文）".into()]
        } else {
            lines
        },
        signoff: format!("祝好，{}", profile.name),
    };

    db.insert_email(&mail, None)?;

    // Harvest sent recipients & cc into directory_contacts for instant autocomplete
    let now_contact_ts = Local::now().format("%Y-%m-%d %H:%M").to_string();
    let mut sent_contacts: Vec<DirectoryContact> = Vec::new();
    for rcpt in &payload.recipients {
        for (n, e) in crate::db::parse_address_list_str(rcpt) {
            sent_contacts.push(DirectoryContact {
                email: e,
                name: n,
                role: String::new(),
                department: String::new(),
                source: "email".into(),
                updated_at: now_contact_ts.clone(),
            });
        }
    }
    if !payload.cc.trim().is_empty() {
        for (n, e) in crate::db::parse_address_list_str(&payload.cc) {
            sent_contacts.push(DirectoryContact {
                email: e,
                name: n,
                role: String::new(),
                department: String::new(),
                source: "email".into(),
                updated_at: now_contact_ts.clone(),
            });
        }
    }
    let _ = db.upsert_directory_contacts_batch(&sent_contacts);

    Ok(mail)
}

fn infer_default_tag(_subject: &str) -> String {
    String::new()
}

fn fnv1a_hash(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Decodes RFC 3501 Modified UTF-7 mailbox names (e.g. `&XfJT0ZAB-` -> `已发送`, `&U9dP4TDN-` -> Chinese folder).
pub fn decode_imap_utf7(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut out = String::with_capacity(len);
    let mut i = 0usize;

    while i < len {
        if bytes[i] == b'&' {
            if i + 1 < len && bytes[i + 1] == b'-' {
                out.push('&');
                i += 2;
                continue;
            }
            if let Some(dash_rel) = input[i + 1..].find('-') {
                let b64_mod = &input[i + 1..i + 1 + dash_rel];
                let standard_b64: String = b64_mod
                    .chars()
                    .map(|c| if c == ',' { '/' } else { c })
                    .collect();
                if let Ok(raw_bytes) = B64_NO_PAD.decode(standard_b64.as_bytes()) {
                    let utf16_units: Vec<u16> = raw_bytes
                        .chunks_exact(2)
                        .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                        .collect();
                    let decoded: String = char::decode_utf16(utf16_units)
                        .map(|r| r.unwrap_or('\u{FFFD}'))
                        .collect();
                    out.push_str(&decoded);
                    i += 1 + dash_rel + 1;
                    continue;
                }
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// Encodes a Unicode mailbox name into RFC 3501 Modified UTF-7 (e.g. `测试` -> `&bUuL1Q-`).
pub fn encode_imap_utf7(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    let mut non_ascii: Vec<u16> = Vec::new();

    let flush_non_ascii = |buf: &mut Vec<u16>, dest: &mut String| {
        if buf.is_empty() {
            return;
        }
        let mut bytes = Vec::with_capacity(buf.len() * 2);
        for unit in buf.iter() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        let b64 = B64_NO_PAD.encode(&bytes).replace('/', ",");
        dest.push('&');
        dest.push_str(&b64);
        dest.push('-');
        buf.clear();
    };

    for ch in input.chars() {
        let code = ch as u32;
        if (0x20..=0x7E).contains(&code) {
            flush_non_ascii(&mut non_ascii, &mut out);
            if ch == '&' {
                out.push_str("&-");
            } else {
                out.push(ch);
            }
        } else {
            let mut units = [0u16; 2];
            let encoded = ch.encode_utf16(&mut units);
            non_ascii.extend_from_slice(encoded);
        }
    }
    flush_non_ascii(&mut non_ascii, &mut out);
    out
}

fn classify_imap_folder(raw_name: &str, decoded: &str) -> (String, String) {
    let lower = decoded.trim().to_lowercase();
    let raw_lower = raw_name.trim().to_lowercase();

    if matches!(
        lower.as_str(),
        "sent" | "sent messages" | "sent items" | "sent mail" | "[gmail]/sent mail" | "已发送"
    ) || raw_lower == "&xfjt0zab-"
    {
        return ("sent".into(), "已发送（服务器）".into());
    }
    if matches!(
        lower.as_str(),
        "drafts" | "draft" | "[gmail]/drafts" | "草稿箱" | "草稿"
    ) {
        return ("drafts".into(), "草稿箱（服务器）".into());
    }
    if matches!(
        lower.as_str(),
        "junk" | "spam" | "junk e-mail" | "junk email" | "[gmail]/spam" | "垃圾邮件" | "垃圾箱"
    ) {
        return ("junk".into(), "垃圾邮件".into());
    }
    if matches!(
        lower.as_str(),
        "trash" | "deleted messages" | "deleted items" | "[gmail]/trash" | "已删除" | "废纸篓"
    ) {
        return ("trash".into(), "已删除".into());
    }
    if matches!(
        lower.as_str(),
        "archive" | "all mail" | "[gmail]/all mail" | "归档"
    ) {
        return ("archive".into(), "归档（服务器）".into());
    }

    // User-created custom folder! Strip noisy QQ/Exmail root wrapper like "其他文件夹/" if present
    let clean_display = decoded
        .strip_prefix("其他文件夹/")
        .or_else(|| decoded.strip_prefix("其他文件夹."))
        .or_else(|| decoded.strip_prefix("INBOX/"))
        .or_else(|| decoded.strip_prefix("INBOX."))
        .unwrap_or(decoded)
        .trim()
        .to_string();

    (
        "custom".into(),
        if clean_display.is_empty() {
            decoded.to_string()
        } else {
            clean_display
        },
    )
}

/// Picks the cleanest body text between `text/plain` and `text/html`:
/// if `text/plain` contains U+FFFD replacement chars while `text/html` has fewer, prefers `text/html`.
fn extract_clean_body_text(parsed: &mail_parser::Message<'_>) -> String {
    let text_opt = parsed.body_text(0).map(|t| decode_html_entities(&t));
    let html_opt = parsed.body_html(0).map(|h| strip_html_safely(&h));

    match (text_opt, html_opt) {
        (Some(text), Some(html)) => {
            let text_trimmed = text.trim();
            let html_trimmed = html.trim();
            if text_trimmed.is_empty() {
                return html;
            }
            let text_bad = text.chars().filter(|&c| c == '\u{FFFD}').count();
            if text_bad > 0 && !html_trimmed.is_empty() {
                let html_bad = html.chars().filter(|&c| c == '\u{FFFD}').count();
                if html_bad < text_bad {
                    return html;
                }
            }
            text
        }
        (Some(text), None) => text,
        (None, Some(html)) => html,
        (None, None) => String::new(),
    }
}

/// Repairs CESU-8 / UTF-16 surrogate-pair UTF-8 sequences (e.g. `ED A0 BC ED BE 89` for 🎉)
/// across raw 8-bit, Quoted-Printable, RFC 2047 Base64 headers, and Base64 `text/*` MIME parts.
/// Common in Chinese enterprise mailers (Foxmail, WeCom/Exmail, QQ Mail) where astral emojis
/// otherwise decode as 6x U+FFFD (``) under strict UTF-8.
fn repair_raw_mime_cesu8(raw: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    let mut current = std::borrow::Cow::Borrowed(raw);

    let (step1, c1) = repair_cesu8_bytes(current.as_ref());
    if c1 {
        current = std::borrow::Cow::Owned(step1);
    }

    let (step2, c2) = repair_qp_cesu8(current.as_ref());
    if c2 {
        current = std::borrow::Cow::Owned(step2);
    }

    let (step3, c3) = repair_rfc2047_base64_cesu8(current.as_ref());
    if c3 {
        current = std::borrow::Cow::Owned(step3);
    }

    let (step4, c4) = repair_base64_mime_parts_cesu8(current.as_ref());
    if c4 {
        current = std::borrow::Cow::Owned(step4);
    }

    current
}

fn decode_cesu8_pair(b: &[u8]) -> Option<char> {
    if b.len() < 6 {
        return None;
    }
    if b[0] == 0xED
        && (0xA0..=0xAF).contains(&b[1])
        && (0x80..=0xBF).contains(&b[2])
        && b[3] == 0xED
        && (0xB0..=0xBF).contains(&b[4])
        && (0x80..=0xBF).contains(&b[5])
    {
        let high = ((b[0] as u32 & 0x0F) << 12)
            | ((b[1] as u32 & 0x3F) << 6)
            | (b[2] as u32 & 0x3F);
        let low = ((b[3] as u32 & 0x0F) << 12)
            | ((b[4] as u32 & 0x3F) << 6)
            | (b[5] as u32 & 0x3F);
        let cp = 0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00);
        return char::from_u32(cp);
    }
    None
}

fn repair_cesu8_bytes(input: &[u8]) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let mut changed = false;
    let mut i = 0usize;
    let len = input.len();

    while i < len {
        if input[i] == 0xED && i + 5 < len {
            if let Some(ch) = decode_cesu8_pair(&input[i..i + 6]) {
                if !changed {
                    out.reserve(len);
                    out.extend_from_slice(&input[..i]);
                    changed = true;
                }
                let mut buf = [0u8; 4];
                out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                i += 6;
                continue;
            }
        }
        if changed {
            out.push(input[i]);
        }
        i += 1;
    }
    (out, changed)
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Reads 6 Quoted-Printable `=XX` bytes (skipping soft line breaks `=\r\n` / `=\n`) starting at `start`.
fn read_six_qp_bytes(input: &[u8], start: usize) -> Option<([u8; 6], usize)> {
    let mut bytes = [0u8; 6];
    let mut idx = start;
    let len = input.len();
    for slot in &mut bytes {
        loop {
            if idx + 1 < len && input[idx] == b'=' && input[idx + 1] == b'\n' {
                idx += 2;
                continue;
            }
            if idx + 2 < len && input[idx] == b'=' && input[idx + 1] == b'\r' && input[idx + 2] == b'\n' {
                idx += 3;
                continue;
            }
            break;
        }
        if idx + 2 >= len || input[idx] != b'=' {
            return None;
        }
        let hi = hex_nibble(input[idx + 1])?;
        let lo = hex_nibble(input[idx + 2])?;
        *slot = (hi << 4) | lo;
        idx += 3;
    }
    Some((bytes, idx))
}

fn repair_qp_cesu8(input: &[u8]) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let mut changed = false;
    let mut i = 0usize;
    let len = input.len();

    while i < len {
        if input[i] == b'=' && i + 2 < len {
            if let (Some(h), Some(l)) = (hex_nibble(input[i + 1]), hex_nibble(input[i + 2])) {
                if ((h << 4) | l) == 0xED {
                    if let Some((six, next_idx)) = read_six_qp_bytes(input, i) {
                        if let Some(ch) = decode_cesu8_pair(&six) {
                            if !changed {
                                out.reserve(len);
                                out.extend_from_slice(&input[..i]);
                                changed = true;
                            }
                            let mut buf = [0u8; 4];
                            for &b in ch.encode_utf8(&mut buf).as_bytes() {
                                out.extend_from_slice(format!("={:02X}", b).as_bytes());
                            }
                            i = next_idx;
                            continue;
                        }
                    }
                }
            }
        }
        if changed {
            out.push(input[i]);
        }
        i += 1;
    }
    (out, changed)
}

fn repair_rfc2047_base64_cesu8(input: &[u8]) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let mut changed = false;
    let mut i = 0usize;
    let len = input.len();

    while i + 8 < len {
        if input[i] == b'=' && input[i + 1] == b'?' {
            // Find charset?B?payload?= within 512 bytes
            let search_end = (i + 512).min(len);
            let slice = &input[i..search_end];
            if let Some(end_rel) = slice.windows(2).position(|w| w == b"?=").filter(|&p| p > 6) {
                let token = &slice[2..end_rel];
                let mut q_positions = token.iter().enumerate().filter_map(|(p, &b)| if b == b'?' { Some(p) } else { None });
                if let (Some(q1), Some(q2)) = (q_positions.next(), q_positions.next()) {
                    let charset = String::from_utf8_lossy(&token[..q1]).to_lowercase();
                    let enc = &token[q1 + 1..q2];
                    if (charset == "utf-8" || charset == "utf8") && enc.len() == 1 && (enc[0] == b'B' || enc[0] == b'b') {
                        let b64_payload = &token[q2 + 1..];
                        if let Ok(decoded) = B64.decode(b64_payload) {
                            let (fixed, was_fixed) = repair_cesu8_bytes(&decoded);
                            if was_fixed {
                                if !changed {
                                    out.reserve(len);
                                    out.extend_from_slice(&input[..i]);
                                    changed = true;
                                }
                                out.extend_from_slice(&slice[..2 + q2 + 1]);
                                out.extend_from_slice(B64.encode(&fixed).as_bytes());
                                out.extend_from_slice(b"?=");
                                i += end_rel + 2;
                                continue;
                            }
                        }
                    }
                }
            }
        }
        if changed {
            out.push(input[i]);
        }
        i += 1;
    }

    if changed && i < len {
        out.extend_from_slice(&input[i..]);
    }
    (out, changed)
}

fn repair_base64_mime_parts_cesu8(input: &[u8]) -> (Vec<u8>, bool) {
    let mut out = Vec::with_capacity(input.len());
    let mut any_changed = false;

    let mut in_headers = true;
    let mut is_base64 = false;
    let mut saw_content_type = false;
    let mut is_text = false;
    let mut b64_buf: Vec<u8> = Vec::new();

    let flush_b64_buf = |buf: &mut Vec<u8>, out: &mut Vec<u8>, any_changed: &mut bool| {
        if buf.is_empty() {
            return;
        }
        let compact: Vec<u8> = buf
            .iter()
            .copied()
            .filter(|b| !b.is_ascii_whitespace())
            .collect();
        let decoded_opt = B64.decode(&compact).ok().or_else(|| {
            let trimmed: Vec<u8> = compact.iter().copied().filter(|&b| b != b'=').collect();
            B64_NO_PAD.decode(&trimmed).ok()
        });
        if let Some(decoded) = decoded_opt {
            let (fixed, was_fixed) = repair_cesu8_bytes(&decoded);
            if was_fixed {
                let reencoded = B64.encode(&fixed);
                for chunk in reencoded.as_bytes().chunks(76) {
                    out.extend_from_slice(chunk);
                    out.extend_from_slice(b"\r\n");
                }
                *any_changed = true;
                buf.clear();
                return;
            }
        }
        out.extend_from_slice(buf);
        buf.clear();
    };

    let mut pos = 0usize;
    let len = input.len();

    while pos < len {
        let nl_rel = input[pos..].iter().position(|&b| b == b'\n');
        let line_end = match nl_rel {
            Some(r) => pos + r + 1,
            None => len,
        };
        let line = &input[pos..line_end];
        pos = line_end;

        let trimmed_line = strip_crlf(line);

        if trimmed_line.starts_with(b"--") && trimmed_line.len() >= 4 {
            flush_b64_buf(&mut b64_buf, &mut out, &mut any_changed);
            out.extend_from_slice(line);
            in_headers = true;
            is_base64 = false;
            saw_content_type = false;
            is_text = false;
            continue;
        }

        if in_headers {
            out.extend_from_slice(line);
            if trimmed_line.is_empty() {
                in_headers = false;
                if !saw_content_type {
                    is_text = true;
                }
            } else {
                let lower = String::from_utf8_lossy(trimmed_line).to_lowercase();
                if lower.starts_with("content-transfer-encoding:") && lower.contains("base64") {
                    is_base64 = true;
                } else if lower.starts_with("content-type:") {
                    saw_content_type = true;
                    if lower.contains("text/") {
                        is_text = true;
                    }
                }
            }
            continue;
        }

        if is_base64 && is_text {
            b64_buf.extend_from_slice(line);
        } else {
            out.extend_from_slice(line);
        }
    }

    flush_b64_buf(&mut b64_buf, &mut out, &mut any_changed);
    (out, any_changed)
}

fn strip_crlf(line: &[u8]) -> &[u8] {
    let mut end = line.len();
    while end > 0 && (line[end - 1] == b'\r' || line[end - 1] == b'\n') {
        end -= 1;
    }
    &line[..end]
}

/// Safe, zero-dependency HTML-to-plain-text extractor so untrusted HTML emails
/// are never injected into the DOM as raw HTML.
fn strip_html_safely(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let mut in_skip_block = false;
    let mut tag_buf = String::new();

    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            tag_buf.clear();
            continue;
        }
        if ch == '>' {
            in_tag = false;
            let trimmed = tag_buf.trim();
            let lower = trimmed.to_lowercase();
            if lower.starts_with("script") || lower.starts_with("style") {
                in_skip_block = true;
            } else if lower.starts_with("/script") || lower.starts_with("/style") {
                in_skip_block = false;
            } else if !in_skip_block && lower.starts_with("img") {
                if let Some(alt_text) = extract_img_emoji_alt(trimmed) {
                    out.push_str(&alt_text);
                }
            } else if lower.starts_with("br")
                || lower.starts_with("/p")
                || lower.starts_with("/div")
                || lower.starts_with("/li")
                || lower.starts_with("/tr")
                || lower.starts_with("/h")
            {
                out.push('\n');
            }
            continue;
        }
        if in_tag {
            if tag_buf.len() < 256 {
                tag_buf.push(ch);
            }
        } else if !in_skip_block {
            out.push(ch);
        }
    }

    decode_html_entities(&out)
}

/// Preserves short emoji/expression alt text on inline `<img>` tags (e.g. WeCom/QQ emoji images).
fn extract_img_emoji_alt(tag_inner: &str) -> Option<String> {
    let alt_pos = tag_inner
        .as_bytes()
        .windows(4)
        .position(|w| w.eq_ignore_ascii_case(b"alt="))?;
    let rest = &tag_inner[alt_pos + 4..];
    let (quote, after_q) = if let Some(s) = rest.strip_prefix('"') {
        ('"', s)
    } else if let Some(s) = rest.strip_prefix('\'') {
        ('\'', s)
    } else {
        return None;
    };
    let end = after_q.find(quote)?;
    let val = decode_html_entities(after_q[..end].trim());
    let char_len = val.chars().count();
    if char_len == 0 || char_len > 10 {
        return None;
    }
    let val_lower = val.to_lowercase();
    if val_lower.contains(".png")
        || val_lower.contains(".jpg")
        || val_lower.contains(".gif")
        || val_lower == "image"
        || val_lower == "img"
        || val_lower == "logo"
    {
        return None;
    }
    let has_emoji = val.chars().any(|c| (c as u32) >= 0x2600);
    let is_bracket_expr = val.starts_with('[') && val.ends_with(']');
    if has_emoji || is_bracket_expr {
        Some(val)
    } else {
        None
    }
}

pub fn decode_html_entities(input: &str) -> String {
    let mut cur = input.replace('\u{00a0}', " ");
    for _ in 0..3 {
        if !cur.contains('&') {
            break;
        }
        let named = cur
            .replace("&amp;", "&")
            .replace("&AMP;", "&")
            .replace("&nbsp;", " ")
            .replace("&NBSP;", " ")
            .replace("&Nbsp;", " ")
            .replace("&ensp;", " ")
            .replace("&emsp;", " ")
            .replace("&thinsp;", " ")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&mdash;", "—")
            .replace("&ndash;", "–")
            .replace("&hellip;", "…");
        let next = decode_numeric_html_entities(&named);
        if next == cur {
            break;
        }
        cur = next;
    }
    cur
}

/// Decodes decimal (`&#127881;`) and hex (`&#x1F389;`) numeric HTML entities,
/// including combining UTF-16 surrogate pairs (`&#55356;&#57225;` / `&#xD83C;&#xDF89;`) into emoji.
fn decode_numeric_html_entities(input: &str) -> String {
    if !input.contains("&#") {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let mut pending_high_surrogate: Option<u32> = None;
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0usize;

    while i < len {
        if bytes[i] == b'&' && i + 2 < len && bytes[i + 1] == b'#' {
            if let Some(semi_rel) = input[i + 2..].find(';') {
                if semi_rel >= 1 && semi_rel <= 10 {
                    let body = &input[i + 2..i + 2 + semi_rel];
                    let parsed_code = if let Some(hex) = body.strip_prefix('x').or_else(|| body.strip_prefix('X')) {
                        u32::from_str_radix(hex, 16).ok()
                    } else {
                        body.parse::<u32>().ok()
                    };

                    if let Some(code) = parsed_code {
                        if (0xD800..=0xDBFF).contains(&code) {
                            pending_high_surrogate = Some(code);
                            i += 2 + semi_rel + 1;
                            continue;
                        }
                        if (0xDC00..=0xDFFF).contains(&code) {
                            if let Some(high) = pending_high_surrogate.take() {
                                let cp = 0x10000 + ((high - 0xD800) << 10) + (code - 0xDC00);
                                if let Some(ch) = char::from_u32(cp) {
                                    out.push(ch);
                                    i += 2 + semi_rel + 1;
                                    continue;
                                }
                            }
                        } else {
                            pending_high_surrogate = None;
                            if code == 0xA0 {
                                out.push(' ');
                                i += 2 + semi_rel + 1;
                                continue;
                            }
                            if code >= 0x20 {
                                if let Some(ch) = char::from_u32(code) {
                                    out.push(ch);
                                    i += 2 + semi_rel + 1;
                                    continue;
                                }
                            }
                        }
                    }
                }
            }
        }
        pending_high_surrogate = None;
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

use crate::db::{format_bytes, format_full_time, format_short_time, sanitize_filename, AccountSecretRecord, Database};
use crate::models::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
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

    let tls = TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS 初始化失败: {}", e))?;
    let client = imap::connect((host, port), host, &tls)
        .map_err(|e| format!("连接 {} 失败: {}", host, e))?;
    let mut session = client
        .login(&rec.account.email, &rec.auth_code)
        .map_err(|(e, _)| format!("账户 {} IMAP 登录失败: {}", rec.account.email, e))?;

    session
        .select("INBOX")
        .map_err(|e| format!("打开收件箱失败: {}", e))?;

    let uid_query = if rec.last_uid > 0 {
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
    if rec.last_uid == 0 && uids.len() > 30 {
        uids = uids.split_off(uids.len() - 30);
    }

    if uids.is_empty() {
        let now_str = Local::now().format("%H:%M:%S").to_string();
        if let Ok(db) = db_mutex.lock() {
            let _ = db.update_account_sync_cursor(&rec.account.id, rec.last_uid, &now_str);
        }
        let _ = session.logout();
        return Ok((0, vec![]));
    }

    let uid_set = uids
        .iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let fetches = session
        .uid_fetch(&uid_set, "(UID FLAGS BODY.PEEK[])")
        .map_err(|e| format!("拉取邮件内容失败: {}", e))?;

    let mut fetched_count = 0usize;
    let mut max_uid = rec.last_uid;
    let mut notifications = Vec::new();
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
        let Some(parsed) = parser.parse(raw) else {
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

        let recipient_str = parsed
            .to()
            .and_then(|a| a.first())
            .and_then(|addr| addr.address())
            .map(|s| s.to_string())
            .unwrap_or_else(|| rec.account.email.clone());

        let subject = parsed
            .subject()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "（无主题）".into());

        let ts_ms = parsed
            .date()
            .map(|d| d.to_timestamp() * 1000)
            .unwrap_or_else(|| Local::now().timestamp_millis());

        let plain_body = if let Some(text) = parsed.body_text(0) {
            text.into_owned()
        } else if let Some(html) = parsed.body_html(0) {
            strip_html_safely(&html)
        } else {
            String::new()
        };

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

        let email_id = format!("mail-imap-{}-{}", rec.account.id, uid);

        let db = db_mutex.lock().map_err(|_| "数据库锁异常".to_string())?;
        if db.has_email_by_uid_or_msgid(&rec.account.id, uid, msg_id.as_deref()) {
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
            cc: None,
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
            folder: "inbox".into(),
            tag: infer_default_tag(&subject),
            attachment: first_att,
            attachments: att_list,
            paragraphs,
            signoff: String::new(),
        };

        // Run blocklist & filter rules before persisting
        if db.evaluate_incoming_email(&mut mail) {
            continue;
        }

        db.insert_email(&mail, msg_id.as_deref())?;
        fetched_count += 1;

        if mail.unread && !mail.archived {
            notifications.push(SyncedMailNotification {
                sender: mail.sender,
                subject: mail.subject,
            });
        }
    }

    let now_str = Local::now().format("%H:%M:%S").to_string();
    if let Ok(db) = db_mutex.lock() {
        let _ = db.update_account_sync_cursor(&rec.account.id, max_uid, &now_str);
    }
    let _ = session.logout();
    Ok((fetched_count, notifications))
}

pub fn sync_flag_to_imap_blocking(
    rec: &AccountSecretRecord,
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
    session.select("INBOX").map_err(|e| e.to_string())?;
    let _ = session.uid_store(remote_uid.to_string(), flag_cmd);
    let _ = session.logout();
    Ok(())
}

pub fn refetch_attachment_blocking(
    rec: &AccountSecretRecord,
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
    session.select("INBOX").map_err(|e| format!("打开收件箱失败: {}", e))?;

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
                Vec::new()
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
    Ok(mail)
}

fn infer_default_tag(subject: &str) -> String {
    let s = subject.to_lowercase();
    if s.contains("发票") || s.contains("账单") || s.contains("invoice") || s.contains("receipt") {
        "财务票据".into()
    } else if s.contains("会议") || s.contains("日程") || s.contains("calendar") {
        "日程通知".into()
    } else if s.contains("测试") || s.contains("发布") || s.contains("研发") || s.contains("github") {
        "工程研发".into()
    } else if s.contains("周刊") || s.contains("digest") || s.contains("newsletter") {
        "精选订阅".into()
    } else if s.contains("合作") || s.contains("品牌") || s.contains("协议") {
        "品牌合作".into()
    } else {
        "设计评审".into()
    }
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
            let lower = tag_buf.trim().to_lowercase();
            if lower.starts_with("script") || lower.starts_with("style") {
                in_skip_block = true;
            } else if lower.starts_with("/script") || lower.starts_with("/style") {
                in_skip_block = false;
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
            if tag_buf.len() < 32 {
                tag_buf.push(ch);
            }
        } else if !in_skip_block {
            out.push(ch);
        }
    }

    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

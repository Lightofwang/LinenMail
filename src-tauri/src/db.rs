use crate::crypto::LocalCipher;
use crate::models::*;
use chrono::{DateTime, Local, TimeZone};
use directories::ProjectDirs;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub struct AccountSecretRecord {
    pub account: ConnectedAccount,
    pub auth_code: String,
    pub last_uid: u32,
}

pub struct AttachmentCacheRecord {
    pub id: String,
    pub email_id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub cache_rel_path: Option<String>,
    pub part_index: usize,
}

pub struct Database {
    conn: Connection,
    cipher: LocalCipher,
    pub data_dir: PathBuf,
    pub attachments_dir: PathBuf,
    pub db_path: PathBuf,
    pub portable_mode: bool,
}

impl Database {
    pub fn initialize() -> Result<Self, String> {
        let (data_dir, portable_mode) = resolve_data_dir()?;
        fs::create_dir_all(&data_dir).map_err(|e| format!("无法创建数据目录: {}", e))?;

        let attachments_dir = data_dir.join("attachments");
        fs::create_dir_all(&attachments_dir).map_err(|e| format!("无法创建附件目录: {}", e))?;

        let cipher = LocalCipher::load_or_create(&data_dir)?;
        let db_path = data_dir.join("linenmail.db");

        let conn = Connection::open(&db_path).map_err(|e| format!("无法打开本地 SQLite 数据库: {}", e))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;",
        )
        .map_err(|e| format!("数据库初始化参数失败: {}", e))?;

        let db = Self {
            conn,
            cipher,
            data_dir,
            attachments_dir,
            db_path,
            portable_mode,
        };
        db.run_migrations()?;
        db.seed_defaults_if_empty()?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS accounts (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    badge_char TEXT NOT NULL,
                    description TEXT NOT NULL,
                    is_default INTEGER NOT NULL DEFAULT 0,
                    provider TEXT NOT NULL DEFAULT '自定义 IMAP',
                    imap_host TEXT NOT NULL DEFAULT '',
                    imap_port INTEGER NOT NULL DEFAULT 993,
                    smtp_host TEXT NOT NULL DEFAULT '',
                    smtp_port INTEGER NOT NULL DEFAULT 465,
                    auth_code_enc TEXT NOT NULL DEFAULT '',
                    last_uid INTEGER NOT NULL DEFAULT 0,
                    last_sync_at TEXT
                );

                CREATE TABLE IF NOT EXISTS emails (
                    id TEXT PRIMARY KEY,
                    account_id TEXT,
                    remote_uid INTEGER,
                    message_id TEXT,
                    sender TEXT NOT NULL,
                    email TEXT NOT NULL,
                    recipient TEXT,
                    cc TEXT,
                    avatar_img TEXT,
                    initials TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    preview TEXT NOT NULL,
                    time_label TEXT NOT NULL,
                    full_time TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    unread INTEGER NOT NULL DEFAULT 1,
                    starred INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    deleted INTEGER NOT NULL DEFAULT 0,
                    folder TEXT NOT NULL DEFAULT 'inbox',
                    tag TEXT NOT NULL DEFAULT '设计评审',
                    paragraphs_json TEXT NOT NULL,
                    signoff TEXT NOT NULL DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_emails_folder_time ON emails(folder, deleted, timestamp_ms DESC);
                CREATE INDEX IF NOT EXISTS idx_emails_account_uid ON emails(account_id, remote_uid);
                CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);

                CREATE TABLE IF NOT EXISTS attachments (
                    id TEXT PRIMARY KEY,
                    email_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                    size_bytes INTEGER NOT NULL DEFAULT 0,
                    size_label TEXT NOT NULL,
                    cache_rel_path TEXT,
                    part_index INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments(email_id);

                CREATE TABLE IF NOT EXISTS smart_folders (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    icon TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    conditions_json TEXT NOT NULL,
                    action_text TEXT NOT NULL,
                    tag TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS labels (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    dot_class TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS filter_rules (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    condition_text TEXT NOT NULL,
                    action_text TEXT NOT NULL,
                    hits INTEGER NOT NULL DEFAULT 0,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    logic TEXT,
                    conditions_json TEXT,
                    has_attachment INTEGER,
                    action_tag TEXT,
                    action_archive INTEGER,
                    action_mark_read INTEGER,
                    action_star INTEGER
                );

                CREATE TABLE IF NOT EXISTS llm_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    api_key_enc TEXT NOT NULL DEFAULT '',
                    model TEXT NOT NULL,
                    temperature REAL NOT NULL DEFAULT 0.3,
                    active INTEGER NOT NULL DEFAULT 0,
                    enable_translate INTEGER NOT NULL DEFAULT 1,
                    enable_polish INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS drafts (
                    id TEXT PRIMARY KEY,
                    recipients_json TEXT NOT NULL,
                    cc TEXT NOT NULL DEFAULT '',
                    subject TEXT NOT NULL DEFAULT '',
                    body TEXT NOT NULL DEFAULT '',
                    attachments_json TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS scheduled_emails (
                    id TEXT PRIMARY KEY,
                    account_id TEXT,
                    recipients_json TEXT NOT NULL,
                    cc TEXT NOT NULL DEFAULT '',
                    subject TEXT NOT NULL,
                    body TEXT NOT NULL,
                    attachments_json TEXT NOT NULL DEFAULT '[]',
                    scheduled_at_ms INTEGER NOT NULL,
                    scheduled_label TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending'
                );

                CREATE TABLE IF NOT EXISTS kv_store (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );
                ",
            )
            .map_err(|e| format!("数据库表结构迁移失败: {}", e))
    }

    fn seed_defaults_if_empty(&self) -> Result<(), String> {
        let label_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM labels", [], |r| r.get(0))
            .unwrap_or(0);

        if label_count == 0 {
            let defaults = [
                ("lbl-1", "设计评审", "bg-light-primary"),
                ("lbl-2", "品牌合作", "bg-light-secondary"),
                ("lbl-3", "工程研发", "bg-light-tertiary"),
                ("lbl-4", "精选订阅", "bg-light-primary-container"),
                ("lbl-5", "日程通知", "bg-light-on-surface-variant"),
                ("lbl-6", "财务票据", "bg-light-secondary"),
            ];
            for (id, name, dot) in defaults {
                let _ = self.conn.execute(
                    "INSERT OR IGNORE INTO labels (id, name, dot_class) VALUES (?1, ?2, ?3)",
                    params![id, name, dot],
                );
            }
        }

        let sf_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM smart_folders", [], |r| r.get(0))
            .unwrap_or(0);

        if sf_count == 0 {
            let folders = [
                (
                    "sf-1",
                    "设计评审与反馈",
                    "palette",
                    vec!["主题包含 \"设计\"", "主题包含 \"排版\"", "发件人 @atelier.cn"],
                    "自动添加标签「设计评审」，并保留在收件箱优先展示。",
                    "设计评审",
                ),
                (
                    "sf-2",
                    "精选周刊与订阅",
                    "auto_stories",
                    vec!["发件人包含 digest@", "发件人包含 newsletter@", "含退订链接"],
                    "自动添加标签「精选订阅」，跳过收件箱归入每日阅读角。",
                    "精选订阅",
                ),
                (
                    "sf-3",
                    "财务票据与账单",
                    "receipt_long",
                    vec!["主题包含 \"发票\"", "主题包含 \"账单\"", "包含 PDF 附件"],
                    "自动添加标签「财务票据」，并标记为低打扰归档备查。",
                    "财务票据",
                ),
                (
                    "sf-4",
                    "工程研发与发布",
                    "terminal",
                    vec!["发件人 @nexuslab.io", "主题包含 \"测试报告\""],
                    "自动添加标签「工程研发」，保留在收件箱并开启桌面提醒。",
                    "工程研发",
                ),
            ];
            for (id, name, icon, conds, action, tag) in folders {
                let cond_json = serde_json::to_string(&conds).unwrap_or_else(|_| "[]".into());
                let _ = self.conn.execute(
                    "INSERT OR IGNORE INTO smart_folders (id, name, icon, enabled, conditions_json, action_text, tag) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6)",
                    params![id, name, icon, cond_json, action, tag],
                );
            }
        }

        let flt_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM filter_rules", [], |r| r.get(0))
            .unwrap_or(0);

        if flt_count == 0 {
            let cond_invoice = serde_json::to_string(&vec![
                FilterCondition {
                    field: "发件人".into(),
                    op: "包含".into(),
                    value: "billing@".into(),
                },
                FilterCondition {
                    field: "主题".into(),
                    op: "包含".into(),
                    value: "发票".into(),
                },
            ])
            .unwrap_or_else(|_| "[]".into());
            let _ = self.conn.execute(
                "INSERT OR IGNORE INTO filter_rules
                 (id, name, condition_text, action_text, hits, enabled, logic, conditions_json, has_attachment, action_tag, action_archive, action_mark_read, action_star)
                 VALUES (?1, ?2, ?3, ?4, 0, 1, 'OR', ?5, 0, '财务票据', 0, 1, 0)",
                params![
                    "flt-3",
                    "账单与电子发票归档",
                    "发件人包含 \"billing@\" 或 主题包含 \"发票\"",
                    "添加标签「财务票据」、自动标记为已读",
                    cond_invoice
                ],
            );
        }

        let llm_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM llm_profiles", [], |r| r.get(0))
            .unwrap_or(0);

        if llm_count == 0 {
            let _ = self.conn.execute(
                "INSERT OR IGNORE INTO llm_profiles (id, name, base_url, api_key_enc, model, temperature, active, enable_translate, enable_polish)
                 VALUES ('llm-1', 'OpenAI 官方 / 默认', 'https://api.openai.com/v1', '', 'gpt-4o-mini', 0.3, 1, 1, 1)",
                [],
            );
            let _ = self.conn.execute(
                "INSERT OR IGNORE INTO llm_profiles (id, name, base_url, api_key_enc, model, temperature, active, enable_translate, enable_polish)
                 VALUES ('llm-2', 'DeepSeek V3 (OpenAI 兼容)', 'https://api.deepseek.com/v1', '', 'deepseek-chat', 0.3, 0, 1, 1)",
                [],
            );
        }

        if self.get_kv::<UserProfile>("user_profile")?.is_none() {
            let default_profile = UserProfile {
                name: "周明远".into(),
                initial: "周".into(),
                primary_email: "zhou@linenmail.cn".into(),
                signature: "祝好，\n周明远 · 产品设计负责人\nAtelier Studio".into(),
                undo_seconds: 10,
                minimal_reading: true,
                enable_shortcuts: true,
                quiet_night_mode: false,
            };
            self.set_kv("user_profile", &default_profile)?;
        }

        if self.get_kv::<SystemSettingsState>("system_settings")?.is_none() {
            let default_settings = SystemSettingsState {
                vacation_responder: false,
                auto_forward: false,
                blocklist: vec!["promo@ads-network.cn".into(), "@spam-digest.io".into()],
                sync_frequency: "每 5 分钟".into(),
                cache_text: "本地附件缓存当前占用 0 KB".into(),
                minimize_to_tray: true,
                desktop_notifications: true,
                cache_bytes: 0,
                db_size_bytes: 0,
            };
            self.set_kv("system_settings", &default_settings)?;
        }

        let email_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM emails", [], |r| r.get(0))
            .unwrap_or(0);

        if email_count == 0 {
            let now_ms = Local::now().timestamp_millis();
            let welcome = EmailItem {
                id: "mail-welcome-1".into(),
                account_id: None,
                remote_uid: None,
                sender: "素笺 LinenMail".into(),
                email: "welcome@linenmail.cn".into(),
                recipient: Some("我".into()),
                cc: None,
                avatar_img: None,
                initials: "素".into(),
                subject: "欢迎使用素笺 LinenMail Windows 桌面版（SQLite 本地引擎已就绪）".into(),
                preview: "您的数据已保存在本地 SQLite 数据库中。点击右上角个人头像或「打开邮箱初始化连接向导」即可直连 QQ、163、Gmail 或企业 IMAP/SMTP 邮箱...",
                time: "刚刚".into(),
                full_time: format_full_time(now_ms),
                timestamp_ms: now_ms,
                unread: true,
                starred: true,
                archived: false,
                folder: "inbox".into(),
                tag: "设计评审".into(),
                attachment: None,
                attachments: vec![],
                paragraphs: vec![
                    "您好，欢迎来到素笺 LinenMail 桌面端：".into(),
                    "当前版本已内置本地 SQLite 邮件数据库、AES-256-GCM 本地凭证加密、真实 IMAP/SMTP 收发引擎、Windows 系统托盘常驻与原生附件另存为能力。".into(),
                    "下一步您可以点击右上角头像进入「账户管理」或「邮箱初始化连接向导」，填入 QQ 邮箱 / 网易 163 / Gmail / 企业邮的邮箱地址与授权码，完成测试连接后即可一键同步全部往来邮件。".into(),
                ],
                signoff: "愿每日收件都能回归纸张般的宁静。\n素笺 LinenMail 团队".into(),
            };
            self.insert_email(&welcome, None)?;
        }

        Ok(())
    }

    pub fn get_kv<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>, String> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT value_json FROM kv_store WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("读取配置失败: {}", e))?;
        match raw {
            Some(s) => serde_json::from_str(&s)
                .map(Some)
                .map_err(|e| format!("解析配置失败: {}", e)),
            None => Ok(None),
        }
    }

    pub fn set_kv<T: serde::Serialize>(&self, key: &str, value: &T) -> Result<(), String> {
        let json = serde_json::to_string(value).map_err(|e| format!("序列化配置失败: {}", e))?;
        self.conn
            .execute(
                "INSERT INTO kv_store (key, value_json) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
                params![key, json],
            )
            .map_err(|e| format!("保存配置失败: {}", e))?;
        Ok(())
    }

    pub fn get_user_profile(&self) -> Result<UserProfile, String> {
        Ok(self.get_kv::<UserProfile>("user_profile")?.unwrap_or(UserProfile {
            name: "周明远".into(),
            initial: "周".into(),
            primary_email: "zhou@linenmail.cn".into(),
            signature: "祝好，\n周明远".into(),
            undo_seconds: 10,
            minimal_reading: true,
            enable_shortcuts: true,
            quiet_night_mode: false,
        }))
    }

    pub fn get_system_settings(&self) -> Result<SystemSettingsState, String> {
        let mut settings = self
            .get_kv::<SystemSettingsState>("system_settings")?
            .unwrap_or(SystemSettingsState {
                vacation_responder: false,
                auto_forward: false,
                blocklist: vec![],
                sync_frequency: "每 5 分钟".into(),
                cache_text: String::new(),
                minimize_to_tray: true,
                desktop_notifications: true,
                cache_bytes: 0,
                db_size_bytes: 0,
            });
        let stats = self.get_cache_stats();
        settings.cache_bytes = stats.cache_bytes;
        settings.db_size_bytes = stats.db_size_bytes;
        settings.cache_text = stats.cache_text;
        Ok(settings)
    }

    pub fn get_cache_stats(&self) -> CacheStats {
        let mut cache_bytes: i64 = 0;
        let mut cached_files: usize = 0;
        if let Ok(entries) = fs::read_dir(&self.attachments_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        cache_bytes += meta.len() as i64;
                        cached_files += 1;
                    }
                }
            }
        }
        let db_size_bytes = fs::metadata(&self.db_path)
            .map(|m| m.len() as i64)
            .unwrap_or(0);

        let cache_text = format!(
            "已缓存 {} 个附件（占用 {}） · 本地数据库 {}",
            cached_files,
            format_bytes(cache_bytes),
            format_bytes(db_size_bytes)
        );

        CacheStats {
            cache_bytes,
            db_size_bytes,
            cached_files,
            cache_text,
            data_dir: self.data_dir.to_string_lossy().to_string(),
            portable_mode: self.portable_mode,
        }
    }

    pub fn clear_attachment_cache(&self) -> Result<CacheStats, String> {
        if let Ok(entries) = fs::read_dir(&self.attachments_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let _ = fs::remove_file(path);
                }
            }
        }
        self.conn
            .execute("UPDATE attachments SET cache_rel_path = NULL", [])
            .map_err(|e| format!("更新附件缓存状态失败: {}", e))?;
        Ok(self.get_cache_stats())
    }

    pub fn write_attachment_to_cache(&self, att_id: &str, orig_name: &str, data: &[u8]) -> Result<String, String> {
        let clean = sanitize_filename(orig_name);
        let rel = format!("{}_{}", att_id, clean);
        let target = self.safe_cache_path(&rel)?;
        fs::write(&target, data).map_err(|e| format!("写入附件缓存失败: {}", e))?;
        Ok(rel)
    }

    pub fn safe_cache_path(&self, rel_name: &str) -> Result<PathBuf, String> {
        if rel_name.is_empty()
            || rel_name.contains('/')
            || rel_name.contains('\\')
            || rel_name.contains("..")
            || rel_name.contains('\0')
        {
            return Err("非法的附件缓存路径".into());
        }
        let candidate = self.attachments_dir.join(rel_name);
        let base_canon = self
            .attachments_dir
            .canonicalize()
            .unwrap_or_else(|_| self.attachments_dir.clone());
        let parent_canon = candidate
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .unwrap_or_else(|| self.attachments_dir.clone());
        if parent_canon != base_canon {
            return Err("附件路径越界被拒绝".into());
        }
        Ok(candidate)
    }

    pub fn save_account(&self, input: &AccountConfigInput) -> Result<ConnectedAccount, String> {
        let email = input.email.trim().to_lowercase();
        if email.is_empty() || !email.contains('@') {
            return Err("请输入有效的邮箱地址".into());
        }

        let existing_id: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM accounts WHERE lower(email) = ?1",
                params![email],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("查询账户失败: {}", e))?;

        let id = input
            .id
            .clone()
            .or(existing_id)
            .unwrap_or_else(|| format!("acc-{}", Uuid::new_v4()));

        let total_accounts: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
            .unwrap_or(0);
        let is_default = input.is_default || total_accounts == 0;

        if is_default {
            let _ = self.conn.execute("UPDATE accounts SET is_default = 0", []);
        }

        let label = input
            .label
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(input.provider.as_str());
        let badge = input
            .badge_char
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| label.chars().next().map(|c| c.to_string()).unwrap_or_else(|| "邮".into()));
        let description = format!("{} · IMAP/SMTP 已连接", label);

        let encrypted_auth = if !input.auth_code.trim().is_empty() {
            self.cipher.encrypt(input.auth_code.trim())?
        } else {
            self.conn
                .query_row(
                    "SELECT auth_code_enc FROM accounts WHERE id = ?1",
                    params![id],
                    |r| r.get::<_, String>(0),
                )
                .unwrap_or_default()
        };

        self.conn
            .execute(
                "INSERT INTO accounts
                 (id, email, badge_char, description, is_default, provider, imap_host, imap_port, smtp_host, smtp_port, auth_code_enc)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                   email = excluded.email,
                   badge_char = excluded.badge_char,
                   description = excluded.description,
                   is_default = CASE WHEN excluded.is_default = 1 THEN 1 ELSE accounts.is_default END,
                   provider = excluded.provider,
                   imap_host = excluded.imap_host,
                   imap_port = excluded.imap_port,
                   smtp_host = excluded.smtp_host,
                   smtp_port = excluded.smtp_port,
                   auth_code_enc = excluded.auth_code_enc",
                params![
                    id,
                    email,
                    badge,
                    description,
                    if is_default { 1 } else { 0 },
                    input.provider,
                    input.imap_host.trim(),
                    input.imap_port as i64,
                    input.smtp_host.trim(),
                    input.smtp_port as i64,
                    encrypted_auth
                ],
            )
            .map_err(|e| format!("保存邮箱账户失败: {}", e))?;

        self.list_accounts()?
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| "保存账户后未找到记录".into())
    }

    pub fn list_accounts(&self) -> Result<Vec<ConnectedAccount>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, email, badge_char, description, is_default, provider, imap_host, imap_port, smtp_host, smtp_port, auth_code_enc, last_sync_at
                 FROM accounts ORDER BY is_default DESC, rowid ASC",
            )
            .map_err(|e| format!("查询账户列表失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                let enc: String = row.get(10)?;
                Ok(ConnectedAccount {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    badge_char: row.get(2)?,
                    description: row.get(3)?,
                    is_default: row.get::<_, i64>(4)? != 0,
                    provider: row.get(5)?,
                    imap_host: row.get(6)?,
                    imap_port: Some(row.get::<_, i64>(7)? as u16),
                    smtp_host: row.get(8)?,
                    smtp_port: Some(row.get::<_, i64>(9)? as u16),
                    has_credentials: !enc.is_empty(),
                    last_sync_at: row.get(11)?,
                })
            })
            .map_err(|e| format!("读取账户行失败: {}", e))?;

        let mut list = Vec::new();
        for item in rows.flatten() {
            list.push(item);
        }
        Ok(list)
    }

    pub fn get_account_with_secret(&self, account_id: Option<&str>) -> Result<Option<AccountSecretRecord>, String> {
        let query = if account_id.is_some() {
            "SELECT id, email, badge_char, description, is_default, provider, imap_host, imap_port, smtp_host, smtp_port, auth_code_enc, last_uid, last_sync_at
             FROM accounts WHERE id = ?1 LIMIT 1"
        } else {
            "SELECT id, email, badge_char, description, is_default, provider, imap_host, imap_port, smtp_host, smtp_port, auth_code_enc, last_uid, last_sync_at
             FROM accounts ORDER BY is_default DESC, rowid ASC LIMIT 1"
        };

        let mut stmt = self.conn.prepare(query).map_err(|e| format!("准备账户查询失败: {}", e))?;
        let row_opt = if let Some(aid) = account_id {
            stmt.query_row(params![aid], |row| extract_account_secret(row))
                .optional()
        } else {
            stmt.query_row([], |row| extract_account_secret(row))
                .optional()
        }
        .map_err(|e| format!("读取账户凭证失败: {}", e))?;

        match row_opt {
            Some((mut acc, enc, last_uid)) => {
                let auth_code = self.cipher.decrypt(&enc).unwrap_or_default();
                acc.has_credentials = !auth_code.is_empty();
                Ok(Some(AccountSecretRecord {
                    account: acc,
                    auth_code,
                    last_uid,
                }))
            }
            None => Ok(None),
        }
    }

    pub fn list_accounts_with_secrets(&self) -> Result<Vec<AccountSecretRecord>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, email, badge_char, description, is_default, provider, imap_host, imap_port, smtp_host, smtp_port, auth_code_enc, last_uid, last_sync_at
                 FROM accounts ORDER BY is_default DESC, rowid ASC",
            )
            .map_err(|e| format!("读取全部账户凭证失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| extract_account_secret(row))
            .map_err(|e| format!("遍历账户失败: {}", e))?;

        let mut list = Vec::new();
        for item in rows.flatten() {
            let (mut acc, enc, last_uid) = item;
            let auth_code = self.cipher.decrypt(&enc).unwrap_or_default();
            acc.has_credentials = !auth_code.is_empty();
            list.push(AccountSecretRecord {
                account: acc,
                auth_code,
                last_uid,
            });
        }
        Ok(list)
    }

    pub fn update_account_sync_cursor(&self, account_id: &str, last_uid: u32, synced_at: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE accounts SET last_uid = MAX(last_uid, ?1), last_sync_at = ?2 WHERE id = ?3",
                params![last_uid as i64, synced_at, account_id],
            )
            .map_err(|e| format!("更新同步游标失败: {}", e))?;
        Ok(())
    }

    pub fn set_default_account(&self, account_id: &str) -> Result<(), String> {
        self.conn
            .execute("UPDATE accounts SET is_default = 0", [])
            .map_err(|e| format!("重置默认账户失败: {}", e))?;
        self.conn
            .execute(
                "UPDATE accounts SET is_default = 1 WHERE id = ?1",
                params![account_id],
            )
            .map_err(|e| format!("设置默认账户失败: {}", e))?;
        Ok(())
    }

    pub fn delete_account(&self, account_id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM accounts WHERE id = ?1", params![account_id])
            .map_err(|e| format!("删除账户失败: {}", e))?;
        Ok(())
    }

    pub fn has_email_by_uid_or_msgid(&self, account_id: &str, uid: u32, msg_id: Option<&str>) -> bool {
        if let Ok(exists) = self.conn.query_row(
            "SELECT 1 FROM emails WHERE account_id = ?1 AND remote_uid = ?2 LIMIT 1",
            params![account_id, uid as i64],
            |_| Ok(true),
        ) {
            if exists {
                return true;
            }
        }
        if let Some(mid) = msg_id {
            if !mid.is_empty() {
                if let Ok(exists) = self.conn.query_row(
                    "SELECT 1 FROM emails WHERE account_id = ?1 AND message_id = ?2 LIMIT 1",
                    params![account_id, mid],
                    |_| Ok(true),
                ) {
                    if exists {
                        return true;
                    }
                }
            }
        }
        false
    }

    pub fn insert_email(&self, email: &EmailItem, message_id: Option<&str>) -> Result<(), String> {
        let paragraphs_json =
            serde_json::to_string(&email.paragraphs).unwrap_or_else(|_| "[]".into());
        self.conn
            .execute(
                "INSERT OR REPLACE INTO emails
                 (id, account_id, remote_uid, message_id, sender, email, recipient, cc, avatar_img, initials, subject, preview, time_label, full_time, timestamp_ms, unread, starred, archived, deleted, folder, tag, paragraphs_json, signoff)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 0, ?19, ?20, ?21, ?22)",
                params![
                    email.id,
                    email.account_id,
                    email.remote_uid.map(|u| u as i64),
                    message_id,
                    email.sender,
                    email.email,
                    email.recipient,
                    email.cc,
                    email.avatar_img,
                    email.initials,
                    email.subject,
                    email.preview,
                    email.time,
                    email.full_time,
                    email.timestamp_ms,
                    if email.unread { 1 } else { 0 },
                    if email.starred { 1 } else { 0 },
                    if email.archived { 1 } else { 0 },
                    email.folder,
                    email.tag,
                    paragraphs_json,
                    email.signoff,
                ],
            )
            .map_err(|e| format!("写入邮件到 SQLite 失败: {}", e))?;

        for (idx, att) in email.attachments.iter().enumerate() {
            let att_id = if att.id.is_empty() {
                format!("att-{}", Uuid::new_v4())
            } else {
                att.id.clone()
            };
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO attachments
                     (id, email_id, name, mime_type, size_bytes, size_label, cache_rel_path, part_index)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        att_id,
                        email.id,
                        sanitize_filename(&att.name),
                        if att.mime_type.is_empty() { "application/octet-stream" } else { &att.mime_type },
                        att.size_bytes,
                        att.size,
                        att.local_path,
                        idx as i64
                    ],
                )
                .map_err(|e| format!("写入附件元数据失败: {}", e))?;
        }
        Ok(())
    }

    pub fn list_emails(&self) -> Result<Vec<EmailItem>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, account_id, remote_uid, sender, email, recipient, cc, avatar_img, initials, subject, preview, time_label, full_time, timestamp_ms, unread, starred, archived, folder, tag, paragraphs_json, signoff
                 FROM emails WHERE deleted = 0 ORDER BY timestamp_ms DESC",
            )
            .map_err(|e| format!("查询邮件列表失败: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let p_json: String = row.get(19)?;
                let paragraphs: Vec<String> = serde_json::from_str(&p_json).unwrap_or_default();
                let ts_ms: i64 = row.get(13)?;
                Ok(EmailItem {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    remote_uid: row.get::<_, Option<i64>>(2)?.map(|v| v as u32),
                    sender: row.get(3)?,
                    email: row.get(4)?,
                    recipient: row.get(5)?,
                    cc: row.get(6)?,
                    avatar_img: row.get(7)?,
                    initials: row.get(8)?,
                    subject: row.get(9)?,
                    preview: row.get(10)?,
                    time: format_short_time(ts_ms),
                    full_time: row.get(12)?,
                    timestamp_ms: ts_ms,
                    unread: row.get::<_, i64>(14)? != 0,
                    starred: row.get::<_, i64>(15)? != 0,
                    archived: row.get::<_, i64>(16)? != 0,
                    folder: row.get(17)?,
                    tag: row.get(18)?,
                    attachment: None,
                    attachments: vec![],
                    paragraphs,
                    signoff: row.get(20)?,
                })
            })
            .map_err(|e| format!("读取邮件行失败: {}", e))?;

        let mut emails: Vec<EmailItem> = rows.flatten().collect();

        let mut att_stmt = self
            .conn
            .prepare(
                "SELECT id, email_id, name, mime_type, size_bytes, size_label, cache_rel_path
                 FROM attachments ORDER BY part_index ASC",
            )
            .map_err(|e| format!("查询附件列表失败: {}", e))?;
        let att_rows = att_stmt
            .query_map([], |row| {
                let rel: Option<String> = row.get(6)?;
                let cached = rel
                    .as_deref()
                    .and_then(|r| self.safe_cache_path(r).ok())
                    .map(|p| p.exists())
                    .unwrap_or(false);
                Ok((
                    row.get::<_, String>(1)?,
                    EmailAttachment {
                        id: row.get(0)?,
                        name: row.get(2)?,
                        mime_type: row.get(3)?,
                        size_bytes: row.get(4)?,
                        size: row.get(5)?,
                        local_path: rel,
                        cached,
                        content_base64: None,
                    },
                ))
            })
            .map_err(|e| format!("遍历附件行失败: {}", e))?;

        let mut map: std::collections::HashMap<String, Vec<EmailAttachment>> =
            std::collections::HashMap::new();
        for (eid, att) in att_rows.flatten() {
            map.entry(eid).or_default().push(att);
        }

        for mail in &mut emails {
            if let Some(atts) = map.remove(&mail.id) {
                mail.attachment = atts.first().cloned();
                mail.attachments = atts;
            }
        }
        Ok(emails)
    }

    pub fn get_email_remote_ref(&self, email_id: &str) -> Result<Option<(String, u32)>, String> {
        self.conn
            .query_row(
                "SELECT account_id, remote_uid FROM emails WHERE id = ?1",
                params![email_id],
                |row| {
                    let aid: Option<String> = row.get(0)?;
                    let uid: Option<i64> = row.get(1)?;
                    Ok(match (aid, uid) {
                        (Some(a), Some(u)) => Some((a, u as u32)),
                        _ => None,
                    })
                },
            )
            .optional()
            .map(|o| o.flatten())
            .map_err(|e| format!("查询邮件远端索引失败: {}", e))
    }

    pub fn update_email_flags(
        &self,
        email_id: &str,
        unread: Option<bool>,
        starred: Option<bool>,
        archived: Option<bool>,
        tag: Option<String>,
    ) -> Result<(), String> {
        if let Some(v) = unread {
            self.conn
                .execute(
                    "UPDATE emails SET unread = ?1 WHERE id = ?2",
                    params![if v { 1 } else { 0 }, email_id],
                )
                .map_err(|e| format!("更新未读状态失败: {}", e))?;
        }
        if let Some(v) = starred {
            self.conn
                .execute(
                    "UPDATE emails SET starred = ?1 WHERE id = ?2",
                    params![if v { 1 } else { 0 }, email_id],
                )
                .map_err(|e| format!("更新星标状态失败: {}", e))?;
        }
        if let Some(v) = archived {
            self.conn
                .execute(
                    "UPDATE emails SET archived = ?1 WHERE id = ?2",
                    params![if v { 1 } else { 0 }, email_id],
                )
                .map_err(|e| format!("更新归档状态失败: {}", e))?;
        }
        if let Some(t) = tag {
            self.conn
                .execute("UPDATE emails SET tag = ?1 WHERE id = ?2", params![t, email_id])
                .map_err(|e| format!("更新标签失败: {}", e))?;
        }
        Ok(())
    }

    pub fn delete_email(&self, email_id: &str) -> Result<(), String> {
        self.conn
            .execute("UPDATE emails SET deleted = 1 WHERE id = ?1", params![email_id])
            .map_err(|e| format!("删除邮件失败: {}", e))?;
        Ok(())
    }

    pub fn get_attachment_record(&self, attachment_id: &str) -> Result<Option<AttachmentCacheRecord>, String> {
        self.conn
            .query_row(
                "SELECT id, email_id, name, mime_type, size_bytes, cache_rel_path, part_index
                 FROM attachments WHERE id = ?1",
                params![attachment_id],
                |row| {
                    Ok(AttachmentCacheRecord {
                        id: row.get(0)?,
                        email_id: row.get(1)?,
                        name: row.get(2)?,
                        mime_type: row.get(3)?,
                        size_bytes: row.get(4)?,
                        cache_rel_path: row.get(5)?,
                        part_index: row.get::<_, i64>(6)? as usize,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("查询附件记录失败: {}", e))
    }

    pub fn update_attachment_cache_path(&self, attachment_id: &str, rel_path: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE attachments SET cache_rel_path = ?1 WHERE id = ?2",
                params![rel_path, attachment_id],
            )
            .map_err(|e| format!("更新附件缓存路径失败: {}", e))?;
        Ok(())
    }

    pub fn list_filters(&self) -> Result<Vec<FilterRuleItem>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, condition_text, action_text, hits, enabled, logic, conditions_json, has_attachment, action_tag, action_archive, action_mark_read, action_star
                 FROM filter_rules ORDER BY rowid DESC",
            )
            .map_err(|e| format!("读取过滤规则失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                let c_json: Option<String> = row.get(7)?;
                let conditions = c_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<Vec<FilterCondition>>(s).ok());
                Ok(FilterRuleItem {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    condition: row.get(2)?,
                    action: row.get(3)?,
                    hits: row.get(4)?,
                    enabled: row.get::<_, i64>(5)? != 0,
                    logic: row.get(6)?,
                    conditions,
                    has_attachment: row.get::<_, Option<i64>>(8)?.map(|v| v != 0),
                    action_tag: row.get(9)?,
                    action_archive: row.get::<_, Option<i64>>(10)?.map(|v| v != 0),
                    action_mark_read: row.get::<_, Option<i64>>(11)?.map(|v| v != 0),
                    action_star: row.get::<_, Option<i64>>(12)?.map(|v| v != 0),
                })
            })
            .map_err(|e| format!("解析过滤规则失败: {}", e))?;
        Ok(rows.flatten().collect())
    }

    pub fn save_filter_rule(&self, rule: &FilterRuleItem, apply_existing: bool) -> Result<i64, String> {
        let cond_json = rule
            .conditions
            .as_ref()
            .and_then(|c| serde_json::to_string(c).ok());
        self.conn
            .execute(
                "INSERT OR REPLACE INTO filter_rules
                 (id, name, condition_text, action_text, hits, enabled, logic, conditions_json, has_attachment, action_tag, action_archive, action_mark_read, action_star)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    rule.id,
                    rule.name,
                    rule.condition,
                    rule.action,
                    rule.hits,
                    if rule.enabled { 1 } else { 0 },
                    rule.logic,
                    cond_json,
                    rule.has_attachment.map(|b| if b { 1 } else { 0 }),
                    rule.action_tag,
                    rule.action_archive.map(|b| if b { 1 } else { 0 }),
                    rule.action_mark_read.map(|b| if b { 1 } else { 0 }),
                    rule.action_star.map(|b| if b { 1 } else { 0 }),
                ],
            )
            .map_err(|e| format!("保存过滤规则失败: {}", e))?;

        if apply_existing {
            return self.apply_rule_to_existing_emails(rule);
        }
        Ok(0)
    }

    pub fn toggle_filter_rule(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE filter_rules SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("切换过滤规则失败: {}", e))?;
        Ok(())
    }

    pub fn apply_rule_to_existing_emails(&self, rule: &FilterRuleItem) -> Result<i64, String> {
        let emails = self.list_emails()?;
        let mut matched: i64 = 0;
        for mail in emails {
            if email_matches_rule(&mail, rule) {
                matched += 1;
                if let Some(ref tag) = rule.action_tag {
                    if !tag.is_empty() {
                        let _ = self.update_email_flags(&mail.id, None, None, None, Some(tag.clone()));
                    }
                }
                if rule.action_archive.unwrap_or(false) {
                    let _ = self.update_email_flags(&mail.id, None, None, Some(true), None);
                }
                if rule.action_mark_read.unwrap_or(false) {
                    let _ = self.update_email_flags(&mail.id, Some(false), None, None, None);
                }
                if rule.action_star.unwrap_or(false) {
                    let _ = self.update_email_flags(&mail.id, None, Some(true), None, None);
                }
            }
        }
        if matched > 0 {
            let _ = self.conn.execute(
                "UPDATE filter_rules SET hits = hits + ?1 WHERE id = ?2",
                params![matched, rule.id],
            );
        }
        Ok(matched)
    }

    /// Evaluates blocklist & active filter rules against an incoming email.
    /// Returns `true` if the email should be blocked (dropped/deleted), `false` otherwise.
    pub fn evaluate_incoming_email(&self, mail: &mut EmailItem) -> bool {
        if let Ok(settings) = self.get_system_settings() {
            let sender_lower = mail.email.to_lowercase();
            for blocked in &settings.blocklist {
                let b = blocked.trim().to_lowercase();
                if b.is_empty() {
                    continue;
                }
                if b.starts_with('@') && sender_lower.ends_with(&b) {
                    return true;
                }
                if sender_lower == b || sender_lower.contains(&b) {
                    return true;
                }
            }
        }

        if let Ok(rules) = self.list_filters() {
            for rule in rules.into_iter().filter(|r| r.enabled) {
                if email_matches_rule(mail, &rule) {
                    if let Some(ref tag) = rule.action_tag {
                        if !tag.is_empty() {
                            mail.tag = tag.clone();
                        }
                    }
                    if rule.action_archive.unwrap_or(false) {
                        mail.archived = true;
                    }
                    if rule.action_mark_read.unwrap_or(false) {
                        mail.unread = false;
                    }
                    if rule.action_star.unwrap_or(false) {
                        mail.starred = true;
                    }
                    let _ = self.conn.execute(
                        "UPDATE filter_rules SET hits = hits + 1 WHERE id = ?1",
                        params![rule.id],
                    );
                }
            }
        }
        false
    }

    pub fn list_smart_folders(&self, emails: &[EmailItem]) -> Result<Vec<SmartFolderItem>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, icon, enabled, conditions_json, action_text, tag FROM smart_folders ORDER BY rowid ASC")
            .map_err(|e| format!("读取智能文件夹失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                let c_json: String = row.get(4)?;
                let conditions: Vec<String> = serde_json::from_str(&c_json).unwrap_or_default();
                let tag: String = row.get(6)?;
                let matching: Vec<&EmailItem> = emails.iter().filter(|e| e.tag == tag).collect();
                let total = matching.len() as i64;
                let unread = matching.iter().filter(|e| e.unread).count() as i64;
                Ok(SmartFolderItem {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    total,
                    unread,
                    enabled: row.get::<_, i64>(3)? != 0,
                    conditions,
                    action_text: row.get(5)?,
                    tag,
                })
            })
            .map_err(|e| format!("解析智能文件夹失败: {}", e))?;
        Ok(rows.flatten().collect())
    }

    pub fn save_smart_folder(&self, folder: &SmartFolderItem) -> Result<(), String> {
        let c_json = serde_json::to_string(&folder.conditions).unwrap_or_else(|_| "[]".into());
        self.conn
            .execute(
                "INSERT OR REPLACE INTO smart_folders (id, name, icon, enabled, conditions_json, action_text, tag)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    folder.id,
                    folder.name,
                    folder.icon,
                    if folder.enabled { 1 } else { 0 },
                    c_json,
                    folder.action_text,
                    folder.tag
                ],
            )
            .map_err(|e| format!("保存智能文件夹失败: {}", e))?;
        Ok(())
    }

    pub fn toggle_smart_folder(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE smart_folders SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("切换智能文件夹失败: {}", e))?;
        Ok(())
    }

    pub fn list_labels(&self, emails: &[EmailItem]) -> Result<Vec<LabelItem>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, dot_class FROM labels ORDER BY rowid ASC")
            .map_err(|e| format!("读取标签失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                let name: String = row.get(1)?;
                let count = emails.iter().filter(|e| e.tag == name).count() as i64;
                Ok(LabelItem {
                    id: row.get(0)?,
                    name,
                    count,
                    dot_class: row.get(2)?,
                })
            })
            .map_err(|e| format!("解析标签失败: {}", e))?;
        Ok(rows.flatten().collect())
    }

    pub fn save_label(&self, id: &str, name: &str, dot_class: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO labels (id, name, dot_class) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name",
                params![id, name, dot_class],
            )
            .map_err(|e| format!("保存标签失败: {}", e))?;
        Ok(())
    }

    pub fn list_llm_profiles(&self) -> Result<Vec<LlmProfile>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, base_url, api_key_enc, model, temperature, active, enable_translate, enable_polish
                 FROM llm_profiles ORDER BY active DESC, rowid DESC",
            )
            .map_err(|e| format!("读取 AI 配置失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                let enc: String = row.get(3)?;
                Ok(LlmProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    base_url: row.get(2)?,
                    // Never send raw API keys back to frontend state
                    api_key: String::new(),
                    has_api_key: !enc.is_empty(),
                    model: row.get(4)?,
                    temperature: row.get::<_, f64>(5)? as f32,
                    active: row.get::<_, i64>(6)? != 0,
                    enable_translate: Some(row.get::<_, i64>(7)? != 0),
                    enable_polish: Some(row.get::<_, i64>(8)? != 0),
                })
            })
            .map_err(|e| format!("解析 AI 配置失败: {}", e))?;
        Ok(rows.flatten().collect())
    }

    pub fn get_llm_profile_secret(&self, profile_id: Option<&str>) -> Result<Option<(LlmProfile, String)>, String> {
        let sql = if profile_id.is_some() {
            "SELECT id, name, base_url, api_key_enc, model, temperature, active, enable_translate, enable_polish
             FROM llm_profiles WHERE id = ?1 LIMIT 1"
        } else {
            "SELECT id, name, base_url, api_key_enc, model, temperature, active, enable_translate, enable_polish
             FROM llm_profiles ORDER BY active DESC, rowid DESC LIMIT 1"
        };
        let mut stmt = self.conn.prepare(sql).map_err(|e| format!("查询 AI 密钥失败: {}", e))?;
        let row_opt = if let Some(pid) = profile_id {
            stmt.query_row(params![pid], extract_llm_row).optional()
        } else {
            stmt.query_row([], extract_llm_row).optional()
        }
        .map_err(|e| format!("读取 AI 密钥失败: {}", e))?;

        Ok(row_opt.map(|(p, enc)| {
            let key = self.cipher.decrypt(&enc).unwrap_or_default();
            (p, key)
        }))
    }

    pub fn save_llm_profile(&self, profile: &LlmProfile) -> Result<(), String> {
        if profile.active {
            let _ = self.conn.execute("UPDATE llm_profiles SET active = 0", []);
        }
        let enc_key = if !profile.api_key.trim().is_empty() {
            self.cipher.encrypt(profile.api_key.trim())?
        } else {
            self.conn
                .query_row(
                    "SELECT api_key_enc FROM llm_profiles WHERE id = ?1",
                    params![profile.id],
                    |r| r.get::<_, String>(0),
                )
                .unwrap_or_default()
        };

        self.conn
            .execute(
                "INSERT OR REPLACE INTO llm_profiles
                 (id, name, base_url, api_key_enc, model, temperature, active, enable_translate, enable_polish)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    profile.id,
                    profile.name,
                    profile.base_url,
                    enc_key,
                    profile.model,
                    profile.temperature as f64,
                    if profile.active { 1 } else { 0 },
                    if profile.enable_translate.unwrap_or(true) { 1 } else { 0 },
                    if profile.enable_polish.unwrap_or(true) { 1 } else { 0 },
                ],
            )
            .map_err(|e| format!("保存 AI 模型配置失败: {}", e))?;
        Ok(())
    }

    pub fn activate_llm_profile(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute("UPDATE llm_profiles SET active = 0", [])
            .map_err(|e| format!("重置激活模型失败: {}", e))?;
        self.conn
            .execute("UPDATE llm_profiles SET active = 1 WHERE id = ?1", params![id])
            .map_err(|e| format!("激活模型失败: {}", e))?;
        Ok(())
    }

    pub fn save_draft(&self, draft: &DraftItem) -> Result<(), String> {
        let r_json = serde_json::to_string(&draft.recipients).unwrap_or_else(|_| "[]".into());
        let a_json = serde_json::to_string(&draft.attachments).unwrap_or_else(|_| "[]".into());
        self.conn
            .execute(
                "INSERT OR REPLACE INTO drafts (id, recipients_json, cc, subject, body, attachments_json, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![draft.id, r_json, draft.cc, draft.subject, draft.body, a_json, draft.updated_at],
            )
            .map_err(|e| format!("保存草稿失败: {}", e))?;
        Ok(())
    }

    pub fn delete_draft(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM drafts WHERE id = ?1", params![id])
            .map_err(|e| format!("删除草稿失败: {}", e))?;
        Ok(())
    }

    pub fn list_drafts(&self) -> Result<Vec<DraftItem>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, recipients_json, cc, subject, body, attachments_json, updated_at FROM drafts ORDER BY rowid DESC")
            .map_err(|e| format!("读取草稿箱失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                let r_json: String = row.get(1)?;
                let a_json: String = row.get(5)?;
                Ok(DraftItem {
                    id: row.get(0)?,
                    recipients: serde_json::from_str(&r_json).unwrap_or_default(),
                    cc: row.get(2)?,
                    subject: row.get(3)?,
                    body: row.get(4)?,
                    attachments: serde_json::from_str(&a_json).unwrap_or_default(),
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| format!("解析草稿箱失败: {}", e))?;
        Ok(rows.flatten().collect())
    }

    pub fn add_scheduled_email(&self, item: &ScheduledEmailItem) -> Result<(), String> {
        let r_json = serde_json::to_string(&item.recipients).unwrap_or_else(|_| "[]".into());
        let a_json = serde_json::to_string(&item.attachments).unwrap_or_else(|_| "[]".into());
        self.conn
            .execute(
                "INSERT OR REPLACE INTO scheduled_emails
                 (id, account_id, recipients_json, cc, subject, body, attachments_json, scheduled_at_ms, scheduled_label, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    item.id,
                    item.account_id,
                    r_json,
                    item.cc,
                    item.subject,
                    item.body,
                    a_json,
                    item.scheduled_at_ms,
                    item.scheduled_label,
                    item.status
                ],
            )
            .map_err(|e| format!("写入定时发送队列失败: {}", e))?;
        Ok(())
    }

    pub fn list_scheduled_emails(&self) -> Result<Vec<ScheduledEmailItem>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, account_id, recipients_json, cc, subject, body, attachments_json, scheduled_at_ms, scheduled_label, status
                 FROM scheduled_emails WHERE status = 'pending' ORDER BY scheduled_at_ms ASC",
            )
            .map_err(|e| format!("查询定时发送队列失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                let r_json: String = row.get(2)?;
                let a_json: String = row.get(6)?;
                Ok(ScheduledEmailItem {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    recipients: serde_json::from_str(&r_json).unwrap_or_default(),
                    cc: row.get(3)?,
                    subject: row.get(4)?,
                    body: row.get(5)?,
                    attachments: serde_json::from_str(&a_json).unwrap_or_default(),
                    scheduled_at_ms: row.get(7)?,
                    scheduled_label: row.get(8)?,
                    status: row.get(9)?,
                })
            })
            .map_err(|e| format!("解析定时队列失败: {}", e))?;
        Ok(rows.flatten().collect())
    }

    pub fn list_due_scheduled_emails(&self, now_ms: i64) -> Result<Vec<ScheduledEmailItem>, String> {
        Ok(self
            .list_scheduled_emails()?
            .into_iter()
            .filter(|item| item.scheduled_at_ms <= now_ms)
            .collect())
    }

    pub fn mark_scheduled_status(&self, id: &str, status: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE scheduled_emails SET status = ?1 WHERE id = ?2",
                params![status, id],
            )
            .map_err(|e| format!("更新定时队列状态失败: {}", e))?;
        Ok(())
    }

    pub fn cancel_scheduled_email(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM scheduled_emails WHERE id = ?1", params![id])
            .map_err(|e| format!("取消定时发送失败: {}", e))?;
        Ok(())
    }

    pub fn get_starred_contacts(&self) -> Result<Vec<String>, String> {
        Ok(self.get_kv::<Vec<String>>("starred_contacts")?.unwrap_or_default())
    }

    pub fn toggle_contact_star(&self, email: &str) -> Result<Vec<String>, String> {
        let mut list = self.get_starred_contacts()?;
        let normalized = email.trim().to_lowercase();
        if let Some(pos) = list.iter().position(|e| e == &normalized) {
            list.remove(pos);
        } else {
            list.push(normalized);
        }
        self.set_kv("starred_contacts", &list)?;
        Ok(list)
    }

    pub fn get_workspace_snapshot(&self) -> Result<WorkspaceSnapshot, String> {
        let emails = self.list_emails()?;
        let accounts = self.list_accounts()?;
        let smart_folders = self.list_smart_folders(&emails)?;
        let labels = self.list_labels(&emails)?;
        let filters = self.list_filters()?;
        let llm_profiles = self.list_llm_profiles()?;
        let profile = self.get_user_profile()?;
        let system_settings = self.get_system_settings()?;
        let drafts = self.list_drafts()?;
        let scheduled_emails = self.list_scheduled_emails()?;
        let starred_contacts = self.get_starred_contacts()?;

        Ok(WorkspaceSnapshot {
            emails,
            accounts,
            smart_folders,
            labels,
            filters,
            llm_profiles,
            profile,
            system_settings,
            drafts,
            scheduled_emails,
            starred_contacts,
            data_dir: self.data_dir.to_string_lossy().to_string(),
            portable_mode: self.portable_mode,
        })
    }
}

fn extract_account_secret(row: &rusqlite::Row<'_>) -> rusqlite::Result<(ConnectedAccount, String, u32)> {
    let enc: String = row.get(10)?;
    let last_uid: i64 = row.get(11)?;
    let acc = ConnectedAccount {
        id: row.get(0)?,
        email: row.get(1)?,
        badge_char: row.get(2)?,
        description: row.get(3)?,
        is_default: row.get::<_, i64>(4)? != 0,
        provider: row.get(5)?,
        imap_host: row.get(6)?,
        imap_port: Some(row.get::<_, i64>(7)? as u16),
        smtp_host: row.get(8)?,
        smtp_port: Some(row.get::<_, i64>(9)? as u16),
        has_credentials: !enc.is_empty(),
        last_sync_at: row.get(12)?,
    };
    Ok((acc, enc, last_uid.max(0) as u32))
}

fn extract_llm_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(LlmProfile, String)> {
    let enc: String = row.get(3)?;
    let profile = LlmProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        base_url: row.get(2)?,
        api_key: String::new(),
        has_api_key: !enc.is_empty(),
        model: row.get(4)?,
        temperature: row.get::<_, f64>(5)? as f32,
        active: row.get::<_, i64>(6)? != 0,
        enable_translate: Some(row.get::<_, i64>(7)? != 0),
        enable_polish: Some(row.get::<_, i64>(8)? != 0),
    };
    Ok((profile, enc))
}

fn resolve_data_dir() -> Result<(PathBuf, bool), String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            if exe_dir.join("portable.flag").exists() || exe_dir.join("linenmail-data").exists() {
                return Ok((exe_dir.join("linenmail-data"), true));
            }
        }
    }
    if let Some(proj) = ProjectDirs::from("cn", "LinenMail", "LinenMail") {
        return Ok((proj.data_local_dir().to_path_buf(), false));
    }
    let fallback = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("linenmail-data");
    Ok((fallback, true))
}

pub fn sanitize_filename(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("attachment.bin");
    let cleaned: String = base
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "attachment.bin".into()
    } else if trimmed.len() > 140 {
        trimmed.chars().take(140).collect()
    } else {
        trimmed.to_string()
    }
}

pub fn format_bytes(bytes: i64) -> String {
    if bytes <= 0 {
        return "0 KB".into();
    }
    let b = bytes as f64;
    if b >= 1024.0 * 1024.0 * 1024.0 {
        format!("{:.2} GB", b / (1024.0 * 1024.0 * 1024.0))
    } else if b >= 1024.0 * 1024.0 {
        format!("{:.1} MB", b / (1024.0 * 1024.0))
    } else {
        format!("{} KB", (b / 1024.0).max(1.0).round() as i64)
    }
}

pub fn format_short_time(ts_ms: i64) -> String {
    let dt: DateTime<Local> = Local
        .timestamp_millis_opt(ts_ms)
        .single()
        .unwrap_or_else(Local::now);
    let now = Local::now();
    if dt.date_naive() == now.date_naive() {
        dt.format("%H:%M").to_string()
    } else if (now.date_naive() - dt.date_naive()).num_days() == 1 {
        "昨天".into()
    } else {
        dt.format("%m月%d日").to_string()
    }
}

pub fn format_full_time(ts_ms: i64) -> String {
    let dt: DateTime<Local> = Local
        .timestamp_millis_opt(ts_ms)
        .single()
        .unwrap_or_else(Local::now);
    let now = Local::now();
    if dt.date_naive() == now.date_naive() {
        format!("今天 {}", dt.format("%H:%M"))
    } else if (now.date_naive() - dt.date_naive()).num_days() == 1 {
        format!("昨天 {}", dt.format("%H:%M"))
    } else {
        dt.format("%m月%d日 %H:%M").to_string()
    }
}

pub fn email_matches_rule(mail: &EmailItem, rule: &FilterRuleItem) -> bool {
    if rule.has_attachment.unwrap_or(false) && mail.attachment.is_none() && mail.attachments.is_empty() {
        return false;
    }
    let Some(ref conds) = rule.conditions else {
        return false;
    };
    if conds.is_empty() {
        return false;
    }
    let is_or = rule.logic.as_deref() == Some("OR");
    let body_text = mail.paragraphs.join("\n").to_lowercase();

    let eval_one = |c: &FilterCondition| -> bool {
        let needle = c.value.trim().to_lowercase();
        if needle.is_empty() {
            return false;
        }
        let haystack = match c.field.as_str() {
            "发件人" => format!("{} {}", mail.sender, mail.email).to_lowercase(),
            "收件人" => mail.recipient.clone().unwrap_or_default().to_lowercase(),
            "主题" => mail.subject.to_lowercase(),
            "正文" => body_text.clone(),
            _ => mail.subject.to_lowercase(),
        };
        match c.op.as_str() {
            "包含" => haystack.contains(&needle),
            "不包含" => !haystack.contains(&needle),
            "完全等于" => haystack.trim() == needle,
            _ => haystack.contains(&needle),
        }
    };

    if is_or {
        conds.iter().any(eval_one)
    } else {
        conds.iter().all(eval_one)
    }
}

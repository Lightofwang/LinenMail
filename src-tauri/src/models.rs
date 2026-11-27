use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailAttachment {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub size: String,
    #[serde(default)]
    pub size_bytes: i64,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub local_path: Option<String>,
    #[serde(default)]
    pub cached: bool,
    #[serde(default)]
    pub content_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailItem {
    pub id: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub remote_uid: Option<u32>,
    pub sender: String,
    pub email: String,
    #[serde(default)]
    pub recipient: Option<String>,
    #[serde(default)]
    pub cc: Option<String>,
    pub avatar_img: Option<String>,
    pub initials: String,
    pub subject: String,
    pub preview: String,
    pub time: String,
    pub full_time: String,
    #[serde(default)]
    pub timestamp_ms: i64,
    pub unread: bool,
    pub starred: bool,
    #[serde(default)]
    pub archived: bool,
    pub folder: String,
    pub tag: String,
    pub attachment: Option<EmailAttachment>,
    #[serde(default)]
    pub attachments: Vec<EmailAttachment>,
    pub paragraphs: Vec<String>,
    pub signoff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedAccount {
    pub id: String,
    pub email: String,
    pub badge_char: String,
    pub description: String,
    pub is_default: bool,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub imap_host: Option<String>,
    #[serde(default)]
    pub imap_port: Option<u16>,
    #[serde(default)]
    pub smtp_host: Option<String>,
    #[serde(default)]
    pub smtp_port: Option<u16>,
    #[serde(default)]
    pub has_credentials: bool,
    #[serde(default)]
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountConfigInput {
    pub id: Option<String>,
    pub email: String,
    pub badge_char: Option<String>,
    pub label: Option<String>,
    pub provider: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub auth_code: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionInput {
    pub email: String,
    pub auth_code: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub success: bool,
    pub imap_ok: bool,
    pub smtp_ok: bool,
    pub latency_ms: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartFolderItem {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub total: i64,
    pub unread: i64,
    pub enabled: bool,
    pub conditions: Vec<String>,
    pub action_text: String,
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelItem {
    pub id: String,
    pub name: String,
    pub count: i64,
    pub dot_class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    pub field: String,
    pub op: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterRuleItem {
    pub id: String,
    pub name: String,
    pub condition: String,
    pub action: String,
    pub hits: i64,
    pub enabled: bool,
    #[serde(default)]
    pub logic: Option<String>,
    #[serde(default)]
    pub conditions: Option<Vec<FilterCondition>>,
    #[serde(default)]
    pub has_attachment: Option<bool>,
    #[serde(default)]
    pub action_tag: Option<String>,
    #[serde(default)]
    pub action_archive: Option<bool>,
    #[serde(default)]
    pub action_mark_read: Option<bool>,
    #[serde(default)]
    pub action_star: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProfile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub has_api_key: bool,
    pub model: String,
    pub temperature: f32,
    pub active: bool,
    #[serde(default)]
    pub enable_translate: Option<bool>,
    #[serde(default)]
    pub enable_polish: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub name: String,
    pub initial: String,
    pub primary_email: String,
    pub signature: String,
    pub undo_seconds: u8,
    pub minimal_reading: bool,
    pub enable_shortcuts: bool,
    pub quiet_night_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSettingsState {
    pub vacation_responder: bool,
    pub auto_forward: bool,
    pub blocklist: Vec<String>,
    pub sync_frequency: String,
    pub cache_text: String,
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
    #[serde(default = "default_true")]
    pub desktop_notifications: bool,
    #[serde(default)]
    pub cache_bytes: i64,
    #[serde(default)]
    pub db_size_bytes: i64,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendEmailPayload {
    pub account_id: Option<String>,
    pub recipients: Vec<String>,
    #[serde(default)]
    pub cc: String,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub attachments: Vec<EmailAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledEmailItem {
    pub id: String,
    pub account_id: Option<String>,
    pub recipients: Vec<String>,
    pub cc: String,
    pub subject: String,
    pub body: String,
    pub attachments: Vec<EmailAttachment>,
    pub scheduled_at_ms: i64,
    pub scheduled_label: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftItem {
    pub id: String,
    pub recipients: Vec<String>,
    pub cc: String,
    pub subject: String,
    pub body: String,
    pub attachments: Vec<EmailAttachment>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub fetched_count: usize,
    pub new_unread_count: usize,
    pub synced_accounts: usize,
    pub errors: Vec<String>,
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadOlderResult {
    pub fetched_count: usize,
    pub has_more: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub cache_bytes: i64,
    pub db_size_bytes: i64,
    pub cached_files: usize,
    pub cache_text: String,
    pub data_dir: String,
    pub portable_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryContact {
    pub email: String,
    pub name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub department: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDavConfigInput {
    pub server_url: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_true")]
    pub use_default_account: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDavConfigState {
    pub server_url: String,
    pub username: String,
    pub has_password: bool,
    pub use_default_account: bool,
    pub last_sync_at: Option<String>,
    pub last_sync_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactSyncResult {
    pub imported_count: usize,
    pub total_directory_count: usize,
    pub source_label: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapFolderItem {
    pub id: String,
    pub account_id: String,
    pub account_email: String,
    pub raw_name: String,
    pub display_name: String,
    pub folder_key: String,
    pub delimiter: String,
    pub kind: String,
    pub last_uid: u32,
    pub synced_at: Option<String>,
    pub email_count: i64,
    pub unread_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub emails: Vec<EmailItem>,
    pub accounts: Vec<ConnectedAccount>,
    pub smart_folders: Vec<SmartFolderItem>,
    pub labels: Vec<LabelItem>,
    pub filters: Vec<FilterRuleItem>,
    pub llm_profiles: Vec<LlmProfile>,
    pub profile: UserProfile,
    pub system_settings: SystemSettingsState,
    pub drafts: Vec<DraftItem>,
    pub scheduled_emails: Vec<ScheduledEmailItem>,
    pub starred_contacts: Vec<String>,
    pub directory_contacts: Vec<DirectoryContact>,
    pub imap_folders: Vec<ImapFolderItem>,
    pub data_dir: String,
    pub portable_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatRequest {
    pub profile_id: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f32>,
    pub messages: Vec<LlmChatMessage>,
}

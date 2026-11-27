export type AppRoute =
  | 'inbox'
  | 'drafts'
  | 'smart-folders'
  | 'contacts'
  | 'compose'
  | 'account'
  | 'system-settings'
  | 'onboarding';

export type MailFolder = 'inbox' | 'sent' | 'archive';

export type InboxFilter = 'all' | 'unread' | 'starred' | 'attachment';

export interface EmailAttachment {
  id?: string;
  name: string;
  size: string;
  sizeBytes?: number;
  mimeType?: string;
  localPath?: string | null;
  cached?: boolean;
  contentBase64?: string | null;
}

export interface EmailItem {
  id: string;
  accountId?: string | null;
  remoteUid?: number | null;
  sender: string;
  email: string;
  recipient?: string | null;
  cc?: string | null;
  avatarImg: string | null;
  initials: string;
  subject: string;
  preview: string;
  time: string;
  fullTime: string;
  timestampMs?: number;
  unread: boolean;
  starred: boolean;
  archived?: boolean;
  folder: MailFolder;
  tag: string;
  attachment: EmailAttachment | null;
  attachments?: EmailAttachment[];
  paragraphs: string[];
  signoff: string;
}

export interface ContactAttachment {
  id?: string;
  name: string;
  size: string;
  date: string;
  dir: '对方发送' | '我发送';
  icon: string;
  emailId?: string;
  contentBase64?: string | null;
}

export interface ContactThread {
  subject: string;
  time: string;
  snippet: string;
  emailId?: string;
}

export interface ContactItem {
  id: string;
  name: string;
  role: string;
  department?: string;
  source?: 'carddav' | 'import' | 'email';
  email: string;
  avatarImg: string | null;
  initials: string;
  group: 'team' | 'partner';
  groupLabel: string;
  starred: boolean;
  lastActive: string;
  attachments: ContactAttachment[];
  threads: ContactThread[];
}

export interface DirectoryContact {
  email: string;
  name: string;
  role: string;
  department: string;
  source: 'carddav' | 'import' | 'email' | string;
  updatedAt: string;
}

export interface CardDavConfigInput {
  serverUrl: string;
  username: string;
  password: string;
  useDefaultAccount: boolean;
}

export interface CardDavConfigState {
  serverUrl: string;
  username: string;
  hasPassword: boolean;
  useDefaultAccount: boolean;
  lastSyncAt?: string | null;
  lastSyncCount: number;
}

export interface ContactSyncResult {
  importedCount: number;
  totalDirectoryCount: number;
  sourceLabel: string;
  message: string;
}

export interface SmartFolderItem {
  id: string;
  name: string;
  icon: string;
  total: number;
  unread: number;
  enabled: boolean;
  conditions: string[];
  actionText: string;
  tag: string;
}

export interface LabelItem {
  id: string;
  name: string;
  count: number;
  dotClass: string;
}

export interface FilterCondition {
  field: '发件人' | '收件人' | '主题' | '正文';
  op: '包含' | '不包含' | '完全等于';
  value: string;
}

export interface FilterRuleItem {
  id: string;
  name: string;
  condition: string;
  action: string;
  hits: number;
  enabled: boolean;
  logic?: 'AND' | 'OR';
  conditions?: FilterCondition[];
  hasAttachment?: boolean;
  actionTag?: string | null;
  actionArchive?: boolean;
  actionMarkRead?: boolean;
  actionStar?: boolean;
}

export interface LlmProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  hasApiKey?: boolean;
  model: string;
  temperature: number;
  active: boolean;
  enableTranslate?: boolean;
  enablePolish?: boolean;
}

export interface ConnectedAccount {
  id: string;
  email: string;
  badgeChar: string;
  description: string;
  isDefault: boolean;
  provider?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  hasCredentials?: boolean;
  lastSyncAt?: string | null;
}

export interface AccountConfigInput {
  id?: string;
  email: string;
  badgeChar?: string;
  label?: string;
  provider: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  authCode: string;
  isDefault?: boolean;
}

export interface TestConnectionInput {
  email: string;
  authCode: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export interface TestConnectionResult {
  success: boolean;
  imapOk: boolean;
  smtpOk: boolean;
  latencyMs: number;
  message: string;
}

export interface UserProfile {
  name: string;
  initial: string;
  primaryEmail: string;
  signature: string;
  undoSeconds: 5 | 10 | 30;
  minimalReading: boolean;
  enableShortcuts: boolean;
  quietNightMode: boolean;
}

export interface SystemSettingsState {
  vacationResponder: boolean;
  autoForward: boolean;
  blocklist: string[];
  syncFrequency: '实时推送' | '每 5 分钟' | '每 15 分钟' | '手动';
  cacheText: string;
  minimizeToTray?: boolean;
  desktopNotifications?: boolean;
  cacheBytes?: number;
  dbSizeBytes?: number;
}

export interface SendEmailPayload {
  accountId?: string | null;
  recipients: string[];
  cc: string;
  subject: string;
  body: string;
  attachments: EmailAttachment[];
}

export interface ScheduledEmailItem {
  id: string;
  accountId?: string | null;
  recipients: string[];
  cc: string;
  subject: string;
  body: string;
  attachments: EmailAttachment[];
  scheduledAtMs: number;
  scheduledLabel: string;
  status: string;
}

export interface DraftItem {
  id: string;
  recipients: string[];
  cc: string;
  subject: string;
  body: string;
  attachments: EmailAttachment[];
  updatedAt: string;
}

export interface SyncSummary {
  fetchedCount: number;
  newUnreadCount: number;
  syncedAccounts: number;
  errors: string[];
  syncedAt: string;
}

export interface LoadOlderResult {
  fetchedCount: number;
  hasMore: boolean;
  errors: string[];
}

export interface CacheStats {
  cacheBytes: number;
  dbSizeBytes: number;
  cachedFiles: number;
  cacheText: string;
  dataDir: string;
  portableMode: boolean;
}

export interface WorkspaceSnapshot {
  emails: EmailItem[];
  accounts: ConnectedAccount[];
  smartFolders: SmartFolderItem[];
  labels: LabelItem[];
  filters: FilterRuleItem[];
  llmProfiles: LlmProfile[];
  profile: UserProfile;
  systemSettings: SystemSettingsState;
  drafts: DraftItem[];
  scheduledEmails: ScheduledEmailItem[];
  starredContacts: string[];
  directoryContacts?: DirectoryContact[];
  dataDir: string;
  portableMode: boolean;
}

export interface ComposePrefill {
  draftId?: string;
  recipients?: string[];
  cc?: string;
  subject?: string;
  body?: string;
  attachment?: EmailAttachment | null;
  attachments?: EmailAttachment[];
}

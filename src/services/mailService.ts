import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  AccountConfigInput,
  CacheStats,
  ConnectedAccount,
  ContactAttachment,
  ContactItem,
  DraftItem,
  EmailAttachment,
  EmailItem,
  FilterRuleItem,
  LlmProfile,
  ScheduledEmailItem,
  SendEmailPayload,
  SmartFolderItem,
  SyncSummary,
  SystemSettingsState,
  TestConnectionInput,
  TestConnectionResult,
  UserProfile,
  WorkspaceSnapshot,
} from '../types/mail';

export interface ProviderPreset {
  id: string;
  label: string;
  icon: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  hint: string;
}

export const EMAIL_PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  qq: {
    id: 'qq',
    label: 'QQ 邮箱',
    icon: 'mark_email_read',
    imapHost: 'imap.qq.com',
    imapPort: 993,
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
    hint: '需在 QQ 邮箱「设置 → 账户」中开启 IMAP/SMTP 服务并获取 16 位授权码',
  },
  netease163: {
    id: 'netease163',
    label: '网易 163',
    icon: 'mail',
    imapHost: 'imap.163.com',
    imapPort: 993,
    smtpHost: 'smtp.163.com',
    smtpPort: 465,
    hint: '需在 163 邮箱「设置 → POP3/SMTP/IMAP」中开启服务并生成客户端授权密码',
  },
  gmail: {
    id: 'gmail',
    label: 'Gmail',
    icon: 'alternate_email',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    hint: '需开启 Google 两步验证后生成 16 位「应用专用密码」',
  },
  outlook: {
    id: 'outlook',
    label: 'Outlook / 365',
    icon: 'business',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    hint: '支持 STARTTLS (587) 安全认证发信',
  },
  custom: {
    id: 'custom',
    label: '企业 / 自定义 IMAP',
    icon: 'dns',
    imapHost: 'imap.exmail.qq.com',
    imapPort: 993,
    smtpHost: 'smtp.exmail.qq.com',
    smtpPort: 465,
    hint: '支持任意标准 IMAP/SMTP 邮箱（腾讯企业邮、阿里企业邮、自建邮局等）',
  },
};

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function isSafeExternalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function matchesFilterRule(mail: EmailItem, rule: FilterRuleItem): boolean {
  if (rule.hasAttachment && !mail.attachment && (!mail.attachments || mail.attachments.length === 0)) {
    return false;
  }
  if (!rule.conditions || rule.conditions.length === 0) {
    return false;
  }
  const body = mail.paragraphs.join('\n').toLowerCase();
  const evalCond = (c: { field: string; op: string; value: string }) => {
    const needle = c.value.trim().toLowerCase();
    if (!needle) return false;
    let hay = mail.subject.toLowerCase();
    if (c.field === '发件人') hay = `${mail.sender} ${mail.email}`.toLowerCase();
    else if (c.field === '收件人') hay = (mail.recipient || '').toLowerCase();
    else if (c.field === '正文') hay = body;
    if (c.op === '包含') return hay.includes(needle);
    if (c.op === '不包含') return !hay.includes(needle);
    if (c.op === '完全等于') return hay.trim() === needle;
    return hay.includes(needle);
  };
  return rule.logic === 'OR'
    ? rule.conditions.some(evalCond)
    : rule.conditions.every(evalCond);
}

function guessAttachmentIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')) {
    return 'image';
  }
  if (lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return 'table_chart';
  }
  if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z')) {
    return 'folder_zip';
  }
  return 'description';
}

/**
 * Merges static/seeded contacts with live contacts & attachments aggregated from all local SQLite emails.
 */
export function aggregateContactsFromEmails(
  emails: EmailItem[],
  seedContacts: ContactItem[],
  starredEmails: string[]
): ContactItem[] {
  const byEmail = new Map<string, ContactItem>();
  const starSet = new Set(starredEmails.map((s) => s.toLowerCase()));

  for (const c of seedContacts) {
    const key = c.email.toLowerCase();
    byEmail.set(key, {
      ...c,
      starred: starSet.size > 0 ? starSet.has(key) || c.starred : c.starred,
      attachments: [...c.attachments],
      threads: [...c.threads],
    });
  }

  for (const mail of emails) {
    const key = mail.email.trim().toLowerCase();
    if (!key || key === 'unknown@unknown') continue;

    let contact = byEmail.get(key);
    const cleanName = mail.sender.replace(/^我\s*→\s*/, '').trim() || key.split('@')[0];
    if (!contact) {
      const domain = key.split('@')[1] || '外部联系人';
      contact = {
        id: `contact-${key}`,
        name: cleanName,
        role: domain,
        email: mail.email,
        avatarImg: mail.avatarImg,
        initials: mail.initials || cleanName.charAt(0).toUpperCase(),
        group: domain.includes('atelier') || domain.includes('nexus') ? 'team' : 'partner',
        groupLabel: domain.includes('atelier') || domain.includes('nexus') ? '团队协作' : '往来联系人',
        starred: starSet.has(key),
        lastActive: mail.fullTime,
        attachments: [],
        threads: [],
      };
      byEmail.set(key, contact);
    }

    if (!contact.threads.some((t) => t.emailId === mail.id || t.subject === mail.subject)) {
      contact.threads.unshift({
        subject: mail.subject,
        time: mail.fullTime,
        snippet: mail.preview,
        emailId: mail.id,
      });
    }

    const mailAtts: EmailAttachment[] =
      mail.attachments && mail.attachments.length > 0
        ? mail.attachments
        : mail.attachment
        ? [mail.attachment]
        : [];

    for (const att of mailAtts) {
      if (!contact.attachments.some((a) => (att.id && a.id === att.id) || (a.name === att.name && a.emailId === mail.id))) {
        const entry: ContactAttachment = {
          id: att.id,
          name: att.name,
          size: att.size,
          date: mail.fullTime,
          dir: mail.folder === 'sent' ? '我发送' : '对方发送',
          icon: guessAttachmentIcon(att.name),
          emailId: mail.id,
          contentBase64: att.contentBase64,
        };
        contact.attachments.unshift(entry);
      }
    }
  }

  return Array.from(byEmail.values());
}

export const mailService = {
  isDesktop: isTauriRuntime,

  async getWorkspace(): Promise<WorkspaceSnapshot | null> {
    if (!isTauriRuntime()) return null;
    return invoke<WorkspaceSnapshot>('get_workspace');
  },

  async testAccountConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
    if (isTauriRuntime()) {
      return invoke<TestConnectionResult>('test_account_connection', { input });
    }
    // Web preview fallback validation
    if (!input.email.includes('@') || !input.imapHost || !input.smtpHost) {
      return {
        success: false,
        imapOk: false,
        smtpOk: false,
        latencyMs: 0,
        message: '请填写完整的邮箱地址、IMAP 与 SMTP 主机地址',
      };
    }
    if (!input.authCode.trim()) {
      return {
        success: false,
        imapOk: false,
        smtpOk: false,
        latencyMs: 0,
        message: '请输入邮箱授权码或密码',
      };
    }
    return {
      success: true,
      imapOk: true,
      smtpOk: true,
      latencyMs: 128,
      message: '参数格式校验通过（打包为 Windows .exe 后将执行真实 TLS IMAP/SMTP 握手测试）',
    };
  },

  async saveAccount(input: AccountConfigInput): Promise<ConnectedAccount | null> {
    if (!isTauriRuntime()) return null;
    return invoke<ConnectedAccount>('save_account', { input });
  },

  async setDefaultAccount(accountId: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('set_default_account', { accountId });
  },

  async deleteAccount(accountId: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('delete_account', { accountId });
  },

  async syncAllAccounts(): Promise<SyncSummary> {
    if (isTauriRuntime()) {
      return invoke<SyncSummary>('sync_all_accounts');
    }
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return {
      fetchedCount: 0,
      newUnreadCount: 0,
      syncedAccounts: 1,
      errors: [],
      syncedAt: `${hh}:${mm}:${ss}`,
    };
  },

  async sendEmail(payload: SendEmailPayload): Promise<EmailItem | null> {
    if (!isTauriRuntime()) return null;
    return invoke<EmailItem>('send_email', { payload });
  },

  async scheduleEmail(item: ScheduledEmailItem): Promise<ScheduledEmailItem | null> {
    if (!isTauriRuntime()) return null;
    return invoke<ScheduledEmailItem>('schedule_email', { item });
  },

  async cancelScheduledEmail(id: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('cancel_scheduled_email', { id });
  },

  async saveDraft(draft: DraftItem): Promise<DraftItem | null> {
    if (!isTauriRuntime()) return null;
    return invoke<DraftItem>('save_draft', { draft });
  },

  async deleteDraft(id: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('delete_draft', { id });
  },

  async updateEmailFlags(
    emailId: string,
    patch: { unread?: boolean; starred?: boolean; archived?: boolean; tag?: string }
  ): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('update_email_flags', {
      emailId,
      unread: patch.unread ?? null,
      starred: patch.starred ?? null,
      archived: patch.archived ?? null,
      tag: patch.tag ?? null,
    });
  },

  async deleteEmail(emailId: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('delete_email', { emailId });
  },

  async pickAttachmentFiles(): Promise<EmailAttachment[] | null> {
    if (!isTauriRuntime()) return null;
    return invoke<EmailAttachment[]>('pick_attachment_files');
  },

  async downloadAttachment(
    att: { id?: string; name: string; contentBase64?: string | null },
    fallbackText?: string
  ): Promise<{ saved: boolean; message: string }> {
    if (isTauriRuntime() && att.id) {
      try {
        const savedPath = await invoke<string | null>('download_attachment', {
          attachmentId: att.id,
          fallbackName: att.name,
        });
        if (!savedPath) {
          return { saved: false, message: '已取消保存' };
        }
        return { saved: true, message: `已保存至 ${savedPath}` };
      } catch (err) {
        return { saved: false, message: String(err) };
      }
    }

    // Browser download fallback (supports real uploaded base64 blobs or demo preview files)
    try {
      let blob: Blob;
      if (att.contentBase64) {
        const bin = atob(att.contentBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes]);
      } else {
        const content =
          fallbackText ||
          `素笺 LinenMail 附件预览\n文件名：${att.name}\n\n（在 Windows Tauri 桌面版中将直接通过系统「另存为」对话框保存真实 IMAP 附件二进制文件。）\n`;
        blob = new Blob([content], { type: 'application/octet-stream' });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return { saved: true, message: `已开始下载 ${att.name}` };
    } catch {
      return { saved: false, message: `下载 ${att.name} 失败` };
    }
  },

  async getCacheStats(): Promise<CacheStats | null> {
    if (!isTauriRuntime()) return null;
    return invoke<CacheStats>('get_cache_stats');
  },

  async clearAttachmentCache(): Promise<CacheStats | null> {
    if (!isTauriRuntime()) return null;
    return invoke<CacheStats>('clear_attachment_cache');
  },

  async saveFilterRule(rule: FilterRuleItem, applyExisting: boolean): Promise<number | null> {
    if (!isTauriRuntime()) return null;
    return invoke<number>('save_filter_rule', { rule, applyExisting });
  },

  async toggleFilterRule(id: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('toggle_filter_rule', { id });
  },

  async saveSmartFolder(folder: SmartFolderItem): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('save_smart_folder', { folder });
  },

  async toggleSmartFolder(id: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('toggle_smart_folder', { id });
  },

  async saveLabel(id: string, name: string, dotClass: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('save_label', { id, name, dotClass });
  },

  async saveLlmProfile(profile: LlmProfile): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('save_llm_profile', { profile });
  },

  async activateLlmProfile(id: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('activate_llm_profile', { id });
  },

  async invokeLlmChat(req: {
    profileId?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
    messages: { role: string; content: string }[];
  }): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>('invoke_llm_chat', { req });
    }
    const baseUrl = (req.baseUrl || '').replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: req.model || 'gpt-4o-mini',
        temperature: req.temperature ?? 0.3,
        messages: req.messages,
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');
    return content;
  },

  async saveUserProfile(profile: UserProfile): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('save_user_profile', { profile });
  },

  async saveSystemSettings(settings: SystemSettingsState): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('save_system_settings', { settings });
  },

  async toggleContactStar(email: string): Promise<string[] | null> {
    if (!isTauriRuntime()) return null;
    return invoke<string[]>('toggle_contact_star', { email });
  },

  async sendTestNotification(): Promise<{ ok: boolean; message: string }> {
    if (isTauriRuntime()) {
      try {
        await invoke('send_test_notification');
        return { ok: true, message: '已触发 Windows 系统桌面通知' };
      } catch (e) {
        return { ok: false, message: String(e) };
      }
    }
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        new Notification('素笺 LinenMail', {
          body: '桌面新邮件通知测试成功',
        });
        return { ok: true, message: '已触发浏览器桌面通知' };
      }
      if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification('素笺 LinenMail', { body: '桌面新邮件通知测试成功' });
          return { ok: true, message: '已授权并发送桌面通知' };
        }
      }
    }
    return {
      ok: true,
      message: '通知开关已启用（在 Windows 桌面端将使用系统原生 Toast 通知）',
    };
  },

  async subscribeDesktopEvents(handlers: {
    onSyncComplete?: (summary: SyncSummary) => void;
    onTrayCompose?: () => void;
    onScheduledSent?: (id: string) => void;
  }): Promise<() => void> {
    if (!isTauriRuntime()) return () => {};
    const unlisteners: UnlistenFn[] = [];
    if (handlers.onSyncComplete) {
      unlisteners.push(
        await listen<SyncSummary>('linenmail://sync-complete', (ev) =>
          handlers.onSyncComplete?.(ev.payload)
        )
      );
    }
    if (handlers.onTrayCompose) {
      unlisteners.push(
        await listen('linenmail://tray-compose', () => handlers.onTrayCompose?.())
      );
    }
    if (handlers.onScheduledSent) {
      unlisteners.push(
        await listen<string>('linenmail://scheduled-sent', (ev) =>
          handlers.onScheduledSent?.(ev.payload)
        )
      );
    }
    return () => {
      for (const fn of unlisteners) fn();
    };
  },
};

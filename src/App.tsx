import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import {
  INITIAL_ACCOUNTS,
  INITIAL_CONTACTS,
  INITIAL_EMAILS,
  INITIAL_FILTERS,
  INITIAL_LABELS,
  INITIAL_LLM_PROFILES,
  INITIAL_PROFILE,
  INITIAL_SMART_FOLDERS,
  INITIAL_SYSTEM_SETTINGS,
} from './data/initialData';
import {
  aggregateContactsFromEmails,
  mailService,
  matchesFilterRule,
} from './services/mailService';
import {
  AccountConfigInput,
  AppRoute,
  ComposePrefill,
  ConnectedAccount,
  ContactAttachment,
  ContactItem,
  DraftItem,
  EmailAttachment,
  EmailItem,
  FilterRuleItem,
  LabelItem,
  LlmProfile,
  MailFolder,
  ScheduledEmailItem,
  SmartFolderItem,
  SystemSettingsState,
  UserProfile,
} from './types/mail';
import { AccountSettingsView } from './views/AccountSettingsView';
import { ComposeView } from './views/ComposeView';
import { ContactsView } from './views/ContactsView';
import { MainInboxView } from './views/MainInboxView';
import { OnboardingView } from './views/OnboardingView';
import { SmartFoldersView } from './views/SmartFoldersView';
import { SystemSettingsView } from './views/SystemSettingsView';

const STORAGE_KEY = 'linenmail_workspace_v2';

interface PersistedState {
  emails: EmailItem[];
  contacts: ContactItem[];
  smartFolders: SmartFolderItem[];
  labels: LabelItem[];
  filters: FilterRuleItem[];
  llmProfiles: LlmProfile[];
  accounts: ConnectedAccount[];
  profile: UserProfile;
  systemSettings: SystemSettingsState;
  drafts?: DraftItem[];
  scheduledEmails?: ScheduledEmailItem[];
  starredContacts?: string[];
}

function loadWebFallbackState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        emails: parsed.emails || INITIAL_EMAILS,
        contacts: parsed.contacts || INITIAL_CONTACTS,
        smartFolders: parsed.smartFolders || INITIAL_SMART_FOLDERS,
        labels: parsed.labels || INITIAL_LABELS,
        filters: parsed.filters || INITIAL_FILTERS,
        llmProfiles: parsed.llmProfiles || INITIAL_LLM_PROFILES,
        accounts: parsed.accounts || INITIAL_ACCOUNTS,
        profile: parsed.profile || INITIAL_PROFILE,
        systemSettings: {
          minimizeToTray: true,
          desktopNotifications: true,
          ...(parsed.systemSettings || INITIAL_SYSTEM_SETTINGS),
        },
        drafts: parsed.drafts || [],
        scheduledEmails: parsed.scheduledEmails || [],
        starredContacts: parsed.starredContacts || [],
      };
    }
  } catch {
    // ignore corrupted storage
  }
  return {
    emails: INITIAL_EMAILS,
    contacts: INITIAL_CONTACTS,
    smartFolders: INITIAL_SMART_FOLDERS,
    labels: INITIAL_LABELS,
    filters: INITIAL_FILTERS,
    llmProfiles: INITIAL_LLM_PROFILES,
    accounts: INITIAL_ACCOUNTS,
    profile: INITIAL_PROFILE,
    systemSettings: {
      minimizeToTray: true,
      desktopNotifications: true,
      ...INITIAL_SYSTEM_SETTINGS,
    },
    drafts: [],
    scheduledEmails: [],
    starredContacts: [],
  };
}

export default function App() {
  const initial = useMemo(() => loadWebFallbackState(), []);

  const [emails, setEmails] = useState<EmailItem[]>(initial.emails);
  const [seedContacts, setSeedContacts] = useState<ContactItem[]>(initial.contacts);
  const [starredContacts, setStarredContacts] = useState<string[]>(initial.starredContacts || []);
  const [smartFolders, setSmartFolders] = useState<SmartFolderItem[]>(initial.smartFolders);
  const [labels, setLabels] = useState<LabelItem[]>(initial.labels);
  const [filters, setFilters] = useState<FilterRuleItem[]>(initial.filters);
  const [llmProfiles, setLlmProfiles] = useState<LlmProfile[]>(initial.llmProfiles);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>(initial.accounts);
  const [profile, setProfile] = useState<UserProfile>(initial.profile);
  const [systemSettings, setSystemSettings] = useState<SystemSettingsState>(initial.systemSettings);
  const [drafts, setDrafts] = useState<DraftItem[]>(initial.drafts || []);
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmailItem[]>(
    initial.scheduledEmails || []
  );

  const [dataDir, setDataDir] = useState<string>('');
  const [portableMode, setPortableMode] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [lastSyncText, setLastSyncText] = useState<string>('刚刚');
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const [activeRoute, setActiveRoute] = useState<AppRoute>('inbox');
  const [activeFolder, setActiveFolder] = useState<MailFolder>('inbox');
  const [activeEmailId, setActiveEmailId] = useState<string>(initial.emails[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [composePrefill, setComposePrefill] = useState<ComposePrefill | null>(null);

  const refreshFromSqlite = useCallback(async () => {
    const snap = await mailService.getWorkspace();
    if (!snap) return;
    setEmails(snap.emails);
    setAccounts(snap.accounts);
    setSmartFolders(snap.smartFolders);
    setLabels(snap.labels);
    setFilters(snap.filters);
    setLlmProfiles(snap.llmProfiles);
    setProfile(snap.profile);
    setSystemSettings(snap.systemSettings);
    setDrafts(snap.drafts);
    setScheduledEmails(snap.scheduledEmails);
    setStarredContacts(snap.starredContacts);
    setDataDir(snap.dataDir);
    setPortableMode(snap.portableMode);
    if (snap.emails.length > 0) {
      setActiveEmailId((prev) =>
        snap.emails.some((e) => e.id === prev) ? prev : snap.emails[0].id
      );
    }
  }, []);

  // Hydrate from Rust SQLite on desktop startup & listen to tray/sync events
  useEffect(() => {
    if (!mailService.isDesktop()) return;
    void refreshFromSqlite();

    let cleanup = () => {};
    void mailService
      .subscribeDesktopEvents({
        onSyncComplete: (summary) => {
          setLastSyncText(summary.syncedAt);
          if (summary.fetchedCount > 0) {
            setSyncNotice(`已同步 ${summary.fetchedCount} 封新邮件`);
            setTimeout(() => setSyncNotice(null), 4000);
          }
          void refreshFromSqlite();
        },
        onTrayCompose: () => {
          setComposePrefill(null);
          setActiveRoute('compose');
        },
        onScheduledSent: () => {
          void refreshFromSqlite();
        },
      })
      .then((fn) => {
        cleanup = fn;
      });

    return () => cleanup();
  }, [refreshFromSqlite]);

  // Persist workspace state to localStorage when in web preview mode
  useEffect(() => {
    if (mailService.isDesktop()) return;
    try {
      const payload: PersistedState = {
        emails,
        contacts: seedContacts,
        smartFolders,
        labels,
        filters,
        llmProfiles: llmProfiles.map((p) => ({ ...p, apiKey: '' })),
        accounts,
        profile,
        systemSettings,
        drafts,
        scheduledEmails,
        starredContacts,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore quota errors
    }
  }, [
    emails,
    seedContacts,
    smartFolders,
    labels,
    filters,
    llmProfiles,
    accounts,
    profile,
    systemSettings,
    drafts,
    scheduledEmails,
    starredContacts,
  ]);

  // Browser preview fallback scheduler for scheduled emails
  useEffect(() => {
    if (mailService.isDesktop() || scheduledEmails.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const due = scheduledEmails.filter((s) => s.status === 'pending' && s.scheduledAtMs <= now);
      if (due.length === 0) return;
      setScheduledEmails((prev) => prev.filter((s) => !due.some((d) => d.id === s.id)));
      due.forEach((item) => {
        const lines = item.body.split('\n').filter(Boolean);
        const sentMail: EmailItem = {
          id: `mail-sent-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          sender: `我 → ${item.recipients[0]}`,
          email: item.recipients[0],
          recipient: item.recipients.join(', '),
          cc: item.cc || null,
          avatarImg: null,
          initials: profile.initial,
          subject: item.subject,
          preview: lines[0] || item.body.slice(0, 64),
          time: '刚刚',
          fullTime: '今天 刚刚',
          timestampMs: Date.now(),
          unread: false,
          starred: false,
          folder: 'sent',
          tag: '设计评审',
          attachment: item.attachments[0] || null,
          attachments: item.attachments,
          paragraphs: lines.length > 0 ? lines : ['（无正文）'],
          signoff: `祝好，${profile.name}`,
        };
        setEmails((prev) => [sentMail, ...prev]);
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [scheduledEmails, profile.initial, profile.name]);

  const activeLlm = useMemo(
    () => llmProfiles.find((p) => p.active) || llmProfiles[0],
    [llmProfiles]
  );

  const defaultAccount = useMemo(
    () => accounts.find((a) => a.isDefault) || accounts[0],
    [accounts]
  );

  const inboxUnreadCount = useMemo(
    () => emails.filter((e) => e.folder === 'inbox' && !e.archived && e.unread).length,
    [emails]
  );

  // Dynamically recompute smart folder & label counts from live emails
  const computedSmartFolders = useMemo(
    () =>
      smartFolders.map((sf) => {
        const matched = emails.filter((e) => e.tag === sf.tag);
        return {
          ...sf,
          total: matched.length,
          unread: matched.filter((e) => e.unread).length,
        };
      }),
    [smartFolders, emails]
  );

  const computedLabels = useMemo(
    () =>
      labels.map((lbl) => ({
        ...lbl,
        count: emails.filter((e) => e.tag === lbl.name).length,
      })),
    [labels, emails]
  );

  const mergedContacts = useMemo(
    () =>
      aggregateContactsFromEmails(
        emails,
        mailService.isDesktop() ? [] : seedContacts,
        starredContacts
      ),
    [emails, seedContacts, starredContacts]
  );

  const handleSyncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncNotice(null);
    try {
      const summary = await mailService.syncAllAccounts();
      setLastSyncText(summary.syncedAt);
      if (summary.errors.length > 0) {
        setSyncNotice(`同步提醒：${summary.errors[0]}`);
      } else if (summary.fetchedCount > 0) {
        setSyncNotice(`新收到 ${summary.fetchedCount} 封邮件`);
      } else if (mailService.isDesktop() && summary.syncedAccounts === 0) {
        setSyncNotice('请先在账户设置中配置邮箱授权码');
      } else {
        setSyncNotice(`已是最新 · ${summary.syncedAt}`);
      }
      if (mailService.isDesktop()) {
        await refreshFromSqlite();
      }
      setTimeout(() => setSyncNotice(null), 4000);
    } catch (e) {
      setSyncNotice(`同步失败：${String(e)}`);
      setTimeout(() => setSyncNotice(null), 4500);
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshFromSqlite]);

  const handleSelectFolder = (folder: MailFolder) => {
    setActiveFolder(folder);
    setActiveRoute('inbox');
    setSearchQuery('');
    const firstInFolder = emails.find((e) =>
      folder === 'inbox'
        ? e.folder === 'inbox' && !e.archived
        : folder === 'sent'
        ? e.folder === 'sent' && !e.archived
        : e.folder === 'archive' || !!e.archived
    );
    if (firstInFolder) {
      setActiveEmailId(firstInFolder.id);
    }
  };

  const handleSelectEmail = (id: string) => {
    setActiveEmailId(id);
    const target = emails.find((m) => m.id === id);
    setEmails((prev) => prev.map((m) => (m.id === id ? { ...m, unread: false } : m)));
    if (target?.unread) {
      void mailService.updateEmailFlags(id, { unread: false });
    }
  };

  const handleToggleStar = (id: string) => {
    const target = emails.find((m) => m.id === id);
    const nextStar = !(target?.starred ?? false);
    setEmails((prev) => prev.map((m) => (m.id === id ? { ...m, starred: nextStar } : m)));
    void mailService.updateEmailFlags(id, { starred: nextStar });
  };

  const handleToggleRead = (id: string) => {
    const target = emails.find((m) => m.id === id);
    const nextUnread = !(target?.unread ?? false);
    setEmails((prev) => prev.map((m) => (m.id === id ? { ...m, unread: nextUnread } : m)));
    void mailService.updateEmailFlags(id, { unread: nextUnread });
  };

  const handleArchiveEmail = (id: string) => {
    setEmails((prev) => prev.map((m) => (m.id === id ? { ...m, archived: true } : m)));
    void mailService.updateEmailFlags(id, { archived: true });
  };

  const handleDeleteEmail = (id: string) => {
    setEmails((prev) => prev.filter((m) => m.id !== id));
    void mailService.deleteEmail(id);
  };

  const handleChangeTag = (id: string, tag: string) => {
    setEmails((prev) => prev.map((m) => (m.id === id ? { ...m, tag } : m)));
    void mailService.updateEmailFlags(id, { tag });
  };

  const handleSendFullEmail = useCallback(
    async (payload: {
      recipients: string[];
      cc: string;
      subject: string;
      body: string;
      attachments: EmailAttachment[];
    }): Promise<{ ok: boolean; sentId?: string; error?: string }> => {
      if (mailService.isDesktop()) {
        try {
          const sentMail = await mailService.sendEmail({
            accountId: defaultAccount?.id || null,
            recipients: payload.recipients,
            cc: payload.cc,
            subject: payload.subject,
            body: payload.body,
            attachments: payload.attachments,
          });
          if (sentMail) {
            setEmails((prev) => [sentMail, ...prev]);
            return { ok: true, sentId: sentMail.id };
          }
          return { ok: false, error: '发信失败' };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      }

      const sentId = `mail-sent-${Date.now()}`;
      const recipientLabel = payload.recipients.join(', ');
      const lines = payload.body.split('\n').filter(Boolean);
      const newMail: EmailItem = {
        id: sentId,
        sender: `我 → ${payload.recipients[0]}`,
        email: payload.recipients[0],
        recipient: recipientLabel,
        cc: payload.cc || null,
        avatarImg: null,
        initials: profile.initial,
        subject: payload.subject,
        preview: lines[0] || payload.body.slice(0, 64),
        time: '刚刚',
        fullTime: '今天 刚刚',
        timestampMs: Date.now(),
        unread: false,
        starred: false,
        folder: 'sent',
        tag: '设计评审',
        attachment: payload.attachments[0] || null,
        attachments: payload.attachments,
        paragraphs: lines.length > 0 ? lines : ['（无正文）'],
        signoff: `祝好，${profile.name}`,
      };
      setEmails((prev) => [newMail, ...prev]);
      return { ok: true, sentId };
    },
    [defaultAccount?.id, profile.initial, profile.name]
  );

  const handleSendQuickReply = (toEmail: string, subject: string, body: string) => {
    void handleSendFullEmail({
      recipients: [toEmail],
      cc: '',
      subject,
      body,
      attachments: [],
    });
  };

  const handleScheduleEmail = async (item: ScheduledEmailItem) => {
    const withAcc: ScheduledEmailItem = {
      ...item,
      accountId: defaultAccount?.id || null,
    };
    if (mailService.isDesktop()) {
      const saved = await mailService.scheduleEmail(withAcc);
      if (saved) setScheduledEmails((prev) => [...prev, saved]);
    } else {
      setScheduledEmails((prev) => [...prev, withAcc]);
    }
  };

  const handleSaveDraft = async (draft: DraftItem) => {
    if (mailService.isDesktop()) {
      const saved = await mailService.saveDraft(draft);
      if (saved) {
        setDrafts((prev) => [saved, ...prev.filter((d) => d.id !== saved.id)]);
      }
    } else {
      setDrafts((prev) => [draft, ...prev.filter((d) => d.id !== draft.id)]);
    }
  };

  const handleAddAccount = async (input: AccountConfigInput) => {
    if (mailService.isDesktop()) {
      const saved = await mailService.saveAccount(input);
      if (saved) {
        await refreshFromSqlite();
        // Trigger immediate sync after connecting a real mailbox
        void handleSyncNow();
      }
      return;
    }

    const label = input.label || input.provider;
    const newAcc: ConnectedAccount = {
      id: `acc-${Date.now()}`,
      email: input.email,
      badgeChar: input.badgeChar || label.charAt(0) || '邮',
      description: `${label} · IMAP/SMTP 已连接`,
      isDefault: accounts.length === 0 || Boolean(input.isDefault),
      provider: input.provider,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      hasCredentials: Boolean(input.authCode),
    };
    setAccounts((prev) => {
      const reset = newAcc.isDefault ? prev.map((a) => ({ ...a, isDefault: false })) : prev;
      return [...reset, newAcc];
    });
  };

  const handleDeleteAccount = async (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    await mailService.deleteAccount(id);
  };

  const handleDownloadAttachment = async (
    email: EmailItem,
    att: EmailAttachment
  ): Promise<string> => {
    const res = await mailService.downloadAttachment(
      att,
      `素笺 LinenMail 附件\n来自：${email.sender} <${email.email}>\n主题：${email.subject}\n文件：${att.name} (${att.size})\n`
    );
    return res.message;
  };

  const handleDownloadContactAttachment = async (att: ContactAttachment): Promise<string> => {
    const res = await mailService.downloadAttachment({
      id: att.id,
      name: att.name,
      contentBase64: att.contentBase64,
    });
    return res.message;
  };

  const handleAddFilter = async (rule: FilterRuleItem, applyExisting: boolean) => {
    if (mailService.isDesktop()) {
      await mailService.saveFilterRule(rule, applyExisting);
      await refreshFromSqlite();
      return;
    }

    let hitCount = rule.hits;
    if (applyExisting) {
      let matched = 0;
      setEmails((prev) =>
        prev.map((m) => {
          if (!matchesFilterRule(m, rule)) return m;
          matched += 1;
          return {
            ...m,
            tag: rule.actionTag || m.tag,
            archived: rule.actionArchive ? true : m.archived,
            unread: rule.actionMarkRead ? false : m.unread,
            starred: rule.actionStar ? true : m.starred,
          };
        })
      );
      hitCount = matched;
    }
    setFilters((prev) => [{ ...rule, hits: hitCount }, ...prev]);
  };

  const handleClearCache = async () => {
    if (mailService.isDesktop()) {
      const stats = await mailService.clearAttachmentCache();
      if (stats) {
        setSystemSettings((prev) => ({
          ...prev,
          cacheBytes: stats.cacheBytes,
          dbSizeBytes: stats.dbSizeBytes,
          cacheText: stats.cacheText,
        }));
      }
      return;
    }
    setSystemSettings((prev) => ({
      ...prev,
      cacheBytes: 0,
      cacheText: '本地附件缓存已清理，当前占用 0 KB',
    }));
  };

  const handleUpdateProfile = (next: Partial<UserProfile>) => {
    setProfile((prev) => {
      const updated = { ...prev, ...next };
      void mailService.saveUserProfile(updated);
      return updated;
    });
  };

  const handleUpdateSystemSettings = (next: Partial<SystemSettingsState>) => {
    setSystemSettings((prev) => {
      const updated = { ...prev, ...next };
      void mailService.saveSystemSettings(updated);
      return updated;
    });
  };

  const openCompose = (prefill: ComposePrefill | null = null) => {
    setComposePrefill(prefill);
    setActiveRoute('compose');
  };

  const handleOpenEmailInInbox = (emailId?: string) => {
    if (emailId) {
      const target = emails.find((e) => e.id === emailId);
      if (target) {
        setActiveFolder(target.archived ? 'archive' : target.folder);
        setActiveEmailId(target.id);
        setEmails((prev) => prev.map((m) => (m.id === target.id ? { ...m, unread: false } : m)));
        void mailService.updateEmailFlags(target.id, { unread: false });
      }
    } else {
      setActiveFolder('inbox');
    }
    setTagFilter(null);
    setActiveRoute('inbox');
  };

  if (activeRoute === 'compose') {
    return (
      <ComposeView
        profile={profile}
        senderEmail={defaultAccount?.email || profile.primaryEmail}
        activeLlm={activeLlm}
        prefill={composePrefill}
        onBackToInbox={() => setActiveRoute('inbox')}
        onSendEmail={handleSendFullEmail}
        onScheduleEmail={handleScheduleEmail}
        onSaveDraft={handleSaveDraft}
      />
    );
  }

  if (activeRoute === 'account') {
    return (
      <AccountSettingsView
        profile={profile}
        accounts={accounts}
        dataDir={dataDir}
        portableMode={portableMode}
        onBackToInbox={() => setActiveRoute('inbox')}
        onUpdateProfile={handleUpdateProfile}
        onAddAccount={handleAddAccount}
        onDeleteAccount={handleDeleteAccount}
        onSetDefaultAccount={(id) => {
          setAccounts((prev) => prev.map((a) => ({ ...a, isDefault: a.id === id })));
          void mailService.setDefaultAccount(id);
        }}
        onNavigate={(r) => setActiveRoute(r)}
      />
    );
  }

  if (activeRoute === 'system-settings') {
    return (
      <SystemSettingsView
        emails={emails}
        filters={filters}
        llmProfiles={llmProfiles}
        systemSettings={systemSettings}
        onBackToInbox={() => setActiveRoute('inbox')}
        onNavigate={(r) => setActiveRoute(r)}
        onToggleFilter={(id) => {
          setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)));
          void mailService.toggleFilterRule(id);
        }}
        onAddFilter={handleAddFilter}
        onActivateLlm={(id) => {
          setLlmProfiles((prev) => prev.map((p) => ({ ...p, active: p.id === id })));
          void mailService.activateLlmProfile(id);
        }}
        onAddLlm={(newProfile) => {
          setLlmProfiles((prev) => [
            newProfile,
            ...prev.map((p) => ({ ...p, active: false })),
          ]);
          void mailService.saveLlmProfile(newProfile);
        }}
        onUpdateSystemSettings={handleUpdateSystemSettings}
        onClearCache={handleClearCache}
      />
    );
  }

  if (activeRoute === 'onboarding') {
    return (
      <OnboardingView
        onComplete={async (config) => {
          if (config) {
            await handleAddAccount(config);
          }
          setActiveRoute('inbox');
        }}
      />
    );
  }

  const searchPlaceholder =
    activeRoute === 'smart-folders'
      ? '搜索智能文件夹、规则或标签...'
      : activeRoute === 'contacts'
      ? '搜索联系人或往来附件...'
      : '搜索发件人、主题或关键词...';

  return (
    <div className="min-h-screen bg-light-surface flex flex-col px-gutter-xl py-gutter-lg gap-gutter-lg max-w-[1440px] mx-auto">
      <AppHeader
        activeRoute={activeRoute}
        activeFolder={activeFolder}
        unreadCount={inboxUnreadCount}
        searchQuery={searchQuery}
        searchPlaceholder={searchPlaceholder}
        userInitial={profile.initial}
        userName={profile.name}
        userEmail={defaultAccount?.email || profile.primaryEmail}
        syncing={syncing}
        lastSyncText={lastSyncText}
        onSyncNow={() => void handleSyncNow()}
        onSelectFolder={(folder) => {
          setTagFilter(null);
          handleSelectFolder(folder);
        }}
        onNavigate={(route) => {
          setSearchQuery('');
          setActiveRoute(route);
        }}
        onSearchChange={setSearchQuery}
        onCompose={() => openCompose(null)}
      />

      {activeRoute === 'inbox' && (
        <MainInboxView
          emails={emails}
          activeFolder={activeFolder}
          activeEmailId={activeEmailId}
          searchQuery={searchQuery}
          tagFilter={tagFilter}
          activeLlm={activeLlm}
          enableShortcuts={profile.enableShortcuts}
          minimalReading={profile.minimalReading}
          undoSeconds={profile.undoSeconds}
          userName={profile.name}
          userEmail={defaultAccount?.email || profile.primaryEmail}
          syncing={syncing}
          lastSyncText={lastSyncText}
          syncNotice={syncNotice}
          onSyncNow={() => void handleSyncNow()}
          onDownloadAttachment={handleDownloadAttachment}
          onSelectEmail={handleSelectEmail}
          onClearTagFilter={() => setTagFilter(null)}
          onToggleStar={handleToggleStar}
          onToggleRead={handleToggleRead}
          onArchiveEmail={handleArchiveEmail}
          onDeleteEmail={handleDeleteEmail}
          onChangeTag={handleChangeTag}
          onSendQuickReply={handleSendQuickReply}
          onForwardEmail={(prefill) => openCompose(prefill)}
        />
      )}

      {activeRoute === 'smart-folders' && (
        <SmartFoldersView
          smartFolders={computedSmartFolders}
          labels={computedLabels}
          searchQuery={searchQuery}
          onToggleFolder={(id) => {
            setSmartFolders((prev) =>
              prev.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f))
            );
            void mailService.toggleSmartFolder(id);
          }}
          onAddFolder={(folder) => {
            setSmartFolders((prev) => [folder, ...prev]);
            void mailService.saveSmartFolder(folder);
          }}
          onUpdateFolder={(id, name, conditions) => {
            setSmartFolders((prev) =>
              prev.map((f) => {
                if (f.id !== id) return f;
                const updated = { ...f, name, conditions };
                void mailService.saveSmartFolder(updated);
                return updated;
              })
            );
          }}
          onAddLabel={(name) => {
            const newLbl: LabelItem = {
              id: `lbl-${Date.now()}`,
              name,
              count: 0,
              dotClass: 'bg-light-primary',
            };
            setLabels((prev) => [...prev, newLbl]);
            void mailService.saveLabel(newLbl.id, newLbl.name, newLbl.dotClass);
          }}
          onRenameLabel={(id, name) => {
            setLabels((prev) =>
              prev.map((l) => {
                if (l.id !== id) return l;
                void mailService.saveLabel(l.id, name, l.dotClass);
                return { ...l, name };
              })
            );
          }}
          onViewTagInInbox={(tag) => {
            setTagFilter(tag);
            setActiveFolder('inbox');
            setActiveRoute('inbox');
          }}
        />
      )}

      {activeRoute === 'contacts' && (
        <ContactsView
          contacts={mergedContacts}
          searchQuery={searchQuery}
          onToggleStarContact={(contact) => {
            if (mailService.isDesktop()) {
              void mailService.toggleContactStar(contact.email).then((list) => {
                if (list) setStarredContacts(list);
              });
            } else {
              setSeedContacts((prev) =>
                prev.map((c) => (c.id === contact.id ? { ...c, starred: !c.starred } : c))
              );
              const lower = contact.email.toLowerCase();
              setStarredContacts((prev) =>
                prev.includes(lower) ? prev.filter((e) => e !== lower) : [...prev, lower]
              );
            }
          }}
          onComposeToContact={(prefill) => openCompose(prefill)}
          onOpenEmailInInbox={handleOpenEmailInInbox}
          onDownloadContactAttachment={handleDownloadContactAttachment}
        />
      )}
    </div>
  );
}

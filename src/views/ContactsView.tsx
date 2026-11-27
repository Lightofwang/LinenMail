import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { CARDDAV_PRESETS, mailService } from '../services/mailService';
import {
  CardDavConfigInput,
  CardDavConfigState,
  ComposePrefill,
  ContactAttachment,
  ContactItem,
  ContactSyncResult,
  DirectoryContact,
} from '../types/mail';
import { matchesContactQuery, parseClientContactsFile } from '../utils/pinyinSearch';
import { cleanMailText } from '../utils/textClean';

interface ContactsViewProps {
  contacts: ContactItem[];
  searchQuery: string;
  defaultAccountEmail?: string;
  onToggleStarContact: (contact: ContactItem) => void;
  onComposeToContact: (prefill: ComposePrefill) => void;
  onOpenEmailInInbox: (emailId?: string) => void;
  onDownloadContactAttachment: (att: ContactAttachment) => Promise<string>;
  onSyncCardDav: (input: CardDavConfigInput) => Promise<ContactSyncResult>;
  onImportContactsDesktop: () => Promise<ContactSyncResult | null>;
  onImportContactsLocalFallback: (imported: DirectoryContact[], fileName: string) => void;
}

type ContactGroup = 'all' | 'starred' | 'team' | 'partner';

export const ContactsView: React.FC<ContactsViewProps> = ({
  contacts,
  searchQuery,
  defaultAccountEmail,
  onToggleStarContact,
  onComposeToContact,
  onOpenEmailInInbox,
  onDownloadContactAttachment,
  onSyncCardDav,
  onImportContactsDesktop,
  onImportContactsLocalFallback,
}) => {
  const [activeContactId, setActiveContactId] = useState(contacts[0]?.id || '');
  const [currentGroup, setCurrentGroup] = useState<ContactGroup>('all');
  const [currentTab, setCurrentTab] = useState<'attachments' | 'threads'>('attachments');
  const [downloadToast, setDownloadToast] = useState<string | null>(null);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  // CardDAV Sync Modal state
  const [cardDavOpen, setCardDavOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState('exmail_qq');
  const [serverUrl, setServerUrl] = useState('https://dav.exmail.qq.com');
  const [useDefaultAccount, setUseDefaultAccount] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [lastSyncInfo, setLastSyncInfo] = useState<string | null>(null);
  const [syncingCardDav, setSyncingCardDav] = useState(false);
  const [cardDavError, setCardDavError] = useState<string | null>(null);
  const [cardDavSuccess, setCardDavSuccess] = useState<string | null>(null);
  const [importingFile, setImportingFile] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cardDavOpen) return;
    void mailService.getCardDavConfig().then((cfg: CardDavConfigState | null) => {
      if (!cfg) return;
      if (cfg.serverUrl) {
        setServerUrl(cfg.serverUrl);
        const matched = CARDDAV_PRESETS.find((p) => p.serverUrl === cfg.serverUrl);
        setSelectedPresetId(matched ? matched.id : 'custom');
      }
      setUsername(cfg.username || '');
      setUseDefaultAccount(cfg.useDefaultAccount);
      setHasStoredPassword(cfg.hasPassword);
      if (cfg.lastSyncAt) {
        setLastSyncInfo(`上次同步：${cfg.lastSyncAt}（${cfg.lastSyncCount} 位联系人）`);
      }
    });
  }, [cardDavOpen]);

  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (currentGroup === 'starred' && !c.starred) return false;
      if (currentGroup === 'team' && c.group !== 'team') return false;
      if (currentGroup === 'partner' && c.group !== 'partner') return false;
      if (searchQuery.trim()) {
        return matchesContactQuery(c, searchQuery);
      }
      return true;
    });
  }, [contacts, currentGroup, searchQuery]);

  const activeContact =
    filteredContacts.find((c) => c.id === activeContactId) ||
    contacts.find((c) => c.id === activeContactId) ||
    filteredContacts[0] ||
    null;

  const triggerDownload = async (att: ContactAttachment) => {
    setDownloadToast(`正在准备 ${att.name}...`);
    const msg = await onDownloadContactAttachment(att);
    setDownloadToast(msg);
    setTimeout(() => setDownloadToast(null), 2800);
  };

  const showSyncToast = (msg: string) => {
    setSyncToast(msg);
    setTimeout(() => setSyncToast(null), 4000);
  };

  const handleCardDavSyncSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (syncingCardDav) return;
    setCardDavError(null);
    setCardDavSuccess(null);
    setSyncingCardDav(true);
    try {
      const res = await onSyncCardDav({
        serverUrl: serverUrl.trim(),
        username: username.trim(),
        password: password.trim(),
        useDefaultAccount,
      });
      setCardDavSuccess(res.message);
      setLastSyncInfo(`刚刚同步 ${res.importedCount} 位 · 通讯录共 ${res.totalDirectoryCount} 人`);
      setPassword('');
      showSyncToast(res.message);
    } catch (err) {
      setCardDavError(String(err));
    } finally {
      setSyncingCardDav(false);
    }
  };

  const handleImportFileClick = async () => {
    if (importingFile) return;
    if (mailService.isDesktop()) {
      setImportingFile(true);
      try {
        const res = await onImportContactsDesktop();
        if (res) {
          showSyncToast(res.message);
        }
      } catch (err) {
        showSyncToast(`导入失败：${String(err)}`);
      } finally {
        setImportingFile(false);
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleBrowserFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const parsed = parseClientContactsFile(text, file.name);
      if (parsed.length === 0) {
        showSyncToast('未解析到有效联系人邮箱，请检查 VCF/CSV 格式');
      } else {
        onImportContactsLocalFallback(parsed, file.name);
        showSyncToast(`已从「${file.name}」导入 ${parsed.length} 位联系人`);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const activePreset =
    CARDDAV_PRESETS.find((p) => p.id === selectedPresetId) || CARDDAV_PRESETS[0];

  return (
    <main className="flex-1 min-h-0 flex flex-col lg:flex-row gap-5 overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept=".vcf,.csv,text/vcard,text/csv"
        className="hidden"
        onChange={handleBrowserFilePick}
      />

      {/* Left Column: Contacts Stream */}
      <section
        aria-label="联系人列表"
        className="w-full lg:w-[390px] xl:w-[440px] 2xl:w-[480px] shrink-0 flex flex-col gap-3 min-h-0 h-full"
      >
        <div className="shrink-0 flex flex-col gap-2.5 px-1">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-headline text-headline-lg text-light-on-surface">联系人与通讯录</h1>
            <span className="font-label text-label-md text-light-on-surface-variant tabular-nums">
              {filteredContacts.length} 位联系人
            </span>
          </div>

          {/* Enterprise Directory Sync & Import Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCardDavError(null);
                setCardDavSuccess(null);
                setCardDavOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container font-label text-label-md transition-colors duration-state-change cursor-pointer"
            >
              <span className="material-symbols-outlined text-title-sm" aria-hidden="true">
                sync
              </span>
              <span>同步企业通讯录</span>
            </button>

            <button
              type="button"
              disabled={importingFile}
              onClick={() => void handleImportFileClick()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change cursor-pointer disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-title-sm" aria-hidden="true">
                upload_file
              </span>
              <span>{importingFile ? '导入中...' : '导入 VCF / CSV'}</span>
            </button>
          </div>

          {syncToast && (
            <div className="px-3 py-2 rounded-lg bg-light-secondary-container/80 text-light-on-secondary-container font-label text-label-sm">
              {syncToast}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-gutter-sm" role="group" aria-label="联系人筛选">
            {(
              [
                { id: 'all', label: '全部联系人' },
                { id: 'starred', label: '星标常用' },
                { id: 'team', label: '企业 / 团队' },
                { id: 'partner', label: '外部往来' },
              ] as { id: ContactGroup; label: string }[]
            ).map((grp) => {
              const active = currentGroup === grp.id;
              return (
                <button
                  key={grp.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCurrentGroup(grp.id)}
                  className={`inline-flex items-center px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
                    active
                      ? 'bg-light-surface-container-highest text-light-on-surface'
                      : 'bg-light-surface-container-low text-light-on-surface-variant hover:bg-light-surface-container'
                  }`}
                >
                  {grp.label}
                </button>
              );
            })}
          </div>
        </div>

        <ul
          className="flex-1 min-h-0 overflow-y-auto pr-1.5 linen-scroll flex flex-col gap-1.5"
          role="listbox"
          aria-label="联系人列表"
        >
          {filteredContacts.length === 0 ? (
            <li className="p-6 rounded-xl bg-light-surface-container-low/60 text-center flex flex-col items-center gap-2 text-light-on-surface-variant">
              <span className="material-symbols-outlined text-headline-md opacity-60" aria-hidden="true">
                contacts
              </span>
              <p className="font-body text-body-md">
                {searchQuery.trim()
                  ? `未找到与「${searchQuery}」匹配的联系人（支持拼音首字母检索）`
                  : '暂无联系人，可点击上方同步企业通讯录或导入 VCF / CSV'}
              </p>
            </li>
          ) : (
            filteredContacts.map((c) => {
              const isActive = c.id === activeContact?.id;
              return (
                <li
                  key={c.id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => setActiveContactId(c.id)}
                  className={`contact-row flex items-center justify-between gap-gutter-md p-gutter-md rounded-lg cursor-pointer transition-colors duration-state-change ${
                    isActive
                      ? 'bg-light-surface-container-lowest shadow-[0_4px_16px_-4px_rgba(35,25,20,0.06)]'
                      : 'hover:bg-light-surface-container-low'
                  }`}
                >
                  <div className="flex items-center gap-gutter-md min-w-0">
                    <Avatar src={c.avatarImg} initials={c.initials} alt={c.name} />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-gutter-xs">
                        <span className="font-title text-title-md text-light-on-surface truncate">
                          {c.name}
                        </span>
                        {c.starred && (
                          <span
                            className="material-symbols-outlined text-body-sm text-light-primary material-symbols-filled"
                            aria-hidden="true"
                          >
                            star
                          </span>
                        )}
                      </div>
                      <span className="font-body text-body-sm text-light-on-surface-variant truncate">
                        {c.role || c.email}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end shrink-0">
                    <span className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums">
                      {c.attachments.length > 0
                        ? `${c.attachments.length} 个附件`
                        : c.threads.length > 0
                        ? `${c.threads.length} 封邮件`
                        : c.source === 'carddav'
                        ? '企业通讯录'
                        : c.source === 'import'
                        ? '已导入'
                        : '0 个附件'}
                    </span>
                    <span className="font-label text-label-sm text-light-on-surface-variant tabular-nums">
                      {c.lastActive}
                    </span>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </section>

      {/* Right Column: Contact Detail & Attachment History Hub */}
      <article
        aria-label="联系人往来附件中心"
        className="flex-1 min-w-0 h-full min-h-0 bg-light-surface-container-lowest rounded-xl p-7 shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-5 overflow-hidden"
      >
        {activeContact ? (
          <>
            {/* Contact Identity Header */}
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex items-center gap-gutter-md min-w-0">
                <Avatar
                  src={activeContact.avatarImg}
                  initials={activeContact.initials}
                  alt={activeContact.name}
                  size="lg"
                />
                <div className="flex flex-col gap-gutter-xs min-w-0">
                  <div className="flex items-center gap-gutter-sm flex-wrap">
                    <h2 className="font-headline text-headline-md text-light-on-surface truncate">
                      {activeContact.name}
                    </h2>
                    <span className="px-gutter-sm py-0.5 rounded-full bg-light-secondary-container text-light-on-secondary-container font-label text-label-sm shrink-0">
                      {activeContact.groupLabel}
                    </span>
                  </div>
                  <p className="font-body text-body-sm text-light-on-surface-variant truncate">
                    {activeContact.role} · {activeContact.email}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-gutter-xs shrink-0">
                <button
                  type="button"
                  onClick={() => onToggleStarContact(activeContact)}
                  aria-label="星标联系人"
                  className={`inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-light-surface-container transition-colors duration-state-change cursor-pointer ${
                    activeContact.starred ? 'text-light-primary' : 'text-light-on-surface-variant'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-title-lg ${
                      activeContact.starred ? 'material-symbols-filled' : ''
                    }`}
                    aria-hidden="true"
                  >
                    star
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onComposeToContact({
                      recipients: [activeContact.email],
                      subject: '',
                      body: `${activeContact.name}，你好：\n\n`,
                    })
                  }
                  className="inline-flex items-center justify-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container transition-colors duration-state-change cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                    send
                  </span>
                  <span className="font-label text-label-lg">发邮件</span>
                </button>
              </div>
            </div>

            {/* View Switcher Tabs */}
            <div className="flex items-center justify-between gap-gutter-md border-b border-light-surface-container-high pb-gutter-sm">
              <div className="flex items-center gap-gutter-xs" role="tablist" aria-label="往来内容视图">
                <button
                  role="tab"
                  aria-selected={currentTab === 'attachments'}
                  type="button"
                  onClick={() => setCurrentTab('attachments')}
                  className={`px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
                    currentTab === 'attachments'
                      ? 'bg-light-surface-container-highest text-light-on-surface'
                      : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
                  }`}
                >
                  往来附件 (<span className="tabular-nums">{activeContact.attachments.length}</span>)
                </button>
                <button
                  role="tab"
                  aria-selected={currentTab === 'threads'}
                  type="button"
                  onClick={() => setCurrentTab('threads')}
                  className={`px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
                    currentTab === 'threads'
                      ? 'bg-light-surface-container-highest text-light-on-surface'
                      : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
                  }`}
                >
                  历史邮件 (<span className="tabular-nums">{activeContact.threads.length}</span>)
                </button>
              </div>

              <div className="flex items-center gap-gutter-md">
                {downloadToast && (
                  <span className="font-label text-label-sm text-light-secondary">
                    {downloadToast}
                  </span>
                )}
                <span className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums">
                  最近往来：{activeContact.lastActive}
                </span>
              </div>
            </div>

            {/* Attachments Panel */}
            {currentTab === 'attachments' ? (
              <div role="tabpanel" className="flex flex-col gap-gutter-sm flex-1 min-h-0 overflow-y-auto pr-1 linen-scroll">
                {activeContact.attachments.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-light-on-surface-variant gap-2 py-12">
                    <span className="material-symbols-outlined text-headline-md opacity-50" aria-hidden="true">
                      attach_file
                    </span>
                    <p className="font-body text-body-md">暂无与该联系人的往来附件</p>
                  </div>
                ) : (
                  activeContact.attachments.map((att, idx) => (
                    <div
                      key={`${att.name}-${idx}`}
                      className="group flex items-center justify-between gap-gutter-md p-gutter-md rounded-lg bg-light-surface-container-low/70 hover:bg-light-surface-container-low transition-colors duration-state-change"
                    >
                      <div className="flex items-center gap-gutter-md min-w-0">
                        <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-light-surface-container-lowest text-light-primary shrink-0">
                          <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                            {att.icon}
                          </span>
                        </span>
                        <div className="flex flex-col min-w-0">
                          <span className="font-title text-title-md text-light-on-surface truncate">
                            {att.name}
                          </span>
                          <div className="flex items-center gap-gutter-sm font-body text-body-sm text-light-on-surface-variant">
                            <span>{att.dir}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-mono-sm tabular-nums">{att.size}</span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">{att.date}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-gutter-xs shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenEmailInInbox(att.emailId)}
                          title="定位原邮件"
                          aria-label="定位原邮件"
                          className="w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                            open_in_new
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerDownload(att)}
                          title="下载附件"
                          aria-label="下载附件"
                          className="w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                            download
                          </span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* Threads Panel */
              <div role="tabpanel" className="flex flex-col gap-gutter-sm flex-1 min-h-0 overflow-y-auto pr-1 linen-scroll">
                {activeContact.threads.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-light-on-surface-variant gap-2 py-12">
                    <span className="material-symbols-outlined text-headline-md opacity-50" aria-hidden="true">
                      mail_outline
                    </span>
                    <p className="font-body text-body-md">
                      暂无往来邮件，写邮件时输入姓名或拼音首字母即可快速联想此人
                    </p>
                  </div>
                ) : (
                  activeContact.threads.map((t, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onOpenEmailInInbox(t.emailId)}
                      className="text-left flex flex-col gap-gutter-xs p-gutter-md rounded-lg bg-light-surface-container-low/70 hover:bg-light-surface-container-low transition-colors duration-state-change cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-gutter-md w-full">
                        <span className="font-title text-title-md text-light-on-surface truncate">
                          {cleanMailText(t.subject)}
                        </span>
                        <time className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums shrink-0">
                          {t.time}
                        </time>
                      </div>
                      <p className="font-body text-body-sm text-light-on-surface-variant truncate w-full">
                        {cleanMailText(t.snippet)}
                      </p>
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center text-light-on-surface-variant">
            <span className="material-symbols-outlined text-display-sm opacity-45" aria-hidden="true">
              badge
            </span>
            <h2 className="font-headline text-headline-md text-light-on-surface">
              同步企业通讯录，写信输入首字母即可联想
            </h2>
            <p className="font-body text-body-md max-w-md">
              支持通过 CardDAV 一键拉取企业微信 / 腾讯企业邮、网易企业邮等组织通讯录，也支持直接导入 Foxmail / 企业微信导出的 .vcf 或 .csv 通讯录文件。
            </p>
          </div>
        )}
      </article>

      {/* CardDAV Enterprise Contacts Sync Modal */}
      {cardDavOpen && (
        <div
          className="fixed inset-0 z-50 bg-light-on-surface/35 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setCardDavOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="同步企业通讯录（CardDAV）"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-light-surface-container-lowest rounded-2xl p-6 shadow-[0_24px_60px_-12px_rgba(35,25,20,0.22)] ring-1 ring-light-outline-variant/40 flex flex-col gap-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="font-headline text-headline-md text-light-on-surface">
                  同步企业通讯录（CardDAV）
                </h2>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  同步完成后，在写邮件收件人/抄送栏输入中文名或拼音首字母即可即时联想。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setCardDavOpen(false)}
                className="w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            {/* Provider Presets */}
            <div className="flex flex-wrap gap-1.5">
              {CARDDAV_PRESETS.map((preset) => {
                const active = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setSelectedPresetId(preset.id);
                      if (preset.serverUrl) {
                        setServerUrl(preset.serverUrl);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-full font-label text-label-sm transition-colors duration-state-change cursor-pointer ${
                      active
                        ? 'bg-light-primary text-light-on-primary'
                        : 'bg-light-surface-container-low text-light-on-surface-variant hover:bg-light-surface-container'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleCardDavSyncSubmit} className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1">
                <label className="font-label text-label-md text-light-on-surface">
                  CardDAV 服务器地址
                </label>
                <input
                  type="url"
                  required
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://dav.exmail.qq.com"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-light-surface-container-low border border-light-outline-variant/40 font-mono text-mono-sm text-light-on-surface focus:outline-none focus:ring-2 focus:ring-light-primary"
                />
                <span className="font-body text-body-sm text-light-on-surface-variant">
                  {activePreset.hint}
                </span>
              </div>

              <label className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-light-surface-container-low/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useDefaultAccount}
                  onChange={(e) => setUseDefaultAccount(e.target.checked)}
                  className="rounded border-light-outline-variant text-light-primary focus:ring-light-primary"
                />
                <span className="font-body text-body-sm text-light-on-surface">
                  自动复用当前邮箱账号与授权码
                  {defaultAccountEmail ? `（${defaultAccountEmail}）` : ''}
                </span>
              </label>

              {!useDefaultAccount && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="font-label text-label-sm text-light-on-surface">
                      邮箱 / 登录账号
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="name@company.com"
                      className="px-3 py-2 rounded-lg bg-light-surface-container-low border border-light-outline-variant/40 font-body text-body-sm text-light-on-surface focus:outline-none focus:ring-2 focus:ring-light-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-label text-label-sm text-light-on-surface">
                      客户端专用密码 / 授权码
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={hasStoredPassword ? '已加密保存，留空则沿用' : '输入授权码'}
                      className="px-3 py-2 rounded-lg bg-light-surface-container-low border border-light-outline-variant/40 font-body text-body-sm text-light-on-surface focus:outline-none focus:ring-2 focus:ring-light-primary"
                    />
                  </div>
                </div>
              )}

              {lastSyncInfo && (
                <p className="font-mono text-mono-sm text-light-on-surface-variant">{lastSyncInfo}</p>
              )}

              {cardDavError && (
                <div className="px-3.5 py-2.5 rounded-lg bg-light-error-container text-light-on-error-container font-body text-body-sm">
                  {cardDavError}
                </div>
              )}

              {cardDavSuccess && (
                <div className="px-3.5 py-2.5 rounded-lg bg-light-secondary-container text-light-on-secondary-container font-body text-body-sm">
                  {cardDavSuccess}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setCardDavOpen(false);
                    void handleImportFileClick();
                  }}
                  className="font-label text-label-md text-light-primary hover:underline cursor-pointer"
                >
                  改为导入本地 VCF / CSV
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCardDavOpen(false)}
                    className="px-4 py-2 rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md cursor-pointer"
                  >
                    关闭
                  </button>
                  <button
                    type="submit"
                    disabled={syncingCardDav}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container font-label text-label-md cursor-pointer disabled:opacity-60"
                  >
                    <span
                      className={`material-symbols-outlined text-title-sm ${
                        syncingCardDav ? 'animate-spin' : ''
                      }`}
                      aria-hidden="true"
                    >
                      sync
                    </span>
                    <span>{syncingCardDav ? '正在拉取...' : '立即同步'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import {
  ComposePrefill,
  EmailAttachment,
  EmailItem,
  InboxFilter,
  LlmProfile,
  MailFolder,
} from '../types/mail';
import { isSafeExternalUrl } from '../services/mailService';
import { translateEmailWithAi, TranslationResult } from '../utils/aiClient';

interface MainInboxViewProps {
  emails: EmailItem[];
  activeFolder: MailFolder;
  activeEmailId: string;
  searchQuery: string;
  tagFilter: string | null;
  activeLlm: LlmProfile;
  enableShortcuts: boolean;
  minimalReading: boolean;
  undoSeconds: number;
  userName: string;
  userEmail: string;
  syncing?: boolean;
  lastSyncText?: string;
  syncNotice?: string | null;
  onSyncNow?: () => void;
  onDownloadAttachment: (email: EmailItem, att: EmailAttachment) => Promise<string>;
  onSelectEmail: (id: string) => void;
  onClearTagFilter: () => void;
  onToggleStar: (id: string) => void;
  onToggleRead: (id: string) => void;
  onArchiveEmail: (id: string) => void;
  onDeleteEmail: (id: string) => void;
  onChangeTag: (id: string, tag: string) => void;
  onSendQuickReply: (toEmail: string, subject: string, body: string) => void;
  onForwardEmail: (prefill: ComposePrefill) => void;
}

const SMART_CATEGORIES = [
  '设计评审',
  '工程研发',
  '品牌合作',
  '财务票据',
  '精选订阅',
  '日程通知',
];

const FOLDER_TITLES: Record<MailFolder, string> = {
  inbox: '收件箱',
  sent: '已发送',
  archive: '归档',
};

function renderSafeParagraph(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>()]+|mailto:[^\s<>()]+)/g);
  if (parts.length === 1) return text;
  return parts.map((part, idx) => {
    if (isSafeExternalUrl(part)) {
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-light-primary underline decoration-light-primary/40 hover:decoration-light-primary break-all"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const MainInboxView: React.FC<MainInboxViewProps> = ({
  emails,
  activeFolder,
  activeEmailId,
  searchQuery,
  tagFilter,
  activeLlm,
  enableShortcuts,
  minimalReading,
  userName,
  userEmail,
  syncing = false,
  lastSyncText = '刚刚',
  syncNotice,
  onSyncNow,
  onDownloadAttachment,
  onSelectEmail,
  onClearTagFilter,
  onToggleStar,
  onToggleRead,
  onArchiveEmail,
  onDeleteEmail,
  onChangeTag,
  onSendQuickReply,
  onForwardEmail,
}) => {
  const [currentFilter, setCurrentFilter] = useState<InboxFilter>('all');
  const [quickReply, setQuickReply] = useState('');
  const [replyRecipientVisible, setReplyRecipientVisible] = useState(true);
  const [replyToast, setReplyToast] = useState<string | null>(null);
  const [readerNotice, setReaderNotice] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState<TranslationResult | null>(null);

  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    targetId: string;
  }>({ open: false, x: 0, y: 0, targetId: '' });

  const quickReplyRef = useRef<HTMLTextAreaElement>(null);

  // Compute emails in current folder
  const folderEmails = useMemo(() => {
    return emails.filter((e) => {
      if (activeFolder === 'inbox') return e.folder === 'inbox' && !e.archived;
      if (activeFolder === 'sent') return e.folder === 'sent' && !e.archived;
      return e.folder === 'archive' || !!e.archived;
    });
  }, [emails, activeFolder]);

  const filteredEmails = useMemo(() => {
    return folderEmails.filter((item) => {
      if (tagFilter && item.tag !== tagFilter) return false;
      if (currentFilter === 'unread' && !item.unread) return false;
      if (currentFilter === 'starred' && !item.starred) return false;
      if (currentFilter === 'attachment' && !item.attachment) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          item.sender.toLowerCase().includes(q) ||
          item.subject.toLowerCase().includes(q) ||
          item.preview.toLowerCase().includes(q) ||
          item.email.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [folderEmails, tagFilter, currentFilter, searchQuery]);

  const activeMail = useMemo(() => {
    return (
      filteredEmails.find((e) => e.id === activeEmailId) ||
      folderEmails.find((e) => e.id === activeEmailId) ||
      filteredEmails[0] ||
      folderEmails[0] ||
      null
    );
  }, [filteredEmails, folderEmails, activeEmailId]);

  const unreadCount = useMemo(
    () => folderEmails.filter((e) => e.unread).length,
    [folderEmails]
  );

  // Reset translation & recipient chip when switching email
  useEffect(() => {
    setTranslation(null);
    setReplyRecipientVisible(true);
    setSnoozeOpen(false);
  }, [activeMail?.id]);

  // Close context menu on global click or escape
  useEffect(() => {
    const handleGlobalClick = () => {
      setCtxMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCtxMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
        setSnoozeOpen(false);
      }
    };
    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, []);

  // Single-key shortcuts (J / K / E / S / R)
  useEffect(() => {
    if (!enableShortcuts) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (filteredEmails.length === 0) return;

      const key = e.key.toLowerCase();
      const idx = filteredEmails.findIndex((m) => m.id === activeMail?.id);

      if (key === 'j') {
        e.preventDefault();
        const nextIdx = idx < filteredEmails.length - 1 ? idx + 1 : 0;
        onSelectEmail(filteredEmails[nextIdx].id);
      } else if (key === 'k') {
        e.preventDefault();
        const prevIdx = idx > 0 ? idx - 1 : filteredEmails.length - 1;
        onSelectEmail(filteredEmails[prevIdx].id);
      } else if (key === 'e' && activeMail) {
        e.preventDefault();
        onArchiveEmail(activeMail.id);
      } else if (key === 's' && activeMail) {
        e.preventDefault();
        onToggleStar(activeMail.id);
      } else if (key === 'r' && activeMail) {
        e.preventDefault();
        quickReplyRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enableShortcuts,
    filteredEmails,
    activeMail,
    onSelectEmail,
    onArchiveEmail,
    onToggleStar,
  ]);

  const handleTranslate = async (mailOverride?: EmailItem) => {
    const targetMail = mailOverride || activeMail;
    if (!targetMail) return;

    if (!mailOverride && translation) {
      setTranslation(null);
      return;
    }

    setTranslating(true);
    const result = await translateEmailWithAi(targetMail, activeLlm);
    setTranslation(result);
    setTranslating(false);
  };

  const handleSendReply = () => {
    if (!activeMail || !quickReply.trim()) return;
    onSendQuickReply(activeMail.email, `回复：${activeMail.subject}`, quickReply.trim());
    setQuickReply('');
    setReplyToast('已发送回复');
    setTimeout(() => setReplyToast(null), 2600);
  };

  const handleAiSuggestReply = () => {
    if (!activeMail) return;
    setQuickReply(
      `${activeMail.sender.replace('我 → ', '')}，你好：\n\n来信已收到，内容很清晰，我这边已确认没有问题，可按当前计划推进。`
    );
    quickReplyRef.current?.focus();
  };

  const showNotice = (msg: string) => {
    setReaderNotice(msg);
    setTimeout(() => setReaderNotice(null), 2400);
  };

  const ctxTargetMail = emails.find((e) => e.id === ctxMenu.targetId);

  return (
    <main className="grid grid-cols-12 gap-gutter-xl flex-1 items-start">
      {/* Left Column: Unified Single-List Triage */}
      <section aria-label="邮件列表" className="col-span-12 lg:col-span-5 flex flex-col gap-gutter-md">
        {/* Triage Title & Filter Chips */}
        <div className="flex flex-col gap-gutter-md px-gutter-xs">
          <div className="flex items-center justify-between gap-gutter-sm">
            <div className="flex items-center gap-gutter-sm">
              <h1 className="font-headline text-headline-lg text-light-on-surface">
                {FOLDER_TITLES[activeFolder]}
              </h1>
              {tagFilter && (
                <button
                  type="button"
                  onClick={onClearTagFilter}
                  className="inline-flex items-center gap-gutter-xs px-gutter-sm py-0.5 rounded-full bg-light-secondary-container text-light-on-secondary-container font-label text-label-sm hover:opacity-90 cursor-pointer"
                >
                  <span>标签：{tagFilter}</span>
                  <span className="material-symbols-outlined text-body-sm" aria-hidden="true">
                    close
                  </span>
                </button>
              )}
            </div>
            <span className="font-label text-label-md text-light-on-surface-variant tabular-nums">
              共 {folderEmails.length} 封 · {unreadCount} 封未读
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-gutter-sm" role="group" aria-label="邮件筛选">
            {(
              [
                { id: 'all', label: '全部收件' },
                { id: 'unread', label: '未读' },
                { id: 'starred', label: '星标' },
                { id: 'attachment', label: '附件' },
              ] as { id: InboxFilter; label: string }[]
            ).map((chip) => {
              const selected = currentFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCurrentFilter(chip.id)}
                  className={`filter-chip inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full transition-colors duration-state-change ease-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer ${
                    selected
                      ? 'bg-light-surface-container-highest text-light-on-surface'
                      : 'bg-light-surface-container-low text-light-on-surface-variant hover:bg-light-surface-container'
                  }`}
                >
                  <span className="font-label text-label-md whitespace-nowrap">{chip.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Email Rows Container */}
        <ul className="flex flex-col gap-gutter-xs" role="listbox" aria-label="邮件列表">
          {filteredEmails.length === 0 ? (
            <li className="py-section px-gutter-lg text-center rounded-lg bg-light-surface-container-low/60 flex flex-col items-center gap-gutter-sm">
              <span
                className="material-symbols-outlined text-display-lg text-light-on-surface-variant"
                aria-hidden="true"
              >
                done_all
              </span>
              <p className="font-body text-body-md text-light-on-surface-variant">
                当前筛选下暂无邮件，享受片刻宁静
              </p>
            </li>
          ) : (
            filteredEmails.map((item) => {
              const isActive = item.id === activeMail?.id;
              return (
                <li
                  key={item.id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => onSelectEmail(item.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const menuW = 240;
                    const menuH = 340;
                    const x = Math.min(e.clientX, window.innerWidth - menuW - 12);
                    const y = Math.min(e.clientY, window.innerHeight - menuH - 12);
                    setCtxMenu({
                      open: true,
                      x: Math.max(12, x),
                      y: Math.max(12, y),
                      targetId: item.id,
                    });
                  }}
                  className={`email-row group relative flex items-start gap-gutter-md p-gutter-md rounded-lg cursor-pointer transition-colors duration-state-change ${
                    isActive
                      ? 'bg-light-surface-container-lowest shadow-[0_4px_16px_-4px_rgba(35,25,20,0.06)]'
                      : 'hover:bg-light-surface-container-low'
                  }`}
                >
                  <Avatar src={item.avatarImg} initials={item.initials} alt={item.sender} />
                  <div className="flex-1 min-w-0 flex flex-col gap-gutter-xs">
                    <div className="flex items-center justify-between gap-gutter-sm">
                      <div className="flex items-center gap-gutter-xs min-w-0">
                        {item.unread && (
                          <span
                            className="w-2 h-2 rounded-full bg-light-secondary shrink-0"
                            aria-label="未读"
                          />
                        )}
                        <span
                          className={`font-title text-title-md text-light-on-surface truncate ${
                            item.unread ? 'font-semibold' : ''
                          }`}
                        >
                          {item.sender}
                        </span>
                      </div>
                      <div className="flex items-center gap-gutter-xs shrink-0">
                        <time className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums group-hover:hidden">
                          {item.time}
                        </time>
                        <div className="hidden group-hover:flex items-center gap-gutter-xs">
                          <button
                            type="button"
                            aria-label="归档"
                            onClick={(e) => {
                              e.stopPropagation();
                              onArchiveEmail(item.id);
                            }}
                            className="w-7 h-7 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                              archive
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label="标星"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleStar(item.id);
                            }}
                            className={`w-7 h-7 rounded-full inline-flex items-center justify-center hover:bg-light-surface-container cursor-pointer ${
                              item.starred ? 'text-light-primary' : 'text-light-on-surface-variant'
                            }`}
                          >
                            <span
                              className={`material-symbols-outlined text-title-md ${
                                item.starred ? 'material-symbols-filled' : ''
                              }`}
                              aria-hidden="true"
                            >
                              star
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                    <p
                      className={`font-body text-body-md text-light-on-surface truncate ${
                        item.unread ? 'font-semibold' : 'font-medium'
                      }`}
                    >
                      {item.subject}
                    </p>
                    <div className="flex items-center justify-between gap-gutter-sm">
                      <p className="font-body text-body-sm text-light-on-surface-variant truncate">
                        {item.preview}
                      </p>
                      {item.attachment && (
                        <span
                          className="material-symbols-outlined text-body-md text-light-on-surface-variant shrink-0"
                          aria-label="含附件"
                        >
                          attach_file
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>

        {/* Keyboard Shortcut Legend */}
        <div className="flex items-center justify-between px-gutter-sm pt-gutter-sm text-light-on-surface-variant">
          <div className="flex items-center gap-gutter-md font-label text-label-sm">
            <span className="inline-flex items-center gap-gutter-xs">
              <kbd className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-light-surface-container-low text-light-on-surface-variant">
                J/K
              </kbd>{' '}
              切换
            </span>
            <span className="inline-flex items-center gap-gutter-xs">
              <kbd className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-light-surface-container-low text-light-on-surface-variant">
                E
              </kbd>{' '}
              归档
            </span>
            <span className="inline-flex items-center gap-gutter-xs">
              <kbd className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-light-surface-container-low text-light-on-surface-variant">
                R
              </kbd>{' '}
              回复
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSyncNow?.()}
            disabled={syncing}
            className="inline-flex items-center gap-1 font-label text-label-sm hover:text-light-on-surface transition-colors cursor-pointer"
          >
            <span
              className={`material-symbols-outlined text-body-md ${syncing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            >
              sync
            </span>
            <span>{syncing ? '正在同步...' : syncNotice || `已同步 · ${lastSyncText}`}</span>
          </button>
        </div>
      </section>

      {/* Right Column: Slide-over Editorial Reading Sheet */}
      <article
        aria-label="邮件阅读视图"
        className="col-span-12 lg:col-span-7 bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-lg min-h-[760px]"
      >
        {!activeMail ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-gutter-sm text-center py-section">
            <span className="material-symbols-outlined text-display-lg text-light-on-surface-variant">
              mark_email_read
            </span>
            <p className="font-body text-body-md text-light-on-surface-variant">
              选择左侧任意一封邮件开始阅读
            </p>
          </div>
        ) : (
          <>
            {/* Reader Top Toolbar */}
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex items-center gap-gutter-sm">
                <span className="inline-flex items-center px-gutter-md py-gutter-xs rounded-full bg-light-secondary-container text-light-on-secondary-container font-label text-label-md">
                  {activeMail.tag}
                </span>
                {readerNotice && (
                  <span className="font-label text-label-sm text-light-secondary">
                    {readerNotice}
                  </span>
                )}
              </div>

              <div className="relative flex items-center gap-gutter-xs">
                <button
                  type="button"
                  onClick={() => handleTranslate()}
                  disabled={translating}
                  className="inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-secondary-container hover:text-light-on-secondary-container font-label text-label-md transition-colors duration-state-change mr-gutter-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                    translate
                  </span>
                  <span>
                    {translating ? '正在翻译...' : translation ? '已翻译' : '翻译邮件'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onArchiveEmail(activeMail.id)}
                  aria-label="归档此邮件"
                  title="归档 (E)"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant transition-colors duration-state-change ease-state-change hover:bg-light-surface-container hover:text-light-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                    archive
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSnoozeOpen((o) => !o)}
                  aria-label="稍后提醒"
                  title="稍后提醒"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant transition-colors duration-state-change ease-state-change hover:bg-light-surface-container hover:text-light-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                    schedule
                  </span>
                </button>

                {snoozeOpen && (
                  <div className="absolute right-16 top-11 w-48 bg-light-surface-container-lowest rounded-xl p-gutter-xs shadow-[0_16px_40px_-8px_rgba(35,25,20,0.16)] ring-1 ring-light-outline-variant/40 flex flex-col gap-0.5 z-30">
                    <span className="px-gutter-sm py-1 font-label text-label-sm text-light-on-surface-variant">
                      稍后提醒时间
                    </span>
                    {['今天 16:00', '明早 09:00', '下周一 09:30'].map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => {
                          setSnoozeOpen(false);
                          showNotice(`已设提醒：${slot}`);
                        }}
                        className="text-left px-gutter-sm py-gutter-xs rounded-lg hover:bg-light-surface-container-low font-body text-body-sm text-light-on-surface cursor-pointer"
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onToggleStar(activeMail.id)}
                  aria-label="标星"
                  title="标星 (S)"
                  className={`inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors duration-state-change ease-state-change hover:bg-light-surface-container hover:text-light-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer ${
                    activeMail.starred ? 'text-light-primary' : 'text-light-on-surface-variant'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-title-lg ${
                      activeMail.starred ? 'material-symbols-filled' : ''
                    }`}
                    aria-hidden="true"
                  >
                    star
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onDeleteEmail(activeMail.id)}
                  aria-label="删除邮件"
                  title="删除"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant transition-colors duration-state-change ease-state-change hover:bg-light-error-container hover:text-light-on-error-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                    delete_outline
                  </span>
                </button>
              </div>
            </div>

            {/* Editorial Subject Line */}
            <h2 className="font-headline text-headline-lg text-light-on-surface text-balance">
              {activeMail.subject}
            </h2>

            {/* Sender Metadata */}
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex items-center gap-gutter-md">
                <Avatar
                  src={activeMail.avatarImg}
                  initials={activeMail.initials}
                  alt={activeMail.sender}
                />
                <div className="flex flex-col">
                  <div className="flex items-center gap-gutter-sm">
                    <span className="font-title text-title-md text-light-on-surface">
                      {activeMail.sender}
                    </span>
                    <span className="font-body text-body-sm text-light-on-surface-variant">
                      &lt;{activeMail.email}&gt;
                    </span>
                  </div>
                  <span className="font-body text-body-sm text-light-on-surface-variant">
                    {minimalReading
                      ? `发送至 我 · ${FOLDER_TITLES[activeFolder]}`
                      : `发送至 ${userName} <${userEmail}> · ${FOLDER_TITLES[activeFolder]} · TLS 已加密`}
                  </span>
                </div>
              </div>

              <time className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums">
                {activeMail.fullTime}
              </time>
            </div>

            <div className="h-px bg-light-surface-container-high" aria-hidden="true" />

            {/* Email Body (Safe text + validated external links only) */}
            <div className="max-w-prose font-body text-body-lg text-light-on-surface text-pretty flex flex-col gap-gutter-md flex-1">
              {activeMail.paragraphs.map((p, idx) => (
                <p key={idx}>{renderSafeParagraph(p)}</p>
              ))}
              {activeMail.signoff && (
                <p className="text-light-on-surface-variant whitespace-pre-line">
                  {activeMail.signoff}
                </p>
              )}
            </div>

            {/* AI Translation Panel */}
            {translation && (
              <div className="flex flex-col gap-gutter-sm rounded-lg bg-light-surface-container-low p-gutter-md">
                <div className="flex items-center justify-between gap-gutter-sm">
                  <div className="flex items-center gap-gutter-xs">
                    <span
                      className="material-symbols-outlined text-title-md text-light-secondary"
                      aria-hidden="true"
                    >
                      translate
                    </span>
                    <span className="font-label text-label-md text-light-on-surface">
                      AI 译文（English）
                    </span>
                    <span className="font-mono text-mono-sm px-gutter-sm py-0.5 rounded-full bg-light-secondary-container text-light-on-secondary-container">
                      {translation.model}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTranslation(null)}
                    className="font-label text-label-sm text-light-on-surface-variant hover:text-light-on-surface px-gutter-sm py-0.5 rounded-full hover:bg-light-surface-container transition-colors duration-state-change cursor-pointer"
                  >
                    收起译文
                  </button>
                </div>
                <p className="font-title text-title-md text-light-on-surface">
                  {translation.subject}
                </p>
                <div className="font-body text-body-md text-light-on-surface-variant flex flex-col gap-gutter-xs leading-relaxed">
                  {translation.paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Attachment Pills (Real Tauri Save As / Browser Download) */}
            {((activeMail.attachments && activeMail.attachments.length > 0) ||
              activeMail.attachment) && (
              <div className="flex flex-wrap items-center gap-gutter-sm">
                {(activeMail.attachments && activeMail.attachments.length > 0
                  ? activeMail.attachments
                  : activeMail.attachment
                  ? [activeMail.attachment]
                  : []
                ).map((att, attIdx) => (
                  <button
                    key={att.id || `${att.name}-${attIdx}`}
                    type="button"
                    onClick={async () => {
                      const msg = await onDownloadAttachment(activeMail, att);
                      showNotice(msg);
                    }}
                    className="inline-flex items-center gap-gutter-sm px-gutter-md py-gutter-sm rounded-md bg-light-surface-container-low hover:bg-light-surface-container transition-colors duration-state-change text-light-on-surface cursor-pointer text-left"
                  >
                    <span
                      className="material-symbols-outlined text-title-lg text-light-primary"
                      aria-hidden="true"
                    >
                      description
                    </span>
                    <div className="flex flex-col">
                      <span className="font-label text-label-md text-light-on-surface">
                        {att.name}
                      </span>
                      <span className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums">
                        {att.size}
                      </span>
                    </div>
                    <span
                      className="material-symbols-outlined text-title-md text-light-on-surface-variant ml-gutter-sm"
                      aria-hidden="true"
                    >
                      download
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Inline Quick Reply Composer */}
            <div className="bg-light-surface-container-low rounded-lg p-gutter-md flex flex-col gap-gutter-sm mt-auto">
              <div className="flex items-center justify-between gap-gutter-sm">
                <div className="flex items-center gap-gutter-sm">
                  <span className="font-label text-label-md text-light-on-surface-variant">
                    回复
                  </span>
                  {replyRecipientVisible ? (
                    <span className="inline-flex items-center gap-gutter-xs pl-gutter-md pr-gutter-xs py-gutter-xs rounded-full bg-light-secondary-container text-light-on-secondary-container">
                      <span className="font-label text-label-md">{activeMail.email}</span>
                      <button
                        type="button"
                        aria-label="移除收件人"
                        onClick={() => setReplyRecipientVisible(false)}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full hover:bg-light-surface-container-lowest transition-colors duration-state-change cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-body-sm" aria-hidden="true">
                          close
                        </span>
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReplyRecipientVisible(true)}
                      className="font-label text-label-sm text-light-primary hover:underline cursor-pointer"
                    >
                      + 恢复收件人
                    </button>
                  )}
                </div>
                {replyToast && (
                  <span className="font-label text-label-md text-light-secondary">{replyToast}</span>
                )}
              </div>

              <textarea
                ref={quickReplyRef}
                rows={2}
                value={quickReply}
                onChange={(e) => setQuickReply(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSendReply();
                  }
                }}
                placeholder="输入回复内容，按 ⌘ + Enter 快速发送..."
                className="w-full bg-transparent border-0 p-0 font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-0 focus:outline-none resize-none"
              />

              <div className="flex items-center justify-between pt-gutter-xs">
                <div className="flex items-center gap-gutter-xs">
                  <button
                    type="button"
                    aria-label="展开完整写信页面"
                    title="在完整信纸中回复"
                    onClick={() =>
                      onForwardEmail({
                        recipients: [activeMail.email],
                        subject: `回复：${activeMail.subject}`,
                        body: quickReply,
                      })
                    }
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full text-light-on-surface-variant hover:bg-light-surface-container transition-colors duration-state-change cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                      attach_file
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="AI 智能拟定回复"
                    title="AI 一键拟定回复"
                    onClick={handleAiSuggestReply}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full text-light-on-surface-variant hover:bg-light-surface-container transition-colors duration-state-change cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                      auto_awesome
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSendReply}
                  className="inline-flex items-center justify-center px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary transition-colors duration-state-change ease-state-change hover:bg-light-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-2 cursor-pointer"
                >
                  <span className="font-label text-label-lg">发送回复</span>
                </button>
              </div>
            </div>
          </>
        )}
      </article>

      {/* Email Right-Click Context Menu */}
      {ctxMenu.open && ctxTargetMail && (
        <div
          role="menu"
          aria-label="邮件右键操作列表"
          onClick={(e) => e.stopPropagation()}
          style={{ top: `${ctxMenu.y}px`, left: `${ctxMenu.x}px` }}
          className="fixed z-40 w-60 bg-light-surface-container-lowest rounded-xl p-gutter-xs shadow-[0_16px_40px_-8px_rgba(35,25,20,0.18)] ring-1 ring-light-outline-variant/40 flex flex-col gap-0.5"
        >
          <div className="px-gutter-sm py-1 flex items-center justify-between">
            <span className="font-label text-label-sm text-light-on-surface-variant truncate">
              {ctxTargetMail.sender} · 快捷操作
            </span>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSelectEmail(ctxTargetMail.id);
              setCtxMenu((p) => ({ ...p, open: false }));
              setTimeout(() => quickReplyRef.current?.focus(), 50);
            }}
            className="w-full flex items-center justify-between gap-gutter-sm px-gutter-sm py-gutter-xs rounded-lg text-light-on-surface hover:bg-light-surface-container-low font-body text-body-md transition-colors duration-state-change cursor-pointer"
          >
            <span className="flex items-center gap-gutter-sm">
              <span
                className="material-symbols-outlined text-title-md text-light-on-surface-variant"
                aria-hidden="true"
              >
                reply
              </span>
              <span>回复邮件</span>
            </span>
            <kbd className="font-mono text-mono-sm text-light-on-surface-variant">R</kbd>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setCtxMenu((p) => ({ ...p, open: false }));
              onForwardEmail({
                recipients: [],
                subject: `转发：${ctxTargetMail.subject}`,
                body: `\n\n--- 转发邮件 ---\n发件人：${ctxTargetMail.sender} <${ctxTargetMail.email}>\n时间：${ctxTargetMail.fullTime}\n\n${ctxTargetMail.paragraphs.join('\n\n')}`,
                attachment: ctxTargetMail.attachment,
              });
            }}
            className="w-full flex items-center justify-between gap-gutter-sm px-gutter-sm py-gutter-xs rounded-lg text-light-on-surface hover:bg-light-surface-container-low font-body text-body-md transition-colors duration-state-change cursor-pointer"
          >
            <span className="flex items-center gap-gutter-sm">
              <span
                className="material-symbols-outlined text-title-md text-light-on-surface-variant"
                aria-hidden="true"
              >
                forward
              </span>
              <span>转发</span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onToggleRead(ctxTargetMail.id);
              setCtxMenu((p) => ({ ...p, open: false }));
            }}
            className="w-full flex items-center justify-between gap-gutter-sm px-gutter-sm py-gutter-xs rounded-lg text-light-on-surface hover:bg-light-surface-container-low font-body text-body-md transition-colors duration-state-change cursor-pointer"
          >
            <span className="flex items-center gap-gutter-sm">
              <span
                className="material-symbols-outlined text-title-md text-light-on-surface-variant"
                aria-hidden="true"
              >
                mark_email_read
              </span>
              <span>{ctxTargetMail.unread ? '标记为已读' : '标记为未读'}</span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onToggleStar(ctxTargetMail.id);
              setCtxMenu((p) => ({ ...p, open: false }));
            }}
            className="w-full flex items-center justify-between gap-gutter-sm px-gutter-sm py-gutter-xs rounded-lg text-light-on-surface hover:bg-light-surface-container-low font-body text-body-md transition-colors duration-state-change cursor-pointer"
          >
            <span className="flex items-center gap-gutter-sm">
              <span
                className="material-symbols-outlined text-title-md text-light-primary material-symbols-filled"
                aria-hidden="true"
              >
                star
              </span>
              <span>{ctxTargetMail.starred ? '取消星标' : '添加星标'}</span>
            </span>
            <kbd className="font-mono text-mono-sm text-light-on-surface-variant">S</kbd>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSelectEmail(ctxTargetMail.id);
              setCtxMenu((p) => ({ ...p, open: false }));
              handleTranslate(ctxTargetMail);
            }}
            className="w-full flex items-center justify-between gap-gutter-sm px-gutter-sm py-gutter-xs rounded-lg text-light-on-surface hover:bg-light-surface-container-low font-body text-body-md transition-colors duration-state-change cursor-pointer"
          >
            <span className="flex items-center gap-gutter-sm">
              <span
                className="material-symbols-outlined text-title-md text-light-secondary"
                aria-hidden="true"
              >
                translate
              </span>
              <span>AI 翻译邮件</span>
            </span>
          </button>

          <div className="relative group/move">
            <button
              type="button"
              aria-haspopup="menu"
              className="w-full flex items-center justify-between gap-gutter-sm px-gutter-sm py-gutter-xs rounded-lg text-light-on-surface hover:bg-light-surface-container-low font-body text-body-md transition-colors duration-state-change cursor-pointer"
            >
              <span className="flex items-center gap-gutter-sm">
                <span
                  className="material-symbols-outlined text-title-md text-light-primary"
                  aria-hidden="true"
                >
                  drive_file_move
                </span>
                <span>移动到智能分类</span>
              </span>
              <span
                className="material-symbols-outlined text-title-md text-light-on-surface-variant"
                aria-hidden="true"
              >
                chevron_right
              </span>
            </button>

            <div
              role="menu"
              aria-label="选择目标智能分类"
              className="hidden group-hover/move:flex absolute left-full top-0 ml-1.5 w-48 bg-light-surface-container-lowest rounded-xl p-gutter-xs shadow-[0_16px_40px_-8px_rgba(35,25,20,0.18)] ring-1 ring-light-outline-variant/40 flex-col gap-0.5 z-50"
            >
              {SMART_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onChangeTag(ctxTargetMail.id, cat);
                    setCtxMenu((p) => ({ ...p, open: false }));
                  }}
                  className="w-full flex items-center justify-between px-gutter-sm py-gutter-xs rounded-lg text-light-on-surface hover:bg-light-surface-container-low font-body text-body-md transition-colors duration-state-change cursor-pointer"
                >
                  <span>{cat}</span>
                  {ctxTargetMail.tag === cat && (
                    <span
                      className="material-symbols-outlined text-title-md text-light-secondary"
                      aria-hidden="true"
                    >
                      check
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-light-surface-container-high my-1" aria-hidden="true" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onArchiveEmail(ctxTargetMail.id);
              setCtxMenu((p) => ({ ...p, open: false }));
            }}
            className="w-full flex items-center justify-between gap-gutter-sm px-gutter-sm py-gutter-xs rounded-lg text-light-on-surface hover:bg-light-surface-container-low font-body text-body-md transition-colors duration-state-change cursor-pointer"
          >
            <span className="flex items-center gap-gutter-sm">
              <span
                className="material-symbols-outlined text-title-md text-light-on-surface-variant"
                aria-hidden="true"
              >
                archive
              </span>
              <span>归档</span>
            </span>
            <kbd className="font-mono text-mono-sm text-light-on-surface-variant">E</kbd>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDeleteEmail(ctxTargetMail.id);
              setCtxMenu((p) => ({ ...p, open: false }));
            }}
            className="w-full flex items-center justify-between gap-gutter-sm px-gutter-sm py-gutter-xs rounded-lg text-light-error hover:bg-light-error-container hover:text-light-on-error-container font-body text-body-md transition-colors duration-state-change cursor-pointer"
          >
            <span className="flex items-center gap-gutter-sm">
              <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                delete_outline
              </span>
              <span>删除邮件</span>
            </span>
          </button>
        </div>
      )}
    </main>
  );
};

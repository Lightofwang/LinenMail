import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImapFolderItem, MailFolder } from '../types/mail';

interface MailFolderStripProps {
  activeFolder: MailFolder;
  isDraftsActive: boolean;
  inboxUnreadCount: number;
  draftCount: number;
  imapFolders: ImapFolderItem[];
  refreshingFolders?: boolean;
  onSelectFolder: (folder: MailFolder) => void;
  onSelectDrafts: () => void;
  onSelectImapFolder: (folder: ImapFolderItem) => void;
  onRefreshFolders?: () => void;
  onCreateFolder?: (folderName: string) => Promise<void>;
}

export const MailFolderStrip: React.FC<MailFolderStripProps> = ({
  activeFolder,
  isDraftsActive,
  inboxUnreadCount,
  draftCount,
  imapFolders,
  refreshingFolders = false,
  onSelectFolder,
  onSelectDrafts,
  onSelectImapFolder,
  onRefreshFolders,
  onCreateFolder,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const customFolders = useMemo(
    () => imapFolders.filter((f) => f.kind === 'custom'),
    [imapFolders]
  );

  const otherServerFolders = useMemo(
    () => imapFolders.filter((f) => f.kind !== 'custom'),
    [imapFolders]
  );

  const orderedImapFolders = useMemo(
    () => [...customFolders, ...otherServerFolders],
    [customFolders, otherServerFolders]
  );

  const hasMultipleAccounts = useMemo(() => {
    const set = new Set(imapFolders.map((f) => f.accountId));
    return set.size > 1;
  }, [imapFolders]);

  // Smoothly scroll active folder tab into view when changed externally
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>('[aria-current="page"]');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
  }, [activeFolder, isDraftsActive]);

  useEffect(() => {
    if (!createOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) {
        setCreateOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [createOpen, creating]);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
    }
  };

  const openCreateModal = () => {
    setNewFolderName('');
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleConfirmCreate = async () => {
    if (!onCreateFolder || creating) return;
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setCreateError('请输入文件夹名称');
      return;
    }
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      setCreateError('文件夹名称不能包含斜杠 / 或 \\');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await onCreateFolder(trimmed);
      setCreateOpen(false);
      setNewFolderName('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const tabBase =
    'shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-2.5 py-2 border-b-2 font-label text-label-md transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary rounded-t-md cursor-pointer';
  const tabActive = 'border-light-primary text-light-on-surface font-semibold';
  const tabIdle =
    'border-transparent text-light-on-surface-variant hover:text-light-on-surface hover:border-light-outline-variant/60';

  const isCoreActive = (key: 'inbox' | 'sent' | 'archive') =>
    !isDraftsActive && activeFolder === key;

  return (
    <>
      <div className="shrink-0 flex items-center gap-0.5 border-b border-light-outline-variant/30">
        <nav
          ref={scrollRef}
          onWheel={handleWheel}
          aria-label="邮箱文件夹切换"
          className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto linen-scroll-x"
        >
          <button
            type="button"
            onClick={() => onSelectFolder('inbox')}
            aria-current={isCoreActive('inbox') ? 'page' : undefined}
            className={`${tabBase} ${isCoreActive('inbox') ? tabActive : tabIdle}`}
          >
            <span>收件箱</span>
            {inboxUnreadCount > 0 && (
              <span className="font-mono text-mono-sm tabular-nums text-light-secondary">
                {inboxUnreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectFolder('sent')}
            aria-current={isCoreActive('sent') ? 'page' : undefined}
            className={`${tabBase} ${isCoreActive('sent') ? tabActive : tabIdle}`}
          >
            <span>已发送</span>
          </button>

          <button
            type="button"
            onClick={onSelectDrafts}
            aria-current={isDraftsActive ? 'page' : undefined}
            className={`${tabBase} ${isDraftsActive ? tabActive : tabIdle}`}
          >
            <span>草稿箱</span>
            {draftCount > 0 && (
              <span className="font-mono text-mono-sm tabular-nums text-light-primary">
                {draftCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectFolder('archive')}
            aria-current={isCoreActive('archive') ? 'page' : undefined}
            className={`${tabBase} ${isCoreActive('archive') ? tabActive : tabIdle}`}
          >
            <span>归档</span>
          </button>

          {orderedImapFolders.length > 0 && (
            <span
              className="mx-1 h-3.5 w-px bg-light-outline-variant/45 shrink-0"
              aria-hidden="true"
            />
          )}

          {orderedImapFolders.map((folder) => {
            const selected = !isDraftsActive && activeFolder === folder.folderKey;
            const badgeCount =
              folder.unreadCount > 0 ? folder.unreadCount : folder.emailCount > 0 ? folder.emailCount : 0;
            const tooltip =
              hasMultipleAccounts && folder.accountEmail
                ? `${folder.displayName} · ${folder.accountEmail}`
                : folder.displayName;
            return (
              <button
                key={folder.id}
                type="button"
                title={tooltip}
                onClick={() => onSelectImapFolder(folder)}
                aria-current={selected ? 'page' : undefined}
                className={`${tabBase} ${selected ? tabActive : tabIdle}`}
              >
                <span className="max-w-[116px] truncate">{folder.displayName}</span>
                {badgeCount > 0 && (
                  <span
                    className={`font-mono text-mono-sm tabular-nums ${
                      folder.unreadCount > 0
                        ? 'text-light-secondary'
                        : 'text-light-on-surface-variant'
                    }`}
                  >
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 flex items-center gap-0.5 pl-1 mb-0.5">
          {onCreateFolder && (
            <button
              type="button"
              onClick={openCreateModal}
              aria-label="新建邮箱文件夹"
              title="新建邮箱文件夹（同步到邮箱服务器）"
              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-light-on-surface-variant hover:bg-light-surface-container-low hover:text-light-primary transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
            >
              <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                create_new_folder
              </span>
            </button>
          )}

          {onRefreshFolders && (
            <button
              type="button"
              disabled={refreshingFolders}
              onClick={onRefreshFolders}
              aria-label="刷新邮箱服务器文件夹"
              title={refreshingFolders ? '正在拉取服务器文件夹...' : '从邮箱服务器刷新文件夹列表'}
              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-light-on-surface-variant hover:bg-light-surface-container-low hover:text-light-on-surface transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer disabled:opacity-50"
            >
              <span
                className={`material-symbols-outlined text-title-md ${
                  refreshingFolders ? 'animate-spin' : ''
                }`}
                aria-hidden="true"
              >
                refresh
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Create IMAP Folder Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-light-scrim/35 p-gutter-lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-folder-modal-title"
          onClick={() => {
            if (!creating) setCreateOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_24px_60px_-12px_rgba(35,25,20,0.2)] flex flex-col gap-gutter-md"
          >
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-0.5">
                <h2
                  id="create-folder-modal-title"
                  className="font-headline text-headline-md text-light-on-surface"
                >
                  新建邮箱文件夹
                </h2>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  将在当前默认邮箱服务器同步创建文件夹，支持中文名称。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭弹窗"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full text-light-on-surface-variant hover:bg-light-surface-container cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            <label className="flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">
                文件夹名称
              </span>
              <input
                ref={inputRef}
                type="text"
                value={newFolderName}
                disabled={creating}
                onChange={(e) => {
                  setNewFolderName(e.target.value);
                  if (createError) setCreateError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleConfirmCreate();
                  }
                }}
                placeholder="例如：项目归档、财务发票、重要客户"
                className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-1 focus:ring-light-primary focus:outline-none disabled:opacity-60"
              />
            </label>

            {createError && (
              <p className="font-body text-body-sm text-light-error" role="alert">
                {createError}
              </p>
            )}

            <div className="flex items-center justify-end gap-gutter-sm pt-gutter-xs">
              <button
                type="button"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
                className="px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors cursor-pointer disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={creating || !newFolderName.trim()}
                onClick={() => void handleConfirmCreate()}
                className="inline-flex items-center gap-gutter-xs px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container font-label text-label-md transition-colors cursor-pointer disabled:opacity-50"
              >
                {creating && (
                  <span className="material-symbols-outlined text-body-md animate-spin" aria-hidden="true">
                    progress_activity
                  </span>
                )}
                <span>{creating ? '正在创建...' : '创建文件夹'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

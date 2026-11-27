import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppRoute, ImapFolderItem, MailFolder } from '../types/mail';

interface AppHeaderProps {
  activeRoute: AppRoute;
  activeFolder: MailFolder;
  unreadCount: number;
  draftCount?: number;
  imapFolders?: ImapFolderItem[];
  refreshingFolders?: boolean;
  searchQuery: string;
  searchPlaceholder: string;
  userInitial: string;
  userName: string;
  userEmail: string;
  syncing?: boolean;
  lastSyncText?: string;
  onSyncNow?: () => void;
  onRefreshFolders?: () => void;
  onSelectFolder: (folder: MailFolder) => void;
  onSelectImapFolder?: (folder: ImapFolderItem) => void;
  onNavigate: (route: AppRoute) => void;
  onSearchChange: (q: string) => void;
  onCompose: () => void;
}

function getImapFolderIcon(kind: string): string {
  switch (kind) {
    case 'sent':
      return 'send';
    case 'drafts':
      return 'drafts';
    case 'junk':
      return 'report';
    case 'trash':
      return 'delete_outline';
    case 'archive':
      return 'inventory_2';
    default:
      return 'folder';
  }
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeRoute,
  activeFolder,
  unreadCount,
  draftCount = 0,
  imapFolders = [],
  refreshingFolders = false,
  searchQuery,
  searchPlaceholder,
  userInitial,
  userName,
  userEmail,
  syncing = false,
  lastSyncText = '刚刚',
  onSyncNow,
  onRefreshFolders,
  onSelectFolder,
  onSelectImapFolder,
  onNavigate,
  onSearchChange,
  onCompose,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        setFolderMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!folderMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [folderMenuOpen]);

  const isFolderActive = (folder: MailFolder) =>
    activeRoute === 'inbox' && activeFolder === folder;

  const activeImapFolder = useMemo(
    () =>
      activeRoute === 'inbox' && activeFolder.startsWith('imap:')
        ? imapFolders.find((f) => f.folderKey === activeFolder) || null
        : null,
    [activeRoute, activeFolder, imapFolders]
  );

  const customFolders = useMemo(
    () => imapFolders.filter((f) => f.kind === 'custom'),
    [imapFolders]
  );

  const systemFolders = useMemo(
    () => imapFolders.filter((f) => f.kind !== 'custom'),
    [imapFolders]
  );

  const hasMultipleAccounts = useMemo(() => {
    const set = new Set(imapFolders.map((f) => f.accountId));
    return set.size > 1;
  }, [imapFolders]);

  return (
    <header className="shrink-0 w-full bg-light-surface-container-lowest rounded-xl px-6 py-3 shadow-[0_8px_28px_-6px_rgba(35,25,20,0.06)] flex items-center justify-between gap-4 z-30">
      <div className="flex items-center gap-gutter-md min-w-0">
        {/* Brand Mark */}
        <button
          type="button"
          onClick={() => onSelectFolder('inbox')}
          className="flex items-center gap-gutter-sm text-light-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary rounded-md px-gutter-xs shrink-0 cursor-pointer"
        >
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-light-primary text-light-on-primary">
            <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
              mail
            </span>
          </span>
          <span className="font-headline text-title-lg text-light-on-surface tracking-tight whitespace-nowrap">
            素笺
          </span>
        </button>

        <span className="h-5 w-px bg-light-outline-variant/50 shrink-0" aria-hidden="true" />

        {/* Folder Switcher Pills */}
        <nav aria-label="邮件文件夹" className="flex items-center gap-gutter-xs shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => onSelectFolder('inbox')}
            aria-current={isFolderActive('inbox') ? 'page' : undefined}
            className={`folder-tab shrink-0 whitespace-nowrap inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
              isFolderActive('inbox')
                ? 'bg-light-surface-container-highest text-light-on-surface'
                : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
            }`}
          >
            <span>收件箱</span>
            {unreadCount > 0 && (
              <span className="font-mono text-mono-sm tabular-nums text-light-secondary">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectFolder('sent')}
            aria-current={isFolderActive('sent') ? 'page' : undefined}
            className={`folder-tab shrink-0 whitespace-nowrap inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
              isFolderActive('sent')
                ? 'bg-light-surface-container-highest text-light-on-surface'
                : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
            }`}
          >
            <span>已发送</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('drafts')}
            aria-current={activeRoute === 'drafts' ? 'page' : undefined}
            className={`folder-tab shrink-0 whitespace-nowrap inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
              activeRoute === 'drafts'
                ? 'bg-light-surface-container-highest text-light-on-surface'
                : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
            }`}
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
            aria-current={isFolderActive('archive') ? 'page' : undefined}
            className={`folder-tab shrink-0 whitespace-nowrap inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
              isFolderActive('archive')
                ? 'bg-light-surface-container-highest text-light-on-surface'
                : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
            }`}
          >
            <span>归档</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('smart-folders')}
            aria-current={activeRoute === 'smart-folders' ? 'page' : undefined}
            className={`folder-tab shrink-0 whitespace-nowrap inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
              activeRoute === 'smart-folders'
                ? 'bg-light-surface-container-highest text-light-on-surface'
                : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
            }`}
          >
            <span>智能分类</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('contacts')}
            aria-current={activeRoute === 'contacts' ? 'page' : undefined}
            className={`folder-tab shrink-0 whitespace-nowrap inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
              activeRoute === 'contacts'
                ? 'bg-light-surface-container-highest text-light-on-surface'
                : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
            }`}
          >
            <span>联系人</span>
          </button>
        </nav>

        {/* IMAP Custom Folders Dropdown (kept outside overflow-x-auto nav so popover is never clipped) */}
        <div ref={folderMenuRef} className="relative shrink-0">
          <button
            type="button"
            aria-expanded={folderMenuOpen}
            aria-haspopup="menu"
            onClick={() => setFolderMenuOpen((prev) => !prev)}
            className={`folder-tab shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
              activeImapFolder || folderMenuOpen
                ? 'bg-light-surface-container-highest text-light-on-surface'
                : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
            }`}
          >
            <span className="material-symbols-outlined text-title-md" aria-hidden="true">
              {activeImapFolder ? getImapFolderIcon(activeImapFolder.kind) : 'folder_open'}
            </span>
            <span className="max-w-[120px] truncate">
              {activeImapFolder ? activeImapFolder.displayName : '文件夹'}
            </span>
            {customFolders.length > 0 && !activeImapFolder && (
              <span className="font-mono text-mono-sm tabular-nums text-light-on-surface-variant">
                {customFolders.length}
              </span>
            )}
            <span
              className={`material-symbols-outlined text-body-md transition-transform duration-150 ${
                folderMenuOpen ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            >
              expand_more
            </span>
          </button>

          {folderMenuOpen && (
            <div
              role="menu"
              aria-label="邮箱服务器文件夹"
              className="absolute left-0 top-full mt-2 w-72 max-h-[70vh] overflow-y-auto linen-scroll bg-light-surface-container-lowest rounded-xl p-2 shadow-[0_16px_40px_-8px_rgba(35,25,20,0.18)] ring-1 ring-light-outline-variant/40 z-50 flex flex-col gap-1"
            >
              <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-light-outline-variant/25">
                <span className="font-label text-label-sm text-light-on-surface-variant">
                  邮箱文件夹
                </span>
                {onRefreshFolders && (
                  <button
                    type="button"
                    disabled={refreshingFolders}
                    onClick={() => onRefreshFolders()}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-sm font-label text-light-primary hover:bg-light-surface-container-low transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <span
                      className={`material-symbols-outlined text-body-md ${
                        refreshingFolders ? 'animate-spin' : ''
                      }`}
                      aria-hidden="true"
                    >
                      refresh
                    </span>
                    <span>{refreshingFolders ? '刷新中' : '刷新'}</span>
                  </button>
                )}
              </div>

              {imapFolders.length === 0 ? (
                <div className="px-3 py-5 text-center flex flex-col items-center gap-2">
                  <span
                    className="material-symbols-outlined text-headline-md text-light-on-surface-variant/70"
                    aria-hidden="true"
                  >
                    folder_off
                  </span>
                  <p className="font-body text-body-sm text-light-on-surface-variant leading-relaxed">
                    暂未获取到邮箱文件夹，点击右上角「刷新」或同步邮箱后将自动拉取您创建的文件夹。
                  </p>
                </div>
              ) : (
                <>
                  {customFolders.length > 0 && (
                    <div className="flex flex-col gap-0.5 pt-1">
                      <span className="px-2.5 py-1 font-label text-label-sm text-light-on-surface-variant/80">
                        我创建的文件夹
                      </span>
                      {customFolders.map((folder) => {
                        const selected = activeImapFolder?.folderKey === folder.folderKey;
                        return (
                          <button
                            key={folder.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setFolderMenuOpen(false);
                              onSelectImapFolder?.(folder);
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                              selected
                                ? 'bg-light-surface-container-highest text-light-on-surface'
                                : 'text-light-on-surface hover:bg-light-surface-container-low'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span
                                className={`material-symbols-outlined text-title-md shrink-0 ${
                                  selected ? 'text-light-primary' : 'text-light-on-surface-variant'
                                }`}
                                aria-hidden="true"
                              >
                                folder
                              </span>
                              <span className="flex flex-col min-w-0">
                                <span className="font-body text-body-md truncate">
                                  {folder.displayName}
                                </span>
                                {hasMultipleAccounts && folder.accountEmail && (
                                  <span className="font-mono text-mono-sm text-light-on-surface-variant truncate">
                                    {folder.accountEmail}
                                  </span>
                                )}
                              </span>
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              {folder.unreadCount > 0 ? (
                                <span className="font-mono text-mono-sm tabular-nums text-light-secondary">
                                  {folder.unreadCount}
                                </span>
                              ) : folder.emailCount > 0 ? (
                                <span className="font-mono text-mono-sm tabular-nums text-light-on-surface-variant">
                                  {folder.emailCount}
                                </span>
                              ) : (
                                <span className="font-label text-label-sm text-light-on-surface-variant/70">
                                  未同步
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {systemFolders.length > 0 && (
                    <div
                      className={`flex flex-col gap-0.5 ${
                        customFolders.length > 0
                          ? 'mt-1 pt-1.5 border-t border-light-outline-variant/25'
                          : 'pt-1'
                      }`}
                    >
                      <span className="px-2.5 py-1 font-label text-label-sm text-light-on-surface-variant/80">
                        其他服务器文件夹
                      </span>
                      {systemFolders.map((folder) => {
                        const selected = activeImapFolder?.folderKey === folder.folderKey;
                        return (
                          <button
                            key={folder.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setFolderMenuOpen(false);
                              onSelectImapFolder?.(folder);
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                              selected
                                ? 'bg-light-surface-container-highest text-light-on-surface'
                                : 'text-light-on-surface hover:bg-light-surface-container-low'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span
                                className={`material-symbols-outlined text-title-md shrink-0 ${
                                  selected ? 'text-light-primary' : 'text-light-on-surface-variant'
                                }`}
                                aria-hidden="true"
                              >
                                {getImapFolderIcon(folder.kind)}
                              </span>
                              <span className="flex flex-col min-w-0">
                                <span className="font-body text-body-md truncate">
                                  {folder.displayName}
                                </span>
                                {hasMultipleAccounts && folder.accountEmail && (
                                  <span className="font-mono text-mono-sm text-light-on-surface-variant truncate">
                                    {folder.accountEmail}
                                  </span>
                                )}
                              </span>
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              {folder.unreadCount > 0 ? (
                                <span className="font-mono text-mono-sm tabular-nums text-light-secondary">
                                  {folder.unreadCount}
                                </span>
                              ) : folder.emailCount > 0 ? (
                                <span className="font-mono text-mono-sm tabular-nums text-light-on-surface-variant">
                                  {folder.emailCount}
                                </span>
                              ) : (
                                <span className="font-label text-label-sm text-light-on-surface-variant/70">
                                  点击查看
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Command Searchbar */}
      <form
        role="search"
        onSubmit={(e) => e.preventDefault()}
        className="hidden md:flex items-center gap-gutter-sm flex-1 max-w-md min-w-[240px] px-gutter-md py-2 rounded-full bg-light-surface-container-low text-light-on-surface transition-colors duration-state-change focus-within:bg-light-surface-container-lowest focus-within:ring-1 focus-within:ring-light-outline-variant"
      >
        <button
          type="submit"
          aria-label="搜索"
          onClick={() => searchInputRef.current?.focus()}
          className="inline-flex items-center justify-center text-light-on-surface-variant hover:text-light-on-surface shrink-0"
        >
          <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
            search
          </span>
        </button>
        <input
          ref={searchInputRef}
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          className="w-full min-w-0 bg-transparent border-0 p-0 font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-0 focus:outline-none"
        />
      </form>

      {/* Compose + Settings + User Profile */}
      <div className="flex items-center gap-gutter-sm shrink-0">
        <button
          type="button"
          onClick={onCompose}
          className="inline-flex items-center justify-center gap-gutter-sm px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary transition-colors duration-state-change ease-state-change hover:bg-light-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-2 whitespace-nowrap cursor-pointer"
        >
          <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
            edit_square
          </span>
          <span className="font-label text-label-lg">写邮件</span>
        </button>

        {onSyncNow && (
          <button
            type="button"
            onClick={onSyncNow}
            disabled={syncing}
            aria-label="立即同步全部邮箱"
            title={syncing ? '正在同步邮箱...' : `立即同步邮箱（上次同步：${lastSyncText}）`}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant transition-colors duration-state-change ease-state-change hover:bg-light-surface-container-low hover:text-light-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer disabled:opacity-60"
          >
            <span
              className={`material-symbols-outlined text-title-lg ${syncing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            >
              sync
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onNavigate('system-settings')}
          aria-label="系统设置与邮件过滤器"
          title="系统设置"
          className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant transition-colors duration-state-change ease-state-change hover:bg-light-surface-container-low hover:text-light-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
        >
          <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
            settings
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('account')}
          aria-label={`个人账户${userName}`}
          title={`${userName} (${userEmail})`}
          className="relative w-10 h-10 rounded-full bg-light-primary-container text-light-on-primary-container flex items-center justify-center transition-opacity duration-state-change hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
        >
          <span className="font-label text-label-md">{userInitial}</span>
        </button>
      </div>
    </header>
  );
};

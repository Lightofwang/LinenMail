import React, { useEffect, useRef } from 'react';
import { AppRoute } from '../types/mail';

interface AppHeaderProps {
  activeRoute: AppRoute;
  unreadCount: number;
  searchQuery: string;
  searchPlaceholder: string;
  userInitial: string;
  userName: string;
  userEmail: string;
  syncing?: boolean;
  lastSyncText?: string;
  onSyncNow?: () => void;
  onSelectMailWorkspace: () => void;
  onNavigate: (route: AppRoute) => void;
  onSearchChange: (q: string) => void;
  onCompose: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeRoute,
  unreadCount,
  searchQuery,
  searchPlaceholder,
  userInitial,
  userName,
  userEmail,
  syncing = false,
  lastSyncText = '刚刚',
  onSyncNow,
  onSelectMailWorkspace,
  onNavigate,
  onSearchChange,
  onCompose,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isMailActive = activeRoute === 'inbox' || activeRoute === 'drafts';

  return (
    <header className="shrink-0 w-full bg-light-surface-container-lowest rounded-xl px-6 py-3 shadow-[0_8px_28px_-6px_rgba(35,25,20,0.06)] flex items-center justify-between gap-8 z-30">
      {/* Zone 1: Brand + Primary Workspace Navigation */}
      <div className="flex items-center gap-gutter-md min-w-0 shrink-0">
        <button
          type="button"
          onClick={onSelectMailWorkspace}
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

        <nav aria-label="主导航" className="flex items-center gap-gutter-xs shrink-0">
          <button
            type="button"
            onClick={onSelectMailWorkspace}
            aria-current={isMailActive ? 'page' : undefined}
            className={`folder-tab shrink-0 whitespace-nowrap inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
              isMailActive
                ? 'bg-light-surface-container-highest text-light-on-surface'
                : 'text-light-on-surface-variant hover:bg-light-surface-container-low hover:text-light-on-surface'
            }`}
          >
            <span>邮件</span>
            {unreadCount > 0 && (
              <span className="font-mono text-mono-sm tabular-nums text-light-secondary">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onNavigate('contacts')}
            aria-current={activeRoute === 'contacts' ? 'page' : undefined}
            className={`folder-tab shrink-0 whitespace-nowrap inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
              activeRoute === 'contacts'
                ? 'bg-light-surface-container-highest text-light-on-surface'
                : 'text-light-on-surface-variant hover:bg-light-surface-container-low hover:text-light-on-surface'
            }`}
          >
            <span>联系人</span>
          </button>
        </nav>
      </div>

      {/* Zone 2: Command Searchbar */}
      <form
        role="search"
        onSubmit={(e) => e.preventDefault()}
        className="hidden md:flex items-center gap-gutter-sm flex-1 max-w-md min-w-[240px] px-gutter-md py-2 rounded-full bg-light-surface-container-low text-light-on-surface transition-colors duration-state-change focus-within:bg-light-surface-container-lowest focus-within:ring-1 focus-within:ring-light-outline-variant"
      >
        <button
          type="submit"
          aria-label="搜索"
          onClick={() => searchInputRef.current?.focus()}
          className="inline-flex items-center justify-center text-light-on-surface-variant hover:text-light-on-surface shrink-0 cursor-pointer"
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

      {/* Zone 3: Compose CTA + Utility Actions */}
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
          aria-label="系统设置"
          title="系统设置（含自动过滤规则与个人标签）"
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

import React, { useState } from 'react';
import { SwitchToggle } from '../components/SwitchToggle';
import { EMAIL_PROVIDER_PRESETS, mailService } from '../services/mailService';
import {
  AccountConfigInput,
  AppRoute,
  ConnectedAccount,
  TestConnectionResult,
  UserProfile,
} from '../types/mail';

interface AccountSettingsViewProps {
  profile: UserProfile;
  accounts: ConnectedAccount[];
  dataDir?: string;
  portableMode?: boolean;
  onBackToInbox: () => void;
  onUpdateProfile: (next: Partial<UserProfile>) => void;
  onAddAccount: (input: AccountConfigInput) => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
  onSetDefaultAccount: (id: string) => void;
  onNavigate: (route: AppRoute) => void;
}

const PROVIDER_KEYS = ['qq', 'netease163', 'gmail', 'outlook', 'custom'] as const;
type ProviderKey = (typeof PROVIDER_KEYS)[number];

export const AccountSettingsView: React.FC<AccountSettingsViewProps> = ({
  profile,
  accounts,
  dataDir,
  portableMode,
  onBackToInbox,
  onUpdateProfile,
  onAddAccount,
  onDeleteAccount,
  onSetDefaultAccount,
  onNavigate,
}) => {
  const [activeNav, setActiveNav] = useState('accounts-section');
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);

  // Edit Profile Modal
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile.name);
  const [initialDraft, setInitialDraft] = useState(profile.initial);

  // Add Account Modal
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey>('qq');
  const [newEmail, setNewEmail] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newPass, setNewPass] = useState('');
  const [imapHost, setImapHost] = useState(EMAIL_PROVIDER_PRESETS.qq.imapHost);
  const [imapPort, setImapPort] = useState(String(EMAIL_PROVIDER_PRESETS.qq.imapPort));
  const [smtpHost, setSmtpHost] = useState(EMAIL_PROVIDER_PRESETS.qq.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(EMAIL_PROVIDER_PRESETS.qq.smtpPort));
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const defaultAccount = accounts.find((a) => a.isDefault) || accounts[0];

  const handleSelectProvider = (key: ProviderKey) => {
    setSelectedProvider(key);
    const p = EMAIL_PROVIDER_PRESETS[key];
    setImapHost(p.imapHost);
    setImapPort(String(p.imapPort));
    setSmtpHost(p.smtpHost);
    setSmtpPort(String(p.smtpPort));
    setTestResult(null);
  };

  const handleTestAccountModal = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      const res = await mailService.testAccountConnection({
        email: newEmail.trim(),
        authCode: newPass.trim(),
        imapHost: imapHost.trim(),
        imapPort: Number(imapPort) || 993,
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort) || 465,
      });
      setTestResult(res);
    } catch (e) {
      setTestResult({
        success: false,
        imapOk: false,
        smtpOk: false,
        latencyMs: 0,
        message: String(e),
      });
    } finally {
      setTestingConn(false);
    }
  };

  const handleSaveSettings = () => {
    setSaveToast('偏好设置已保存至本地数据库');
    setTimeout(() => setSaveToast(null), 2400);
  };

  const handleSaveProfileModal = () => {
    onUpdateProfile({
      name: nameDraft.trim() || profile.name,
      initial: initialDraft.trim() || profile.initial,
    });
    setProfileModalOpen(false);
  };

  const handleSaveAccountModal = async () => {
    const email = newEmail.trim();
    if (email) {
      const preset = EMAIL_PROVIDER_PRESETS[selectedProvider];
      const label = newLabel.trim() || preset.label;
      await onAddAccount({
        email,
        badgeChar: label.charAt(0) || '邮',
        label,
        provider: preset.label,
        imapHost: imapHost.trim(),
        imapPort: Number(imapPort) || 993,
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort) || 465,
        authCode: newPass.trim(),
        isDefault: accounts.length === 0,
      });
      setNewEmail('');
      setNewLabel('');
      setNewPass('');
      setTestResult(null);
    }
    setAccountModalOpen(false);
  };

  const scrollToSection = (id: string) => {
    setActiveNav(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-light-surface flex flex-col px-gutter-xl py-gutter-lg gap-gutter-xl max-w-[1440px] mx-auto">
      {/* Contextual Header */}
      <header className="bg-light-surface-container-lowest rounded-xl px-gutter-lg py-gutter-md shadow-[0_8px_28px_-6px_rgba(35,25,20,0.06)] flex items-center justify-between gap-gutter-lg sticky top-4 z-20">
        <div className="flex items-center gap-gutter-md">
          <button
            type="button"
            onClick={onBackToInbox}
            className="inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
          >
            <span className="material-symbols-outlined text-title-md" aria-hidden="true">
              arrow_back
            </span>
            <span>返回收件箱</span>
          </button>

          <span className="h-5 w-px bg-light-outline-variant/50" aria-hidden="true" />

          <h1 className="font-headline text-title-lg text-light-on-surface">用户与账户管理</h1>
        </div>

        <div className="flex items-center gap-gutter-md">
          {saveToast && (
            <span className="font-label text-label-md text-light-secondary">{saveToast}</span>
          )}
          <button
            type="button"
            onClick={() => onNavigate('system-settings')}
            className="inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change cursor-pointer"
          >
            <span className="material-symbols-outlined text-title-md" aria-hidden="true">
              tune
            </span>
            <span>系统设置</span>
          </button>
          <button
            type="button"
            onClick={handleSaveSettings}
            className="inline-flex items-center justify-center gap-gutter-xs px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary transition-colors duration-state-change hover:bg-light-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-title-md" aria-hidden="true">
              check
            </span>
            <span className="font-label text-label-lg">保存更改</span>
          </button>
        </div>
      </header>

      {/* Main 2-Column Account & Preferences Layout */}
      <main className="w-full grid grid-cols-12 gap-gutter-xl items-start flex-1">
        {/* Left Column: Identity Block & Section Anchor Nav */}
        <aside className="col-span-12 lg:col-span-4 flex flex-col gap-gutter-lg">
          {/* Identity Card */}
          <section
            aria-label="个人资料卡片"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col items-center text-center gap-gutter-md"
          >
            <div className="w-20 h-20 rounded-full bg-light-primary-container text-light-on-primary-container flex items-center justify-center">
              <span className="font-headline text-display-lg-mobile">{profile.initial}</span>
            </div>

            <div className="flex flex-col gap-gutter-xs">
              <h2 className="font-headline text-headline-md text-light-on-surface">{profile.name}</h2>
              <p className="font-mono text-mono-sm text-light-on-surface-variant">
                {defaultAccount?.email || profile.primaryEmail}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setNameDraft(profile.name);
                setInitialDraft(profile.initial);
                setProfileModalOpen(true);
              }}
              className="inline-flex items-center justify-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface transition-colors duration-state-change hover:bg-light-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
            >
              <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                edit
              </span>
              <span className="font-label text-label-lg">编辑个人资料</span>
            </button>
          </section>

          {/* Section Navigation */}
          <nav
            aria-label="设置分组导航"
            className="bg-light-surface-container-lowest/80 rounded-xl p-gutter-md flex flex-col gap-gutter-xs"
          >
            {[
              { id: 'accounts-section', icon: 'alternate_email', label: '关联邮箱账户' },
              { id: 'signature-section', icon: 'draw', label: '邮件签名与发信' },
              { id: 'preferences-section', icon: 'tune', label: '阅读与快捷键偏好' },
              { id: 'security-section', icon: 'shield', label: '安全与设备管理' },
            ].map((item) => {
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  className={`flex items-center gap-gutter-sm px-gutter-md py-gutter-sm rounded-lg font-label text-label-lg transition-colors duration-state-change text-left cursor-pointer ${
                    active
                      ? 'bg-light-surface-container-low text-light-on-surface'
                      : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-title-md ${
                      active ? 'text-light-primary' : ''
                    }`}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}

            <div className="h-px bg-light-surface-container-high my-gutter-xs" aria-hidden="true" />

            <button
              type="button"
              onClick={() => onNavigate('onboarding')}
              className="flex items-center gap-gutter-sm px-gutter-md py-gutter-sm rounded-lg font-label text-label-md text-light-primary hover:bg-light-surface-container-low transition-colors duration-state-change text-left cursor-pointer"
            >
              <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                cable
              </span>
              <span>打开邮箱初始化连接向导</span>
            </button>
          </nav>
        </aside>

        {/* Right Column: Grouped Settings Sections */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-gutter-lg">
          {/* Section 1: Connected Email Accounts */}
          <section
            id="accounts-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md"
          >
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <h2 className="font-headline text-headline-md text-light-on-surface">
                  关联邮箱账户
                </h2>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  在一个收件箱内统一收发多个邮箱地址的往来信件。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAccountModalOpen(true)}
                className="inline-flex items-center justify-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container transition-colors duration-state-change shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  add
                </span>
                <span className="font-label text-label-lg">添加关联邮箱</span>
              </button>
            </div>

            <ul className="flex flex-col gap-gutter-sm">
              {accounts.map((acc) => (
                <li
                  key={acc.id}
                  className="flex items-center justify-between gap-gutter-md p-gutter-md rounded-lg bg-light-surface-container-low"
                >
                  <div className="flex items-center gap-gutter-md">
                    <span
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-label text-label-md ${
                        acc.isDefault
                          ? 'bg-light-primary text-light-on-primary'
                          : 'bg-light-surface-container-highest text-light-on-surface'
                      }`}
                    >
                      {acc.badgeChar}
                    </span>
                    <div className="flex flex-col">
                      <span className="font-title text-title-md text-light-on-surface">
                        {acc.email}
                      </span>
                      <span className="font-body text-body-sm text-light-on-surface-variant">
                        {acc.description}
                        {acc.imapHost ? ` · ${acc.imapHost}:${acc.imapPort || 993}` : ''}
                        {acc.lastSyncAt ? ` · 上次同步 ${acc.lastSyncAt}` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-gutter-xs shrink-0">
                    {acc.isDefault ? (
                      <span className="px-gutter-md py-gutter-xs rounded-full bg-light-secondary-container text-light-on-secondary-container font-label text-label-md">
                        默认发信
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSetDefaultAccount(acc.id)}
                          className="font-label text-label-md text-light-on-surface-variant hover:text-light-on-surface px-gutter-sm py-gutter-xs rounded-full hover:bg-light-surface-container transition-colors duration-state-change cursor-pointer"
                        >
                          设为默认
                        </button>
                        <button
                          type="button"
                          aria-label={`移除账户 ${acc.email}`}
                          onClick={() => void onDeleteAccount(acc.id)}
                          className="w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-error-container hover:text-light-on-error-container transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                            delete_outline
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Section 2: Signature & Undo Send */}
          <section
            id="signature-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md"
          >
            <div className="flex flex-col gap-gutter-xs">
              <h2 className="font-headline text-headline-md text-light-on-surface">
                邮件签名与发信设置
              </h2>
              <p className="font-body text-body-sm text-light-on-surface-variant">
                自定义默认落款与发信后可撤回的缓冲时长。
              </p>
            </div>

            <label className="flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">
                默认邮件签名
              </span>
              <textarea
                rows={3}
                value={profile.signature}
                onChange={(e) => onUpdateProfile({ signature: e.target.value })}
                className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none resize-none"
              />
            </label>

            <div className="flex items-center justify-between gap-gutter-md pt-gutter-xs">
              <div className="flex flex-col">
                <span className="font-title text-title-md text-light-on-surface">
                  发信撤回缓冲时间
                </span>
                <span className="font-body text-body-sm text-light-on-surface-variant">
                  点击发送后预留的短暂取消窗口
                </span>
              </div>

              <div
                className="flex items-center gap-gutter-xs bg-light-surface-container-low p-gutter-xs rounded-full"
                role="group"
                aria-label="撤回缓冲时间"
              >
                {([5, 10, 30] as const).map((sec) => {
                  const active = profile.undoSeconds === sec;
                  return (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => onUpdateProfile({ undoSeconds: sec })}
                      className={`px-gutter-md py-gutter-xs rounded-full font-mono text-mono-sm tabular-nums transition-colors duration-state-change cursor-pointer ${
                        active
                          ? 'bg-light-surface-container-lowest text-light-on-surface shadow-sm'
                          : 'text-light-on-surface-variant hover:text-light-on-surface'
                      }`}
                    >
                      {sec} 秒
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Section 3: Reading & Keyboard Preferences */}
          <section
            id="preferences-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md"
          >
            <h2 className="font-headline text-headline-md text-light-on-surface">
              阅读与快捷键偏好
            </h2>

            <div className="flex flex-col gap-gutter-md">
              <div className="flex items-center justify-between gap-gutter-md">
                <div className="flex flex-col">
                  <span className="font-title text-title-md text-light-on-surface">极简阅读模式</span>
                  <span className="font-body text-body-sm text-light-on-surface-variant">
                    自动折叠冗余的抄送头信息，保持阅读卡片清爽
                  </span>
                </div>
                <SwitchToggle
                  checked={profile.minimalReading}
                  onChange={(next) => onUpdateProfile({ minimalReading: next })}
                  ariaLabel="切换极简阅读模式"
                />
              </div>

              <div className="h-px bg-light-surface-container-high" aria-hidden="true" />

              <div className="flex items-center justify-between gap-gutter-md">
                <div className="flex flex-col">
                  <span className="font-title text-title-md text-light-on-surface">
                    启用单键快捷键
                  </span>
                  <span className="font-body text-body-sm text-light-on-surface-variant">
                    使用 J/K 切换邮件、E 快速归档、R 立即回复
                  </span>
                </div>
                <SwitchToggle
                  checked={profile.enableShortcuts}
                  onChange={(next) => onUpdateProfile({ enableShortcuts: next })}
                  ariaLabel="切换单键快捷键"
                />
              </div>

              <div className="h-px bg-light-surface-container-high" aria-hidden="true" />

              <div className="flex items-center justify-between gap-gutter-md">
                <div className="flex flex-col">
                  <span className="font-title text-title-md text-light-on-surface">
                    夜间静默免打扰
                  </span>
                  <span className="font-body text-body-sm text-light-on-surface-variant">
                    每日 21:00 至次日 08:00 暂停新邮件桌面弹窗提醒
                  </span>
                </div>
                <SwitchToggle
                  checked={profile.quietNightMode}
                  onChange={(next) => onUpdateProfile({ quietNightMode: next })}
                  ariaLabel="切换夜间静默免打扰"
                />
              </div>
            </div>
          </section>

          {/* Section 4: Security & Isolated Destructive Actions */}
          <section
            id="security-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md"
          >
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <h2 className="font-headline text-headline-md text-light-on-surface">
                  安全与设备管理
                </h2>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  {mailService.isDesktop()
                    ? `运行环境：素笺 Windows 桌面端（Tauri v2 + SQLite${portableMode ? ' 便携模式' : ''}）${dataDir ? ` · 数据目录：${dataDir}` : ''}`
                    : '运行环境：网页预览模式（打包为 Windows .exe 后自动启用本地 SQLite 与加密存储）'}
                </p>
              </div>
              {securityNotice && (
                <span className="font-label text-label-md text-light-secondary">
                  {securityNotice}
                </span>
              )}
            </div>

            <div className="h-px bg-light-surface-container-high" aria-hidden="true" />

            <div className="flex flex-wrap items-center justify-between gap-gutter-md pt-gutter-xs">
              <span className="font-body text-body-sm text-light-on-surface-variant">
                危险操作：退出其他设备登录或永久注销当前邮箱账户
              </span>
              <div className="flex items-center gap-gutter-sm shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSecurityNotice('已退出其他 2 台设备的会话授权');
                    setTimeout(() => setSecurityNotice(null), 3000);
                  }}
                  className="px-gutter-md py-gutter-xs rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change cursor-pointer"
                >
                  退出其他设备
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSecurityNotice('为保护本地邮件数据，请在设置中先导出归档后再确认注销');
                    setTimeout(() => setSecurityNotice(null), 3500);
                  }}
                  className="px-gutter-md py-gutter-xs rounded-full bg-light-error-container text-light-on-error-container hover:opacity-90 font-label text-label-md transition-opacity duration-state-change cursor-pointer"
                >
                  注销账户
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Edit Profile Modal */}
      {profileModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-light-scrim/35 p-gutter-lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-modal-title"
          onClick={() => setProfileModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_24px_60px_-12px_rgba(35,25,20,0.22)] flex flex-col gap-gutter-md"
          >
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <h2 id="profile-modal-title" className="font-headline text-headline-md text-light-on-surface">
                  编辑个人资料
                </h2>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  更新发件人显示名称与个人头像首字，将同步应用至所有发出信件。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setProfileModalOpen(false)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant hover:bg-light-surface-container shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            <div className="flex flex-col gap-gutter-sm">
              <label className="flex flex-col gap-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant">
                  显示名称
                </span>
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant">
                  头像标识首字
                </span>
                <input
                  type="text"
                  maxLength={2}
                  value={initialDraft}
                  onChange={(e) => setInitialDraft(e.target.value)}
                  className="w-24 px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-headline text-title-md text-light-on-surface text-center focus:ring-1 focus:ring-light-primary focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant">
                  默认发件账户
                </span>
                <input
                  type="text"
                  value={defaultAccount?.email || profile.primaryEmail}
                  readOnly
                  className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low/60 border-0 font-mono text-mono-sm text-light-on-surface-variant focus:outline-none"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-gutter-sm pt-gutter-sm">
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-lg transition-colors duration-state-change cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveProfileModal}
                className="px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container font-label text-label-lg transition-colors duration-state-change cursor-pointer"
              >
                保存资料
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Connected Account Modal */}
      {accountModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-light-scrim/35 p-gutter-lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-modal-title"
          onClick={() => setAccountModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_24px_60px_-12px_rgba(35,25,20,0.22)] flex flex-col gap-gutter-md"
          >
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <h2 id="account-modal-title" className="font-headline text-headline-md text-light-on-surface">
                  添加关联邮箱
                </h2>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  连接常用个人或工作邮箱，统一在一个收件箱内收发与管理。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setAccountModalOpen(false)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant hover:bg-light-surface-container shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-gutter-xs" role="group" aria-label="常用邮箱服务商">
              {PROVIDER_KEYS.map((key) => {
                const p = EMAIL_PROVIDER_PRESETS[key];
                const active = selectedProvider === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSelectProvider(key)}
                    className={`px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
                      active
                        ? 'bg-light-secondary-container text-light-on-secondary-container'
                        : 'bg-light-surface-container-low text-light-on-surface-variant hover:bg-light-surface-container'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-gutter-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter-sm">
                <label className="flex flex-col gap-gutter-xs">
                  <span className="font-label text-label-md text-light-on-surface-variant">
                    邮箱地址
                  </span>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="例如：name@qq.com 或 name@163.com"
                    className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-mono text-mono-sm text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-gutter-xs">
                  <span className="font-label text-label-md text-light-on-surface-variant">
                    账户备注名称
                  </span>
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="例如：个人主邮 / 项目组邮箱"
                    className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant">
                  授权码 / IMAP 密码
                </span>
                <input
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="输入邮箱客户端授权码或应用专用密码"
                  className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-12 gap-gutter-sm bg-light-surface-container-low/70 rounded-xl p-gutter-md">
                <label className="col-span-8 flex flex-col gap-gutter-xs">
                  <span className="font-label text-label-sm text-light-on-surface-variant">
                    IMAP 服务器
                  </span>
                  <input
                    type="text"
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                    className="w-full px-gutter-sm py-gutter-xs rounded-lg bg-light-surface-container-lowest border-0 font-mono text-mono-sm text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                  />
                </label>
                <label className="col-span-4 flex flex-col gap-gutter-xs">
                  <span className="font-label text-label-sm text-light-on-surface-variant">
                    IMAP 端口
                  </span>
                  <input
                    type="text"
                    value={imapPort}
                    onChange={(e) => setImapPort(e.target.value)}
                    className="w-full px-gutter-sm py-gutter-xs rounded-lg bg-light-surface-container-lowest border-0 font-mono text-mono-sm tabular-nums text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                  />
                </label>
                <label className="col-span-8 flex flex-col gap-gutter-xs">
                  <span className="font-label text-label-sm text-light-on-surface-variant">
                    SMTP 服务器
                  </span>
                  <input
                    type="text"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    className="w-full px-gutter-sm py-gutter-xs rounded-lg bg-light-surface-container-lowest border-0 font-mono text-mono-sm text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                  />
                </label>
                <label className="col-span-4 flex flex-col gap-gutter-xs">
                  <span className="font-label text-label-sm text-light-on-surface-variant">
                    SMTP 端口
                  </span>
                  <input
                    type="text"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    className="w-full px-gutter-sm py-gutter-xs rounded-lg bg-light-surface-container-lowest border-0 font-mono text-mono-sm tabular-nums text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                  />
                </label>
              </div>

              {testResult && (
                <p
                  className={`font-label text-label-sm ${
                    testResult.success ? 'text-light-secondary' : 'text-light-error'
                  }`}
                >
                  {testResult.message}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-gutter-sm pt-gutter-sm">
              <button
                type="button"
                disabled={testingConn}
                onClick={() => void handleTestAccountModal()}
                className="px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change cursor-pointer disabled:opacity-60"
              >
                {testingConn ? '正在测试连接...' : '测试 IMAP/SMTP 连接'}
              </button>

              <div className="flex items-center gap-gutter-sm">
                <button
                  type="button"
                  onClick={() => setAccountModalOpen(false)}
                  className="px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-lg transition-colors duration-state-change cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveAccountModal()}
                  className="px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container font-label text-label-lg transition-colors duration-state-change cursor-pointer"
                >
                  加密保存并关联
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

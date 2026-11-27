import React, { useState } from 'react';
import { EMAIL_PROVIDER_PRESETS, mailService } from '../services/mailService';
import { AccountConfigInput, TestConnectionResult } from '../types/mail';

interface OnboardingViewProps {
  onComplete: (accountConfig?: AccountConfigInput) => Promise<void> | void;
}

const PRESET_KEYS = ['qq', 'netease163', 'gmail', 'custom'] as const;
type PresetKey = (typeof PRESET_KEYS)[number];

export const OnboardingView: React.FC<OnboardingViewProps> = ({ onComplete }) => {
  const [provider, setProvider] = useState<PresetKey>('qq');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState(EMAIL_PROVIDER_PRESETS.qq.imapHost);
  const [imapPort, setImapPort] = useState(String(EMAIL_PROVIDER_PRESETS.qq.imapPort));
  const [smtpHost, setSmtpHost] = useState(EMAIL_PROVIDER_PRESETS.qq.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(EMAIL_PROVIDER_PRESETS.qq.smtpPort));
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const selectProvider = (key: PresetKey) => {
    setProvider(key);
    const p = EMAIL_PROVIDER_PRESETS[key];
    setImapHost(p.imapHost);
    setImapPort(String(p.imapPort));
    setSmtpHost(p.smtpHost);
    setSmtpPort(String(p.smtpPort));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await mailService.testAccountConnection({
        email: email.trim(),
        authCode: password.trim(),
        imapHost: imapHost.trim(),
        imapPort: Number(imapPort) || 993,
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort) || 465,
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({
        success: false,
        imapOk: false,
        smtpOk: false,
        latencyMs: 0,
        message: String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleFinish = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      await onComplete();
      return;
    }
    setSaving(true);
    try {
      const preset = EMAIL_PROVIDER_PRESETS[provider];
      await onComplete({
        email: cleanEmail,
        badgeChar: preset.label.charAt(0),
        label: preset.label,
        provider: preset.label,
        imapHost: imapHost.trim(),
        imapPort: Number(imapPort) || 993,
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort) || 465,
        authCode: password.trim(),
        isDefault: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const activePreset = EMAIL_PROVIDER_PRESETS[provider];

  return (
    <div className="min-h-screen bg-light-surface flex flex-col items-center justify-center px-gutter-xl py-gutter-xl gap-gutter-lg">
      {/* Brand Top Row */}
      <div className="w-full max-w-2xl flex items-center justify-between">
        <div className="flex items-center gap-gutter-sm">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-light-primary text-light-on-primary">
            <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
              mail
            </span>
          </span>
          <span className="font-headline text-title-lg text-light-on-surface">素笺 LinenMail</span>
        </div>

        <button
          type="button"
          onClick={() => onComplete()}
          className="font-label text-label-md text-light-on-surface-variant hover:text-light-on-surface cursor-pointer"
        >
          返回收件箱
        </button>
      </div>

      {/* Centered Onboarding Connect Card */}
      <main className="w-full max-w-2xl bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-lg">
        <div className="flex flex-col gap-gutter-xs">
          <h1 className="font-headline text-headline-lg text-light-on-surface text-balance">
            欢迎使用素笺，先链接一个常用邮箱
          </h1>
          <p className="font-body text-body-md text-light-on-surface-variant text-pretty">
            无需注册第三方账号，选择邮箱服务商自动填充 IMAP / SMTP 参数，输入授权码即可本地加密直连。
          </p>
        </div>

        {/* Provider Quick-Pick Grid */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-gutter-sm"
          role="radiogroup"
          aria-label="选择邮箱服务商"
        >
          {PRESET_KEYS.map((key) => {
            const p = EMAIL_PROVIDER_PRESETS[key];
            const active = provider === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectProvider(key)}
                className={`flex flex-col items-center gap-gutter-xs p-gutter-md rounded-xl transition-colors duration-state-change cursor-pointer ${
                  active
                    ? 'bg-light-surface-container-low ring-1 ring-light-primary text-light-on-surface'
                    : 'bg-light-surface-container-low/60 hover:bg-light-surface-container-low text-light-on-surface-variant'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-title-lg ${
                    active ? 'text-light-primary' : ''
                  }`}
                  aria-hidden="true"
                >
                  {p.icon}
                </span>
                <span className="font-label text-label-md">{p.label}</span>
              </button>
            );
          })}
        </div>

        <p className="font-body text-body-sm text-light-on-surface-variant bg-light-surface-container-low/60 rounded-lg px-gutter-md py-gutter-xs">
          {activePreset.hint}
        </p>

        {/* Account & Server Form */}
        <form
          className="flex flex-col gap-gutter-md"
          onSubmit={(e) => {
            e.preventDefault();
            void handleFinish();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter-md">
            <label className="flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">
                邮箱地址
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="例如：name@qq.com 或 name@163.com"
                className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">
                授权码 / 应用专用密码
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入客户端授权码"
                className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
              />
            </label>
          </div>

          {/* IMAP / SMTP Details */}
          <div className="grid grid-cols-12 gap-gutter-md bg-light-surface-container-low/70 rounded-xl p-gutter-md">
            <label className="col-span-8 flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">
                接收服务器 (IMAP)
              </span>
              <input
                type="text"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-lowest border-0 font-mono text-mono-sm text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
              />
            </label>
            <label className="col-span-4 flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">端口</span>
              <input
                type="text"
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value)}
                className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-lowest border-0 font-mono text-mono-sm tabular-nums text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
              />
            </label>

            <label className="col-span-8 flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">
                发送服务器 (SMTP)
              </span>
              <input
                type="text"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-lowest border-0 font-mono text-mono-sm text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
              />
            </label>
            <label className="col-span-4 flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">端口</span>
              <input
                type="text"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-lowest border-0 font-mono text-mono-sm tabular-nums text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
              />
            </label>

            <div className="col-span-12 flex flex-wrap items-center justify-between gap-gutter-sm pt-gutter-xs">
              <div className="flex items-center gap-gutter-xs text-light-on-surface-variant">
                <span
                  className="material-symbols-outlined text-title-md text-light-secondary"
                  aria-hidden="true"
                >
                  lock
                </span>
                <span className="font-body text-body-sm">强制启用 SSL/TLS 安全加密连接</span>
              </div>
              {testResult && (
                <span
                  className={`font-label text-label-sm ${
                    testResult.success ? 'text-light-secondary' : 'text-light-error'
                  }`}
                >
                  {testResult.message}
                </span>
              )}
            </div>
          </div>

          {/* Primary Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-gutter-md pt-gutter-xs">
            <span className="font-body text-body-sm text-light-on-surface-variant">
              授权码通过 AES-256-GCM 仅加密保存在本地设备
            </span>

            <div className="flex items-center gap-gutter-sm">
              <button
                type="button"
                disabled={testing}
                onClick={() => void handleTest()}
                className="inline-flex items-center justify-center px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container transition-colors duration-state-change cursor-pointer disabled:opacity-60"
              >
                <span className="font-label text-label-lg">
                  {testing ? '正在验证...' : '测试连接'}
                </span>
              </button>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-gutter-sm px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary transition-colors duration-state-change hover:bg-light-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-2 cursor-pointer disabled:opacity-60"
              >
                <span className="font-label text-label-lg">
                  {saving ? '正在保存并同步...' : '完成配置并进入收件箱'}
                </span>
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  arrow_forward
                </span>
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
};

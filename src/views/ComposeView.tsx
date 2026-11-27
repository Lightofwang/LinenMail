import React, { useEffect, useRef, useState } from 'react';
import { formatBytes, mailService } from '../services/mailService';
import {
  ComposePrefill,
  DraftItem,
  EmailAttachment,
  LlmProfile,
  ScheduledEmailItem,
  UserProfile,
} from '../types/mail';
import { polishEmailDraftWithAi } from '../utils/aiClient';

interface ComposeViewProps {
  profile: UserProfile;
  senderEmail: string;
  activeLlm: LlmProfile;
  prefill: ComposePrefill | null;
  onBackToInbox: () => void;
  onSendEmail: (payload: {
    recipients: string[];
    cc: string;
    subject: string;
    body: string;
    attachments: EmailAttachment[];
  }) => Promise<{ ok: boolean; sentId?: string; error?: string }>;
  onScheduleEmail: (item: ScheduledEmailItem) => Promise<void>;
  onSaveDraft: (draft: DraftItem) => Promise<void>;
}

const DEFAULT_RECIPIENTS = ['lin.chenxi@atelier.cn', 'siyuan.chen@nexuslab.io'];
const DEFAULT_SUBJECT = '关于 Q4 暖色系设计系统上线的最终排期确认';
const DEFAULT_BODY = `晨曦、思远：

昨晚已经和各位确认完排版规范与同步引擎的基准测试结果，整体非常稳妥。

接下来的发布节奏建议如下：
1. 周四上午完成主收件箱与智能分类视图的最后走查；
2. 周五下午三点进行线上灰度发布，优先覆盖桌面端用户；
3. 下周一早会复盘首批用户的阅读体验反馈。

附件里附上了更新后的排期表，如有调整欢迎随时回复。

祝好，
明远`;

export const ComposeView: React.FC<ComposeViewProps> = ({
  profile,
  senderEmail,
  activeLlm,
  prefill,
  onBackToInbox,
  onSendEmail,
  onScheduleEmail,
  onSaveDraft,
}) => {
  const [draftId] = useState<string>(prefill?.draftId || `draft-${Date.now()}`);
  const [recipients, setRecipients] = useState<string[]>(
    prefill?.recipients !== undefined ? prefill.recipients : DEFAULT_RECIPIENTS
  );
  const [recipientInput, setRecipientInput] = useState('');
  const [showCc, setShowCc] = useState(Boolean(prefill?.cc));
  const [ccValue, setCcValue] = useState(prefill?.cc || '');
  const [subject, setSubject] = useState(
    prefill?.subject !== undefined ? prefill.subject : DEFAULT_SUBJECT
  );
  const [body, setBody] = useState(
    prefill?.body !== undefined ? prefill.body : DEFAULT_BODY
  );
  const [attachments, setAttachments] = useState<EmailAttachment[]>(
    prefill !== null
      ? prefill.attachments && prefill.attachments.length > 0
        ? prefill.attachments
        : prefill.attachment
        ? [prefill.attachment]
        : []
      : [{ name: 'Q4_Release_Schedule_v3.pdf', size: '1.8 MB' }]
  );

  const [saveStatus, setSaveStatus] = useState('草稿已自动保存 · 刚刚');
  const [sendingNow, setSendingNow] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentBannerInfo, setSentBannerInfo] = useState<{
    count: number;
    pendingUndo: boolean;
    secondsLeft: number;
  } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [polishing, setPolishing] = useState(false);
  const [polishModel, setPolishModel] = useState<string | null>(null);
  const [originalDraftBeforePolish, setOriginalDraftBeforePolish] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSendTimerRef = useRef<number | null>(null);
  const pendingCountdownRef = useRef<number | null>(null);
  const pendingPayloadRef = useRef<{
    recipients: string[];
    cc: string;
    subject: string;
    body: string;
    attachments: EmailAttachment[];
  } | null>(null);

  // Clean up timers on unmount (flush pending send if user navigates away)
  useEffect(() => {
    return () => {
      if (pendingCountdownRef.current) window.clearInterval(pendingCountdownRef.current);
      if (pendingSendTimerRef.current) {
        window.clearTimeout(pendingSendTimerRef.current);
        if (pendingPayloadRef.current) {
          const payload = pendingPayloadRef.current;
          pendingPayloadRef.current = null;
          void onSendEmail(payload);
        }
      }
    };
  }, [onSendEmail]);

  const charCount = body.replace(/\s+/g, '').length;

  const handleAddRecipient = (raw: string) => {
    const trimmed = raw.trim().replace(/,$/, '');
    if (trimmed && !recipients.includes(trimmed)) {
      setRecipients((prev) => [...prev, trimmed]);
    }
    setRecipientInput('');
  };

  const handleFormat = (type: 'bold' | 'italic' | 'list' | 'quote' | 'link') => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = body.slice(start, end);

    let replacement = '';
    if (type === 'bold') replacement = `**${selected || '重点内容'}**`;
    if (type === 'italic') replacement = `*${selected || '斜体文字'}*`;
    if (type === 'list') replacement = `\n- ${selected || '列表项'}`;
    if (type === 'quote') replacement = `\n> ${selected || '引用内容'}`;
    if (type === 'link') replacement = `[${selected || '链接文字'}](https://linenmail.cn)`;

    const next = body.slice(0, start) + replacement + body.slice(end);
    setBody(next);
    setSaveStatus('草稿已自动保存 · 刚刚');
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + replacement.length, start + replacement.length);
    }, 0);
  };

  const handleAddAttachmentClick = async () => {
    if (mailService.isDesktop()) {
      try {
        const picked = await mailService.pickAttachmentFiles();
        if (picked && picked.length > 0) {
          setAttachments((prev) => [...prev, ...picked]);
          setSaveStatus(`已添加 ${picked.length} 个本地附件`);
        }
        return;
      } catch {
        // fallback to input
      }
    }
    fileInputRef.current?.click();
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64 = result.includes(',') ? result.split(',')[1] : '';
        setAttachments((prev) => [
          ...prev,
          {
            id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            size: formatBytes(file.size),
            sizeBytes: file.size,
            mimeType: file.type || 'application/octet-stream',
            contentBase64: base64 || null,
            cached: true,
          },
        ]);
        setSaveStatus('草稿已自动保存 · 刚刚');
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handlePolish = async () => {
    if (!body.trim() || polishing) return;
    if (originalDraftBeforePolish === null) {
      setOriginalDraftBeforePolish(body);
    }
    setPolishing(true);
    const res = await polishEmailDraftWithAi(body, activeLlm);
    setBody(res.text);
    setPolishModel(res.model);
    setPolishing(false);
    setSaveStatus('草稿已自动保存 · 刚刚');
  };

  const handleUndoPolish = () => {
    if (originalDraftBeforePolish !== null) {
      setBody(originalDraftBeforePolish);
      setOriginalDraftBeforePolish(null);
    }
    setPolishModel(null);
  };

  const dispatchRealSend = async (payload: {
    recipients: string[];
    cc: string;
    subject: string;
    body: string;
    attachments: EmailAttachment[];
  }) => {
    setSendingNow(true);
    setSendError(null);
    const res = await onSendEmail(payload);
    setSendingNow(false);
    if (!res.ok) {
      setSendError(res.error || '邮件发送失败，请检查 SMTP 账户配置');
      setSentBannerInfo(null);
      setSaveStatus('发送失败，内容已保留在草稿中');
    } else {
      setSentBannerInfo({ count: payload.recipients.length, pendingUndo: false, secondsLeft: 0 });
      setSaveStatus('邮件已通过 SMTP 发送成功');
    }
  };

  const handleSend = () => {
    const finalRecipients =
      recipientInput.trim() && !recipients.includes(recipientInput.trim())
        ? [...recipients, recipientInput.trim()]
        : recipients;

    if (finalRecipients.length === 0) {
      setSaveStatus('请至少填写一位收件人');
      return;
    }

    if (pendingSendTimerRef.current) window.clearTimeout(pendingSendTimerRef.current);
    if (pendingCountdownRef.current) window.clearInterval(pendingCountdownRef.current);

    const payload = {
      recipients: finalRecipients,
      cc: ccValue,
      subject: subject.trim() || '（无主题）',
      body,
      attachments,
    };
    setSendError(null);

    const delaySec = profile.undoSeconds || 5;
    pendingPayloadRef.current = payload;
    setSentBannerInfo({
      count: finalRecipients.length,
      pendingUndo: true,
      secondsLeft: delaySec,
    });
    setSaveStatus(`发信缓冲中（${delaySec} 秒内可随时撤回）`);

    pendingCountdownRef.current = window.setInterval(() => {
      setSentBannerInfo((prev) => {
        if (!prev || !prev.pendingUndo) return prev;
        const next = Math.max(0, prev.secondsLeft - 1);
        return { ...prev, secondsLeft: next };
      });
    }, 1000);

    pendingSendTimerRef.current = window.setTimeout(() => {
      if (pendingCountdownRef.current) window.clearInterval(pendingCountdownRef.current);
      pendingSendTimerRef.current = null;
      const toSend = pendingPayloadRef.current;
      pendingPayloadRef.current = null;
      if (toSend) {
        void dispatchRealSend(toSend);
      }
    }, delaySec * 1000);
  };

  const handleUndoPendingSend = () => {
    if (pendingSendTimerRef.current) {
      window.clearTimeout(pendingSendTimerRef.current);
      pendingSendTimerRef.current = null;
    }
    if (pendingCountdownRef.current) {
      window.clearInterval(pendingCountdownRef.current);
      pendingCountdownRef.current = null;
    }
    pendingPayloadRef.current = null;
    setSentBannerInfo(null);
    setSaveStatus('已成功拦截发送并恢复为草稿');
  };

  const handleManualSaveDraft = async () => {
    await onSaveDraft({
      id: draftId,
      recipients,
      cc: ccValue,
      subject,
      body,
      attachments,
      updatedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    });
    setSaveStatus('草稿已保存至本地数据库 · 刚刚');
  };

  const handleScheduleOption = async (label: string, targetDate: Date) => {
    const finalRecipients =
      recipientInput.trim() && !recipients.includes(recipientInput.trim())
        ? [...recipients, recipientInput.trim()]
        : recipients;
    if (finalRecipients.length === 0) {
      setScheduleOpen(false);
      setSaveStatus('请先填写收件人后再设定定时发送');
      return;
    }
    setScheduleOpen(false);
    const timeStr = targetDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    await onScheduleEmail({
      id: `sched-${Date.now()}`,
      recipients: finalRecipients,
      cc: ccValue,
      subject: subject.trim() || '（无主题）',
      body,
      attachments,
      scheduledAtMs: targetDate.getTime(),
      scheduledLabel: `${label} ${timeStr}`,
      status: 'pending',
    });
    setSaveStatus(`已加入后台定时发送队列 · ${label} ${timeStr}`);
  };

  const handleDiscard = () => {
    handleUndoPendingSend();
    setRecipients([]);
    setSubject('');
    setBody('');
    setAttachments([]);
    setOriginalDraftBeforePolish(null);
    setPolishModel(null);
    setSentBannerInfo(null);
    setSendError(null);
    setSaveStatus('草稿已清空');
  };

  return (
    <div className="min-h-screen bg-light-surface flex flex-col px-gutter-xl py-gutter-lg gap-gutter-xl max-w-[1440px] mx-auto">
      {/* Contextual Task Flow Header */}
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

          <div className="flex items-center gap-gutter-sm">
            <span className="w-2 h-2 rounded-full bg-light-secondary" aria-hidden="true" />
            <span className="font-label text-label-md text-light-on-surface-variant">
              {saveStatus}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-gutter-sm">
          <button
            type="button"
            onClick={handleDiscard}
            aria-label="丢弃草稿"
            title="丢弃草稿"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant transition-colors duration-state-change hover:bg-light-error-container hover:text-light-on-error-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
          >
            <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
              delete_outline
            </span>
          </button>
        </div>
      </header>

      {/* Focused Single-Column Stationery Sheet */}
      <main className="w-full flex-1 flex flex-col gap-gutter-lg">
        {/* Error Banner */}
        {sendError && (
          <div className="flex items-center justify-between gap-gutter-md px-gutter-lg py-gutter-md rounded-xl bg-light-error-container text-light-on-error-container">
            <div className="flex items-center gap-gutter-sm">
              <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                error_outline
              </span>
              <span className="font-body text-body-md">{sendError}</span>
            </div>
            <button
              type="button"
              onClick={() => setSendError(null)}
              className="font-label text-label-md underline cursor-pointer"
            >
              关闭
            </button>
          </div>
        )}

        {/* Sent / Undo-Buffer Confirmation Banner */}
        {sentBannerInfo && (
          <div className="flex items-center justify-between gap-gutter-md px-gutter-lg py-gutter-md rounded-xl bg-light-secondary-container text-light-on-secondary-container">
            <div className="flex items-center gap-gutter-sm">
              <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                {sentBannerInfo.pendingUndo ? 'schedule_send' : 'check_circle'}
              </span>
              <span className="font-body text-body-md tabular-nums">
                {sentBannerInfo.pendingUndo
                  ? `准备投递至 ${sentBannerInfo.count} 位收件人（${sentBannerInfo.secondsLeft} 秒后发出）`
                  : sendingNow
                  ? '正在通过 SMTP 加密投递...'
                  : `邮件已发送至 ${sentBannerInfo.count} 位收件人。`}
              </span>
            </div>
            <div className="flex items-center gap-gutter-md">
              {sentBannerInfo.pendingUndo && (
                <button
                  type="button"
                  onClick={handleUndoPendingSend}
                  className="font-label text-label-md underline cursor-pointer"
                >
                  撤回发送
                </button>
              )}
              <button
                type="button"
                onClick={onBackToInbox}
                className="font-label text-label-md underline cursor-pointer"
              >
                回到收件箱
              </button>
            </div>
          </div>
        )}

        <section
          aria-label="邮件撰写纸面"
          className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-lg flex-1"
        >
          {/* Envelope Metadata: To, Cc/Bcc, From */}
          <div className="flex flex-col gap-gutter-sm">
            {/* To Row */}
            <div className="flex items-center justify-between gap-gutter-md py-gutter-xs">
              <div className="flex items-center flex-wrap gap-gutter-sm flex-1 min-w-0">
                <span className="font-label text-label-md text-light-on-surface-variant w-12 shrink-0">
                  收件人
                </span>
                <div className="flex items-center flex-wrap gap-gutter-xs">
                  {recipients.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-gutter-xs pl-gutter-md pr-gutter-xs py-gutter-xs rounded-full bg-light-secondary-container text-light-on-secondary-container"
                    >
                      <span className="font-label text-label-md">{email}</span>
                      <button
                        type="button"
                        aria-label={`移除 ${email}`}
                        onClick={() =>
                          setRecipients((prev) => prev.filter((item) => item !== email))
                        }
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full hover:bg-light-surface-container-lowest transition-colors duration-state-change cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-body-sm" aria-hidden="true">
                          close
                        </span>
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="email"
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ',') && recipientInput.trim()) {
                      e.preventDefault();
                      handleAddRecipient(recipientInput);
                    }
                  }}
                  onBlur={() => {
                    if (recipientInput.trim()) handleAddRecipient(recipientInput);
                  }}
                  aria-label="添加收件人邮箱"
                  placeholder="输入邮箱后按回车添加..."
                  className="min-w-[180px] flex-1 bg-transparent border-0 p-0 font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-0 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowCc((s) => !s)}
                className="font-label text-label-md text-light-on-surface-variant hover:text-light-on-surface px-gutter-sm py-gutter-xs rounded-full hover:bg-light-surface-container-low transition-colors duration-state-change shrink-0 cursor-pointer"
              >
                抄送 / 密送
              </button>
            </div>

            {/* Optional Cc Row */}
            {showCc && (
              <div className="flex items-center gap-gutter-md py-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant w-12 shrink-0">
                  抄送
                </span>
                <input
                  type="email"
                  value={ccValue}
                  onChange={(e) => setCcValue(e.target.value)}
                  aria-label="抄送邮箱"
                  placeholder="添加抄送人邮箱..."
                  className="w-full bg-transparent border-0 p-0 font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-0 focus:outline-none"
                />
              </div>
            )}

            {/* From Row */}
            <div className="flex items-center gap-gutter-md py-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant w-12 shrink-0">
                发件人
              </span>
              <span className="font-body text-body-md text-light-on-surface">
                {profile.name} &lt;{senderEmail}&gt;
              </span>
            </div>
          </div>

          <div className="h-px bg-light-surface-container-high" aria-hidden="true" />

          {/* Editorial Subject Line */}
          <div>
            <label htmlFor="compose-subject" className="sr-only">
              邮件主题
            </label>
            <input
              id="compose-subject"
              type="text"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setSaveStatus('草稿已自动保存 · 刚刚');
              }}
              placeholder="填写邮件主题..."
              className="w-full bg-transparent border-0 p-0 font-headline text-headline-lg text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-0 focus:outline-none"
            />
          </div>

          {/* Minimalist Inline Formatting Strip */}
          <div className="flex flex-wrap items-center justify-between gap-gutter-md bg-light-surface-container-low rounded-full px-gutter-md py-gutter-xs">
            <div className="flex items-center gap-gutter-xs">
              <button
                type="button"
                aria-label="加粗"
                onClick={() => handleFormat('bold')}
                className="w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  format_bold
                </span>
              </button>
              <button
                type="button"
                aria-label="斜体"
                onClick={() => handleFormat('italic')}
                className="w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  format_italic
                </span>
              </button>
              <button
                type="button"
                aria-label="项目列表"
                onClick={() => handleFormat('list')}
                className="w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  format_list_bulleted
                </span>
              </button>
              <button
                type="button"
                aria-label="引用块"
                onClick={() => handleFormat('quote')}
                className="w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  format_quote
                </span>
              </button>
              <span className="h-4 w-px bg-light-outline-variant/50 mx-gutter-xs" aria-hidden="true" />
              <button
                type="button"
                aria-label="插入链接"
                onClick={() => handleFormat('link')}
                className="w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  link
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFilePick}
              />
              <button
                type="button"
                onClick={handleAddAttachmentClick}
                className="inline-flex items-center gap-gutter-xs px-gutter-sm py-gutter-xs rounded-full text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface font-label text-label-md transition-colors duration-state-change cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  attach_file
                </span>
                <span>添加附件</span>
              </button>
            </div>

            <div className="flex items-center gap-gutter-sm">
              {polishModel && (
                <span className="font-label text-label-sm text-light-secondary">
                  已润色 · {polishModel}
                </span>
              )}
              {originalDraftBeforePolish !== null && (
                <button
                  type="button"
                  onClick={handleUndoPolish}
                  className="px-gutter-sm py-gutter-xs rounded-full text-light-on-surface-variant hover:bg-light-surface-container font-label text-label-sm transition-colors duration-state-change cursor-pointer"
                >
                  还原原文
                </button>
              )}
              <button
                type="button"
                onClick={handlePolish}
                disabled={polishing}
                className="inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full bg-light-secondary-container text-light-on-secondary-container hover:opacity-90 font-label text-label-md transition-opacity duration-state-change cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  auto_awesome
                </span>
                <span>{polishing ? '正在美化...' : 'AI 一键美化'}</span>
              </button>
              <span className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums px-gutter-sm">
                {charCount} 字
              </span>
            </div>
          </div>

          {/* Spacious Writing Canvas */}
          <div className="flex-1 flex flex-col">
            <label htmlFor="compose-body" className="sr-only">
              邮件正文
            </label>
            <textarea
              ref={bodyRef}
              id="compose-body"
              rows={11}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setSaveStatus('草稿已自动保存 · 刚刚');
              }}
              placeholder="从这里开始书写..."
              className="w-full max-w-prose bg-transparent border-0 p-0 font-body text-body-lg text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-0 focus:outline-none resize-none leading-relaxed flex-1"
            />
          </div>

          {/* Attached File Strip */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-gutter-sm">
              {attachments.map((att, index) => (
                <div
                  key={`${att.name}-${index}`}
                  className="inline-flex items-center gap-gutter-sm px-gutter-md py-gutter-sm rounded-md bg-light-surface-container-low text-light-on-surface"
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
                  <button
                    type="button"
                    aria-label="移除附件"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, idx) => idx !== index))
                    }
                    className="ml-gutter-sm w-6 h-6 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-body-md" aria-hidden="true">
                      close
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="h-px bg-light-surface-container-high" aria-hidden="true" />

          {/* Bottom Action & Schedule Bar */}
          <div className="flex items-center justify-end gap-gutter-md">
            <div className="relative flex items-center gap-gutter-sm">
              <button
                type="button"
                onClick={handleManualSaveDraft}
                className="inline-flex items-center justify-center px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface transition-colors duration-state-change hover:bg-light-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
              >
                <span className="font-label text-label-lg">存为草稿</span>
              </button>

              <button
                type="button"
                onClick={() => setScheduleOpen((o) => !o)}
                className="inline-flex items-center justify-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface transition-colors duration-state-change hover:bg-light-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  schedule_send
                </span>
                <span className="font-label text-label-lg">定时发送</span>
              </button>

              <button
                type="button"
                disabled={sendingNow}
                onClick={handleSend}
                className="inline-flex items-center justify-center gap-gutter-sm px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary transition-colors duration-state-change hover:bg-light-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-2 cursor-pointer disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  send
                </span>
                <span className="font-label text-label-lg">
                  {sendingNow ? '发送中...' : '发送邮件'}
                </span>
              </button>

              {/* Schedule Popover */}
              {scheduleOpen && (
                <div className="absolute right-0 bottom-12 w-64 bg-light-surface-container-lowest rounded-xl p-gutter-sm shadow-[0_16px_40px_-8px_rgba(35,25,20,0.16)] ring-1 ring-light-outline-variant/40 flex flex-col gap-gutter-xs z-30">
                  <span className="px-gutter-sm py-gutter-xs font-label text-label-md text-light-on-surface-variant">
                    选择发送时间
                  </span>
                  {[
                    {
                      label: '1 小时后',
                      time: new Date(Date.now() + 60 * 60 * 1000).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                      getDate: () => new Date(Date.now() + 60 * 60 * 1000),
                    },
                    {
                      label: '明早工作时间',
                      time: '09:00',
                      getDate: () => {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        d.setHours(9, 0, 0, 0);
                        return d;
                      },
                    },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => handleScheduleOption(opt.label, opt.getDate())}
                      className="text-left px-gutter-sm py-gutter-sm rounded-md hover:bg-light-surface-container-low font-body text-body-md text-light-on-surface flex items-center justify-between cursor-pointer"
                    >
                      <span>{opt.label}</span>
                      <span className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums">
                        {opt.time}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

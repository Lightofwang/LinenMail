import React, { useMemo, useState } from 'react';
import { isSafeExternalUrl } from '../services/mailService';
import { cleanMailText } from '../utils/textClean';
import { parseEmailThread, QuotedMessage } from '../utils/threadParser';

interface EmailBodyRendererProps {
  emailId: string;
  subject: string;
  paragraphs: string[];
  signoff?: string;
}

function renderSafeInlineLinks(rawText: string): React.ReactNode {
  const text = cleanMailText(rawText);
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

const SignatureBlock: React.FC<{ lines: string[]; compact?: boolean }> = ({
  lines,
  compact = false,
}) => {
  if (lines.length === 0) return null;
  return (
    <div
      className={`border-l-2 border-light-outline-variant/50 pl-3.5 flex flex-col gap-0.5 text-light-on-surface-variant ${
        compact ? 'text-body-sm mt-1' : 'text-body-sm mt-2'
      }`}
    >
      {lines.map((line, i) => (
        <p
          key={i}
          className={`leading-snug ${
            i === 0 ? 'font-medium text-light-on-surface/85' : ''
          }`}
        >
          {renderSafeInlineLinks(line)}
        </p>
      ))}
    </div>
  );
};

const QuotedMessageCard: React.FC<{
  message: QuotedMessage;
  index: number;
  defaultExpanded: boolean;
}> = ({ message, index, defaultExpanded }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const fromField = message.headers.find((h) => h.key === 'from');
  const dateField = message.headers.find((h) => h.key === 'date');
  const subjectField = message.headers.find((h) => h.key === 'subject');

  const isForward = message.kind === 'forwarded';

  return (
    <section
      aria-label={message.title}
      className="rounded-xl bg-light-surface-container-low/80 border-l-[3px] border-light-primary/65 overflow-hidden flex flex-col"
    >
      {/* Card Header Bar (Clickable to collapse/expand) */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-gutter-md px-4 py-3 text-left hover:bg-light-surface-container/60 transition-colors duration-state-change cursor-pointer"
      >
        <div className="flex items-center gap-gutter-sm min-w-0">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-light-primary/12 text-light-primary shrink-0">
            <span className="material-symbols-outlined text-body-md" aria-hidden="true">
              {isForward ? 'forward' : 'format_quote'}
            </span>
          </span>
          <span className="font-label text-label-md text-light-primary shrink-0">
            {index > 0 ? `更早的${message.title}` : message.title}
          </span>
          {!expanded && (fromField || message.attribution) && (
            <span className="font-body text-body-sm text-light-on-surface-variant truncate">
              · {fromField ? fromField.value : message.attribution}
              {dateField ? ` (${dateField.value})` : ''}
            </span>
          )}
        </div>

        <span className="inline-flex items-center gap-1 font-label text-label-sm text-light-on-surface-variant shrink-0">
          <span>{expanded ? '收起' : '展开'}</span>
          <span
            className={`material-symbols-outlined text-title-md transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          >
            expand_more
          </span>
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 flex flex-col gap-3.5">
          {/* Attribution line (e.g. "在 2026年11月9日 ... 写道：") */}
          {message.attribution && (
            <p className="font-body text-body-sm text-light-on-surface-variant">
              {message.attribution}
            </p>
          )}

          {/* Structured Original Email Metadata Card */}
          {message.headers.length > 0 && (
            <dl className="rounded-lg bg-light-surface-container-lowest/90 px-3.5 py-2.5 flex flex-col gap-1.5 border border-light-outline-variant/25">
              {message.headers.map((h, hIdx) => (
                <div
                  key={`${h.key}-${hIdx}`}
                  className="flex items-baseline gap-3 text-body-sm leading-snug"
                >
                  <dt className="w-16 shrink-0 font-label text-label-md text-light-on-surface-variant">
                    {h.label}
                  </dt>
                  <dd
                    className={`min-w-0 flex-1 break-words ${
                      h.key === 'date'
                        ? 'font-mono text-mono-sm text-light-on-surface-variant tabular-nums'
                        : h.key === 'from' || h.key === 'subject'
                        ? 'font-medium text-light-on-surface'
                        : 'text-light-on-surface/90'
                    }`}
                  >
                    {h.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {/* Original Email Body */}
          {message.body.length > 0 ? (
            <div className="font-body text-body-md text-light-on-surface leading-relaxed flex flex-col gap-2.5 pt-0.5">
              {message.body.map((p, pIdx) => (
                <p key={pIdx}>{renderSafeInlineLinks(p)}</p>
              ))}
            </div>
          ) : (
            !subjectField && (
              <p className="font-body text-body-sm text-light-on-surface-variant italic">
                （原邮件无额外纯文本内容）
              </p>
            )
          )}

          {/* Quoted Sender Signature */}
          {message.signature.length > 0 && (
            <SignatureBlock lines={message.signature} compact />
          )}
        </div>
      )}
    </section>
  );
};

export const EmailBodyRenderer: React.FC<EmailBodyRendererProps> = ({
  emailId,
  subject,
  paragraphs,
  signoff,
}) => {
  const parsed = useMemo(
    () => parseEmailThread(paragraphs, subject),
    [paragraphs, subject]
  );

  const hasQuoted = parsed.quotedMessages.length > 0;
  const hasPrimaryProse = parsed.primaryBody.length > 0;

  return (
    <div className="max-w-[82ch] flex flex-col gap-5">
      {/* Primary Sender Message */}
      {(hasPrimaryProse || parsed.primarySignature.length > 0 || signoff) && (
        <div className="flex flex-col gap-3">
          {hasPrimaryProse ? (
            <div className="font-body text-body-lg text-light-on-surface text-pretty flex flex-col gap-gutter-md leading-relaxed">
              {parsed.primaryBody.map((p, idx) => (
                <p key={idx}>{renderSafeInlineLinks(p)}</p>
              ))}
            </div>
          ) : (
            hasQuoted && (
              <div className="inline-flex items-center gap-1.5 font-label text-label-md text-light-on-surface-variant">
                <span className="material-symbols-outlined text-title-md text-light-primary" aria-hidden="true">
                  forward
                </span>
                <span>发件人直接转发了以下邮件（未附加留言）</span>
              </div>
            )
          )}

          {parsed.primarySignature.length > 0 && (
            <SignatureBlock lines={parsed.primarySignature} />
          )}

          {signoff && (
            <p className="font-body text-body-md text-light-on-surface-variant whitespace-pre-line">
              {cleanMailText(signoff)}
            </p>
          )}
        </div>
      )}

      {/* Forwarded / Quoted Message Cards */}
      {hasQuoted && (
        <div className="flex flex-col gap-4" key={emailId}>
          {parsed.quotedMessages.map((qm, idx) => (
            <QuotedMessageCard
              key={`${emailId}-q-${idx}`}
              message={qm}
              index={idx}
              defaultExpanded={idx === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
};

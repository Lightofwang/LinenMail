import React, { useMemo, useState } from 'react';
import { DraftItem } from '../types/mail';

interface DraftsViewProps {
  drafts: DraftItem[];
  searchQuery: string;
  onEditDraft: (draft: DraftItem) => void;
  onDeleteDraft: (id: string) => void;
  onNewCompose: () => void;
}

export const DraftsView: React.FC<DraftsViewProps> = ({
  drafts,
  searchQuery,
  onEditDraft,
  onDeleteDraft,
  onNewCompose,
}) => {
  const [activeDraftId, setActiveDraftId] = useState<string>(drafts[0]?.id || '');

  const filteredDrafts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return drafts;
    return drafts.filter(
      (d) =>
        d.subject.toLowerCase().includes(q) ||
        d.body.toLowerCase().includes(q) ||
        d.recipients.some((r) => r.toLowerCase().includes(q)) ||
        d.cc.toLowerCase().includes(q)
    );
  }, [drafts, searchQuery]);

  const activeDraft = useMemo(() => {
    return (
      filteredDrafts.find((d) => d.id === activeDraftId) ||
      filteredDrafts[0] ||
      null
    );
  }, [filteredDrafts, activeDraftId]);

  return (
    <main className="flex-1 min-h-0 flex flex-col lg:flex-row gap-5 overflow-hidden">
      {/* Left Column: Drafts List */}
      <section
        aria-label="草稿列表"
        className="w-full lg:w-[340px] xl:w-[420px] 2xl:w-[460px] shrink-0 flex flex-col gap-3 min-h-0 h-full"
      >
        <div className="shrink-0 flex items-center justify-between px-1">
          <h1 className="font-headline text-headline-lg text-light-on-surface">草稿箱</h1>
          <span className="font-label text-label-md text-light-on-surface-variant tabular-nums">
            共 {drafts.length} 封草稿
          </span>
        </div>

        <ul
          className="flex-1 min-h-0 overflow-y-auto pr-1.5 linen-scroll flex flex-col gap-1.5"
          role="listbox"
          aria-label="草稿列表"
        >
          {filteredDrafts.length === 0 ? (
            <li className="py-14 px-gutter-lg text-center rounded-xl bg-light-surface-container-low/60 flex flex-col items-center gap-gutter-sm">
              <span
                className="material-symbols-outlined text-display-lg text-light-on-surface-variant"
                aria-hidden="true"
              >
                drafts
              </span>
              <p className="font-body text-body-md text-light-on-surface-variant">
                {searchQuery.trim() ? '未找到匹配的草稿' : '草稿箱空空如也'}
              </p>
              {!searchQuery.trim() && (
                <button
                  type="button"
                  onClick={onNewCompose}
                  className="mt-1 inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container font-label text-label-md transition-colors duration-state-change cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                    edit_square
                  </span>
                  <span>写一封新邮件</span>
                </button>
              )}
            </li>
          ) : (
            filteredDrafts.map((draft) => {
              const isActive = draft.id === activeDraft?.id;
              const rcptText =
                draft.recipients.length > 0
                  ? draft.recipients.join(', ')
                  : '（未填写收件人）';
              const subjectText = draft.subject.trim() || '（无主题）';
              const previewText =
                draft.body
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .find(Boolean) || '（暂无正文内容）';

              return (
                <li
                  key={draft.id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => setActiveDraftId(draft.id)}
                  onDoubleClick={() => onEditDraft(draft)}
                  className={`group relative flex items-start gap-gutter-md p-gutter-md rounded-lg cursor-pointer transition-colors duration-state-change ${
                    isActive
                      ? 'bg-light-surface-container-lowest shadow-[0_4px_16px_-4px_rgba(35,25,20,0.06)]'
                      : 'hover:bg-light-surface-container-low'
                  }`}
                >
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-light-surface-container-low text-light-primary shrink-0">
                    <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                      edit_note
                    </span>
                  </span>

                  <div className="flex-1 min-w-0 flex flex-col gap-gutter-xs">
                    <div className="flex items-center justify-between gap-gutter-sm">
                      <span className="font-title text-title-md text-light-on-surface truncate">
                        {rcptText}
                      </span>
                      <div className="relative flex items-center justify-end shrink-0 min-w-[58px] h-6">
                        <time className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums transition-opacity duration-150 group-hover:opacity-0">
                          {draft.updatedAt}
                        </time>
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-150">
                          <button
                            type="button"
                            aria-label="继续编辑"
                            title="继续编辑"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditDraft(draft);
                            }}
                            className="w-6 h-6 rounded-full inline-flex items-center justify-center text-light-primary hover:bg-light-surface-container cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-body-lg" aria-hidden="true">
                              edit
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label="删除草稿"
                            title="删除草稿"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteDraft(draft.id);
                            }}
                            className="w-6 h-6 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-error-container hover:text-light-on-error-container cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-body-lg" aria-hidden="true">
                              delete_outline
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <p className="font-body text-body-md font-medium text-light-on-surface truncate">
                      {subjectText}
                    </p>

                    <div className="flex items-center justify-between gap-gutter-sm">
                      <p className="font-body text-body-sm text-light-on-surface-variant truncate">
                        {previewText}
                      </p>
                      {draft.attachments.length > 0 && (
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
      </section>

      {/* Right Column: Draft Preview & Action Sheet */}
      <article
        aria-label="草稿详情预览"
        className="flex-1 min-w-0 h-full min-h-0 bg-light-surface-container-lowest rounded-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col overflow-hidden"
      >
        {!activeDraft ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-gutter-sm text-center p-8">
            <span className="material-symbols-outlined text-display-lg text-light-on-surface-variant">
              drafts
            </span>
            <p className="font-body text-body-md text-light-on-surface-variant">
              选择左侧草稿预览，或点击「写邮件」开始起草新信件
            </p>
          </div>
        ) : (
          <>
            {/* Pinned Draft Header */}
            <div className="shrink-0 px-7 pt-6 pb-4 flex flex-col gap-4 border-b border-light-surface-container-high">
              <div className="flex items-center justify-between gap-gutter-md">
                <div className="flex items-center gap-gutter-sm">
                  <span className="inline-flex items-center gap-1 px-gutter-md py-gutter-xs rounded-full bg-light-secondary-container text-light-on-secondary-container font-label text-label-md">
                    <span className="material-symbols-outlined text-body-md" aria-hidden="true">
                      edit_note
                    </span>
                    <span>草稿</span>
                  </span>
                  <span className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums">
                    保存于 {activeDraft.updatedAt}
                  </span>
                </div>

                <div className="flex items-center gap-gutter-sm">
                  <button
                    type="button"
                    onClick={() => onEditDraft(activeDraft)}
                    className="inline-flex items-center gap-gutter-xs px-gutter-lg py-gutter-xs rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container font-label text-label-md transition-colors duration-state-change cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                      edit
                    </span>
                    <span>继续编辑</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteDraft(activeDraft.id)}
                    aria-label="删除此草稿"
                    title="删除草稿"
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant hover:bg-light-error-container hover:text-light-on-error-container transition-colors duration-state-change cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                      delete_outline
                    </span>
                  </button>
                </div>
              </div>

              <h2 className="font-headline text-headline-lg text-light-on-surface text-balance">
                {activeDraft.subject.trim() || '（无主题）'}
              </h2>

              <dl className="flex flex-col gap-1 text-body-sm">
                <div className="flex items-baseline gap-3">
                  <dt className="w-12 shrink-0 font-label text-label-md text-light-on-surface-variant">
                    收件人
                  </dt>
                  <dd className="text-light-on-surface">
                    {activeDraft.recipients.length > 0
                      ? activeDraft.recipients.join(', ')
                      : '（尚未填写收件人）'}
                  </dd>
                </div>
                {activeDraft.cc.trim() && (
                  <div className="flex items-baseline gap-3">
                    <dt className="w-12 shrink-0 font-label text-label-md text-light-on-surface-variant">
                      抄送
                    </dt>
                    <dd className="text-light-on-surface">{activeDraft.cc}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Scrollable Draft Body & Attachments */}
            <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 linen-scroll flex flex-col gap-6">
              {activeDraft.body.trim() ? (
                <div className="max-w-[82ch] font-body text-body-lg text-light-on-surface leading-relaxed whitespace-pre-wrap">
                  {activeDraft.body}
                </div>
              ) : (
                <p className="font-body text-body-md text-light-on-surface-variant italic">
                  （暂无正文内容，点击右上角「继续编辑」开始撰写）
                </p>
              )}

              {activeDraft.attachments.length > 0 && (
                <div className="flex flex-wrap items-center gap-gutter-sm pt-2">
                  {activeDraft.attachments.map((att, idx) => (
                    <div
                      key={att.id || `${att.name}-${idx}`}
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </article>
    </main>
  );
};

import React, { useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { ComposePrefill, ContactAttachment, ContactItem } from '../types/mail';

interface ContactsViewProps {
  contacts: ContactItem[];
  searchQuery: string;
  onToggleStarContact: (contact: ContactItem) => void;
  onComposeToContact: (prefill: ComposePrefill) => void;
  onOpenEmailInInbox: (emailId?: string) => void;
  onDownloadContactAttachment: (att: ContactAttachment) => Promise<string>;
}

type ContactGroup = 'all' | 'starred' | 'team' | 'partner';

export const ContactsView: React.FC<ContactsViewProps> = ({
  contacts,
  searchQuery,
  onToggleStarContact,
  onComposeToContact,
  onOpenEmailInInbox,
  onDownloadContactAttachment,
}) => {
  const [activeContactId, setActiveContactId] = useState(contacts[0]?.id || '');
  const [currentGroup, setCurrentGroup] = useState<ContactGroup>('all');
  const [currentTab, setCurrentTab] = useState<'attachments' | 'threads'>('attachments');
  const [downloadToast, setDownloadToast] = useState<string | null>(null);

  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (currentGroup === 'starred' && !c.starred) return false;
      if (currentGroup === 'team' && c.group !== 'team') return false;
      if (currentGroup === 'partner' && c.group !== 'partner') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.attachments.some((a) => a.name.toLowerCase().includes(q))
        );
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

  return (
    <main className="grid grid-cols-12 gap-gutter-xl flex-1 items-start">
      {/* Left Column: Contacts Stream */}
      <section aria-label="联系人列表" className="col-span-12 lg:col-span-5 flex flex-col gap-gutter-md">
        <div className="flex flex-col gap-gutter-md px-gutter-xs">
          <div className="flex items-center justify-between">
            <h1 className="font-headline text-headline-lg text-light-on-surface">联系人与附件</h1>
            <span className="font-label text-label-md text-light-on-surface-variant tabular-nums">
              {filteredContacts.length} 位常用联系人
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-gutter-sm" role="group" aria-label="联系人筛选">
            {(
              [
                { id: 'all', label: '全部联系人' },
                { id: 'starred', label: '星标常用' },
                { id: 'team', label: '团队协作' },
                { id: 'partner', label: '外部伙伴' },
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

        <ul className="flex flex-col gap-gutter-xs" role="listbox" aria-label="联系人列表">
          {filteredContacts.map((c) => {
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
                      {c.role}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end shrink-0">
                  <span className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums">
                    {c.attachments.length} 个附件
                  </span>
                  <span className="font-label text-label-sm text-light-on-surface-variant tabular-nums">
                    {c.lastActive}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Right Column: Contact Detail & Attachment History Hub */}
      <article
        aria-label="联系人往来附件中心"
        className="col-span-12 lg:col-span-7 bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-lg min-h-[760px]"
      >
        {activeContact && (
          <>
            {/* Contact Identity Header */}
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex items-center gap-gutter-md">
                <Avatar
                  src={activeContact.avatarImg}
                  initials={activeContact.initials}
                  alt={activeContact.name}
                  size="lg"
                />
                <div className="flex flex-col gap-gutter-xs">
                  <div className="flex items-center gap-gutter-sm">
                    <h2 className="font-headline text-headline-md text-light-on-surface">
                      {activeContact.name}
                    </h2>
                    <span className="px-gutter-sm py-0.5 rounded-full bg-light-secondary-container text-light-on-secondary-container font-label text-label-sm">
                      {activeContact.groupLabel}
                    </span>
                  </div>
                  <p className="font-body text-body-sm text-light-on-surface-variant">
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
              <div role="tabpanel" className="flex flex-col gap-gutter-sm flex-1">
                {activeContact.attachments.map((att, idx) => (
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
                ))}
              </div>
            ) : (
              /* Threads Panel */
              <div role="tabpanel" className="flex flex-col gap-gutter-sm flex-1">
                {activeContact.threads.map((t, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onOpenEmailInInbox(t.emailId)}
                    className="text-left flex flex-col gap-gutter-xs p-gutter-md rounded-lg bg-light-surface-container-low/70 hover:bg-light-surface-container-low transition-colors duration-state-change cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-gutter-md w-full">
                      <span className="font-title text-title-md text-light-on-surface truncate">
                        {t.subject}
                      </span>
                      <time className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums shrink-0">
                        {t.time}
                      </time>
                    </div>
                    <p className="font-body text-body-sm text-light-on-surface-variant truncate w-full">
                      {t.snippet}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </article>
    </main>
  );
};

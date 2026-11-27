import React, { useMemo, useState } from 'react';
import { SwitchToggle } from '../components/SwitchToggle';
import { LabelItem, SmartFolderItem } from '../types/mail';

interface SmartFoldersViewProps {
  smartFolders: SmartFolderItem[];
  labels: LabelItem[];
  searchQuery: string;
  onToggleFolder: (id: string) => void;
  onAddFolder: (folder: SmartFolderItem) => void;
  onUpdateFolder: (id: string, name: string, conditions: string[]) => void;
  onAddLabel: (name: string) => void;
  onRenameLabel: (id: string, name: string) => void;
  onViewTagInInbox: (tag: string) => void;
}

export const SmartFoldersView: React.FC<SmartFoldersViewProps> = ({
  smartFolders,
  labels,
  searchQuery,
  onToggleFolder,
  onAddFolder,
  onUpdateFolder,
  onAddLabel,
  onRenameLabel,
  onViewTagInInbox,
}) => {
  const [selectedFolderId, setSelectedFolderId] = useState(smartFolders[0]?.id || '');
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [folderRuleInput, setFolderRuleInput] = useState('');

  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelNameInput, setLabelNameInput] = useState('');

  const filteredFolders = useMemo(() => {
    if (!searchQuery.trim()) return smartFolders;
    const q = searchQuery.trim().toLowerCase();
    return smartFolders.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.conditions.some((c) => c.toLowerCase().includes(q))
    );
  }, [smartFolders, searchQuery]);

  const filteredLabels = useMemo(() => {
    if (!searchQuery.trim()) return labels;
    const q = searchQuery.trim().toLowerCase();
    return labels.filter((l) => l.name.toLowerCase().includes(q));
  }, [labels, searchQuery]);

  const selectedFolder =
    smartFolders.find((f) => f.id === selectedFolderId) || smartFolders[0] || null;
  const activeCount = smartFolders.filter((f) => f.enabled).length;

  const openNewFolderModal = () => {
    setEditingFolderId(null);
    setFolderNameInput('');
    setFolderRuleInput('');
    setFolderModalOpen(true);
  };

  const openEditFolderModal = () => {
    if (!selectedFolder) return;
    setEditingFolderId(selectedFolder.id);
    setFolderNameInput(selectedFolder.name);
    setFolderRuleInput(selectedFolder.conditions.join(' · '));
    setFolderModalOpen(true);
  };

  const handleSaveFolder = () => {
    const name = folderNameInput.trim();
    if (!name) {
      setFolderModalOpen(false);
      return;
    }
    const conditions = folderRuleInput
      .split(/[·,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const finalConditions = conditions.length > 0 ? conditions : ['自定义关键词匹配'];

    if (editingFolderId) {
      onUpdateFolder(editingFolderId, name, finalConditions);
    } else {
      const newId = `sf-${Date.now()}`;
      onAddFolder({
        id: newId,
        name,
        icon: 'folder_special',
        total: 0,
        unread: 0,
        enabled: true,
        tag: name.slice(0, 4),
        conditions: finalConditions,
        actionText: `自动归集到「${name}」，并标记优先浏览。`,
      });
      setSelectedFolderId(newId);
    }
    setFolderModalOpen(false);
  };

  const handleSaveLabel = () => {
    const name = labelNameInput.trim();
    if (name) {
      if (editingLabelId) {
        onRenameLabel(editingLabelId, name);
      } else {
        onAddLabel(name);
      }
    }
    setLabelModalOpen(false);
  };

  return (
    <>
      {/* Page Title & Actions */}
      <section className="flex flex-wrap items-center justify-between gap-gutter-lg px-gutter-xs">
        <div className="flex flex-col gap-gutter-xs">
          <h1 className="font-headline text-headline-lg text-light-on-surface text-balance">
            标签分类与智能文件夹
          </h1>
          <p className="font-body text-body-md text-light-on-surface-variant text-pretty">
            按发件人、主题关键词与附件类型自动归集邮件，保持主收件箱专注清爽。
          </p>
        </div>

        <div className="flex items-center gap-gutter-sm shrink-0">
          <button
            type="button"
            onClick={() => {
              setEditingLabelId(null);
              setLabelNameInput('');
              setLabelModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface transition-colors duration-state-change ease-state-change hover:bg-light-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary cursor-pointer"
          >
            <span className="material-symbols-outlined text-title-md" aria-hidden="true">
              label
            </span>
            <span className="font-label text-label-lg">新建标签</span>
          </button>

          <button
            type="button"
            onClick={openNewFolderModal}
            className="inline-flex items-center justify-center gap-gutter-xs px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary transition-colors duration-state-change ease-state-change hover:bg-light-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-title-md" aria-hidden="true">
              create_new_folder
            </span>
            <span className="font-label text-label-lg">新建智能文件夹</span>
          </button>
        </div>
      </section>

      {/* Main 2-Column Editorial Workspace */}
      <main className="grid grid-cols-12 gap-gutter-xl flex-1 items-start">
        {/* Left Column: Smart Folders Stream */}
        <section aria-label="智能文件夹列表" className="col-span-12 lg:col-span-7 flex flex-col gap-gutter-md">
          <div className="flex items-center justify-between px-gutter-xs">
            <h2 className="font-headline text-headline-md text-light-on-surface">智能文件夹</h2>
            <span className="font-label text-label-md text-light-on-surface-variant tabular-nums">
              {activeCount} 条规则运行中
            </span>
          </div>

          <ul className="flex flex-col gap-gutter-md" role="listbox" aria-label="智能文件夹">
            {filteredFolders.map((folder) => {
              const isSelected = folder.id === selectedFolder?.id;
              return (
                <li
                  key={folder.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`folder-card flex items-start justify-between gap-gutter-lg p-gutter-lg rounded-xl cursor-pointer transition-colors duration-state-change ${
                    isSelected
                      ? 'bg-light-surface-container-lowest shadow-[0_12px_36px_-8px_rgba(35,25,20,0.08)] ring-1 ring-light-outline-variant/40'
                      : 'bg-light-surface-container-lowest/70 hover:bg-light-surface-container-lowest'
                  }`}
                >
                  <div className="flex items-start gap-gutter-md min-w-0">
                    <span className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-light-surface-container-low text-light-primary shrink-0">
                      <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                        {folder.icon}
                      </span>
                    </span>
                    <div className="flex flex-col gap-gutter-xs min-w-0">
                      <div className="flex items-center gap-gutter-sm">
                        <h3 className="font-title text-title-md text-light-on-surface">
                          {folder.name}
                        </h3>
                        {folder.unread > 0 && (
                          <span className="font-mono text-mono-sm tabular-nums px-gutter-sm py-0.5 rounded-full bg-light-secondary-container text-light-on-secondary-container">
                            {folder.unread} 未读
                          </span>
                        )}
                      </div>
                      <p className="font-body text-body-sm text-light-on-surface-variant truncate">
                        {folder.conditions.join(' · ')}
                      </p>
                      <span className="font-label text-label-md text-light-on-surface-variant tabular-nums">
                        共匹配 {folder.total} 封邮件
                      </span>
                    </div>
                  </div>

                  <SwitchToggle
                    checked={folder.enabled}
                    onChange={() => onToggleFolder(folder.id)}
                    ariaLabel={`切换 ${folder.name} 自动规则`}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        {/* Right Column: Labels & Rule Inspector */}
        <aside aria-label="个人标签与规则预览" className="col-span-12 lg:col-span-5 flex flex-col gap-gutter-lg">
          {/* Rule Preview Card */}
          {selectedFolder && (
            <section className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md">
              <div className="flex items-center justify-between gap-gutter-sm">
                <span className="inline-flex items-center px-gutter-md py-gutter-xs rounded-full bg-light-secondary-container text-light-on-secondary-container font-label text-label-md">
                  规则详情预览
                </span>
                <button
                  type="button"
                  onClick={openEditFolderModal}
                  className="inline-flex items-center gap-gutter-xs font-label text-label-md text-light-primary hover:underline cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                    tune
                  </span>
                  <span>调整条件</span>
                </button>
              </div>

              <h2 className="font-headline text-headline-md text-light-on-surface">
                {selectedFolder.name}
              </h2>

              <div className="flex flex-col gap-gutter-sm bg-light-surface-container-low rounded-lg p-gutter-md">
                <div className="flex items-center justify-between">
                  <span className="font-label text-label-md text-light-on-surface-variant">
                    匹配条件（满足任意一项）
                  </span>
                  <span className="font-mono text-mono-sm text-light-secondary tabular-nums">
                    已归集 {selectedFolder.total} 封
                  </span>
                </div>
                <div className="flex flex-wrap gap-gutter-xs">
                  {selectedFolder.conditions.map((cond, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center px-gutter-md py-gutter-xs rounded-full bg-light-surface-container-lowest text-light-on-surface font-label text-label-md"
                    >
                      {cond}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant">
                  自动执行动作
                </span>
                <p className="font-body text-body-md text-light-on-surface">
                  {selectedFolder.actionText}
                </p>
              </div>

              <div className="pt-gutter-xs">
                <button
                  type="button"
                  onClick={() => onViewTagInInbox(selectedFolder.tag)}
                  className="inline-flex items-center gap-gutter-xs font-label text-label-md text-light-primary hover:underline cursor-pointer"
                >
                  <span>在收件箱查看此类邮件</span>
                  <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                    arrow_forward
                  </span>
                </button>
              </div>
            </section>
          )}

          {/* Personal Labels Card */}
          <section className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md">
            <div className="flex items-center justify-between">
              <h2 className="font-headline text-headline-md text-light-on-surface">个人标签</h2>
              <span className="font-label text-label-md text-light-on-surface-variant tabular-nums">
                {labels.length} 个标签
              </span>
            </div>

            <ul className="flex flex-col gap-gutter-xs">
              {filteredLabels.map((lbl) => (
                <li
                  key={lbl.id}
                  onClick={() => onViewTagInInbox(lbl.name)}
                  className="group flex items-center justify-between gap-gutter-md px-gutter-md py-gutter-sm rounded-lg hover:bg-light-surface-container-low transition-colors duration-state-change cursor-pointer"
                >
                  <div className="flex items-center gap-gutter-sm">
                    <span className={`w-2.5 h-2.5 rounded-full ${lbl.dotClass}`} aria-hidden="true" />
                    <span className="font-body text-body-md text-light-on-surface">{lbl.name}</span>
                  </div>
                  <div className="flex items-center gap-gutter-sm">
                    <span className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums">
                      {lbl.count}
                    </span>
                    <button
                      type="button"
                      aria-label={`编辑标签 ${lbl.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingLabelId(lbl.id);
                        setLabelNameInput(lbl.name);
                        setLabelModalOpen(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-7 h-7 rounded-full text-light-on-surface-variant hover:bg-light-surface-container transition-opacity duration-state-change cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                        edit
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </main>

      {/* New / Edit Smart Folder Modal */}
      {folderModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-light-scrim/30 p-gutter-lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="folder-modal-title"
          onClick={() => setFolderModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_24px_60px_-12px_rgba(35,25,20,0.18)] flex flex-col gap-gutter-md"
          >
            <div className="flex items-center justify-between">
              <h2 id="folder-modal-title" className="font-headline text-headline-md text-light-on-surface">
                {editingFolderId ? '调整智能文件夹条件' : '新建智能文件夹'}
              </h2>
              <button
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setFolderModalOpen(false)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant hover:bg-light-surface-container transition-colors duration-state-change cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <div className="flex flex-col gap-gutter-sm">
              <label className="flex flex-col gap-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant">
                  文件夹名称
                </span>
                <input
                  type="text"
                  value={folderNameInput}
                  onChange={(e) => setFolderNameInput(e.target.value)}
                  placeholder="例如：重要客户往来"
                  className="w-full px-gutter-md py-gutter-sm rounded-md bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-1 focus:ring-light-primary focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant">
                  匹配关键词或发件人
                </span>
                <input
                  type="text"
                  value={folderRuleInput}
                  onChange={(e) => setFolderRuleInput(e.target.value)}
                  placeholder="例如：来自 @client.com · 主题包含 合同"
                  className="w-full px-gutter-md py-gutter-sm rounded-md bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-1 focus:ring-light-primary focus:outline-none"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-gutter-sm pt-gutter-sm">
              <button
                type="button"
                onClick={() => setFolderModalOpen(false)}
                className="inline-flex items-center justify-center px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-lg transition-colors duration-state-change cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveFolder}
                className="inline-flex items-center justify-center px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container font-label text-label-lg transition-colors duration-state-change cursor-pointer"
              >
                保存规则
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New / Edit Label Modal */}
      {labelModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-light-scrim/30 p-gutter-lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="label-modal-title"
          onClick={() => setLabelModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_24px_60px_-12px_rgba(35,25,20,0.18)] flex flex-col gap-gutter-md"
          >
            <div className="flex items-center justify-between">
              <h2 id="label-modal-title" className="font-headline text-headline-md text-light-on-surface">
                {editingLabelId ? '编辑标签名称' : '新建个人标签'}
              </h2>
              <button
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setLabelModalOpen(false)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant hover:bg-light-surface-container cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <label className="flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">标签名称</span>
              <input
                type="text"
                value={labelNameInput}
                onChange={(e) => setLabelNameInput(e.target.value)}
                placeholder="例如：重要合同"
                className="w-full px-gutter-md py-gutter-sm rounded-md bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-1 focus:ring-light-primary focus:outline-none"
              />
            </label>
            <div className="flex items-center justify-end gap-gutter-sm pt-gutter-sm">
              <button
                type="button"
                onClick={() => setLabelModalOpen(false)}
                className="px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-lg cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveLabel}
                className="px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container font-label text-label-lg cursor-pointer"
              >
                保存标签
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

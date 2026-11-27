import React, { useMemo, useState } from 'react';
import { SwitchToggle } from '../components/SwitchToggle';
import { mailService, matchesFilterRule } from '../services/mailService';
import {
  AppRoute,
  EmailItem,
  FilterCondition,
  FilterRuleItem,
  ImapFolderItem,
  LabelItem,
  LlmProfile,
  SystemSettingsState,
} from '../types/mail';

interface SystemSettingsViewProps {
  emails: EmailItem[];
  imapFolders: ImapFolderItem[];
  filters: FilterRuleItem[];
  labels: LabelItem[];
  llmProfiles: LlmProfile[];
  systemSettings: SystemSettingsState;
  onBackToInbox: () => void;
  onNavigate: (route: AppRoute) => void;
  onToggleFilter: (id: string) => void;
  onAddFilter: (rule: FilterRuleItem, applyExisting: boolean) => Promise<number>;
  onRunFilter: (id: string) => Promise<number>;
  onDeleteFilter: (id: string) => void;
  onAddLabel: (name: string) => void;
  onRenameLabel: (id: string, name: string) => void;
  onDeleteLabel: (id: string) => void;
  onViewTagInInbox: (tag: string) => void;
  onViewFolderInInbox: (folderKey: string) => void;
  onActivateLlm: (id: string) => void;
  onAddLlm: (profile: LlmProfile) => void;
  onUpdateSystemSettings: (next: Partial<SystemSettingsState>) => void;
  onClearCache: () => Promise<void>;
}

const LLM_PRESETS = {
  deepseek: {
    label: 'DeepSeek',
    name: 'DeepSeek V3 · 个人工作区',
    url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temp: 0.3,
  },
  openai: {
    label: 'OpenAI 官方',
    name: 'OpenAI 官方接口',
    url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    temp: 0.3,
  },
  qwen: {
    label: '通义千问 DashScope',
    name: '通义千问 DashScope',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    temp: 0.4,
  },
  ollama: {
    label: '本地 Ollama',
    name: '本地 Ollama 私有模型',
    url: 'http://localhost:11434/v1',
    model: 'qwen2.5:14b',
    temp: 0.2,
  },
  custom: {
    label: '自定义网关',
    name: '自定义 OpenAI 兼容网关',
    url: 'https://',
    model: '',
    temp: 0.3,
  },
} as const;

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  emails,
  imapFolders,
  filters,
  labels,
  llmProfiles,
  systemSettings,
  onBackToInbox,
  onNavigate,
  onToggleFilter,
  onAddFilter,
  onRunFilter,
  onDeleteFilter,
  onAddLabel,
  onRenameLabel,
  onDeleteLabel,
  onViewTagInInbox,
  onViewFolderInInbox,
  onActivateLlm,
  onAddLlm,
  onUpdateSystemSettings,
  onClearCache,
}) => {
  const [activeNav, setActiveNav] = useState('filters-section');
  const [savedToast, setSavedToast] = useState(false);
  const [blockInput, setBlockInput] = useState('');
  const [notifyToast, setNotifyToast] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  // Auto-Filter Rule Builder / Editor Modal State
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleEnabled, setEditingRuleEnabled] = useState(true);
  const [editingRuleHits, setEditingRuleHits] = useState(0);
  const [editingFallbackFolderName, setEditingFallbackFolderName] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [logicMode, setLogicMode] = useState<'AND' | 'OR'>('OR');
  const [conditions, setConditions] = useState<FilterCondition[]>([
    { field: '发件人', op: '包含', value: '' },
  ]);
  const [hasAttachmentCheck, setHasAttachmentCheck] = useState(false);
  const [actionTagCheck, setActionTagCheck] = useState(true);
  const [actionTagValue, setActionTagValue] = useState('');
  const [actionFolderCheck, setActionFolderCheck] = useState(false);
  const [actionFolderKey, setActionFolderKey] = useState('');
  const [actionArchiveCheck, setActionArchiveCheck] = useState(false);
  const [actionReadCheck, setActionReadCheck] = useState(false);
  const [actionStarCheck, setActionStarCheck] = useState(false);
  const [applyExistingCheck, setApplyExistingCheck] = useState(true);
  const [ruleFormError, setRuleFormError] = useState<string | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [ruleToast, setRuleToast] = useState<string | null>(null);

  const selectableFolders = useMemo(() => {
    const custom = imapFolders.filter((f) => f.kind === 'custom');
    const others = imapFolders.filter((f) => f.kind !== 'custom');
    return [...custom, ...others];
  }, [imapFolders]);

  const hasMultipleAccounts = useMemo(() => {
    const set = new Set(imapFolders.map((f) => f.accountId));
    return set.size > 1;
  }, [imapFolders]);

  // Personal Label Modal State
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelNameInput, setLabelNameInput] = useState('');

  // Add Custom LLM Modal State
  const [llmModalOpen, setLlmModalOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<keyof typeof LLM_PRESETS>('deepseek');
  const [llmName, setLlmName] = useState('DeepSeek V3 · 个人工作区');
  const [llmUrl, setLlmUrl] = useState('https://api.deepseek.com/v1');
  const [llmKey, setLlmKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [llmModel, setLlmModel] = useState('deepseek-chat');
  const [llmTemp, setLlmTemp] = useState('0.3');
  const [enableTranslate, setEnableTranslate] = useState(true);
  const [enablePolish, setEnablePolish] = useState(true);
  const [llmConnStatus, setLlmConnStatus] = useState('待验证');
  const [testingLlm, setTestingLlm] = useState(false);

  const activeRuleCount = useMemo(
    () => filters.filter((f) => f.enabled).length,
    [filters]
  );

  const showRuleToast = (msg: string) => {
    setRuleToast(msg);
    setTimeout(() => {
      setRuleToast((curr) => (curr === msg ? null : curr));
    }, 4200);
  };

  const openNewRuleModal = (presetTag?: string) => {
    setEditingRuleId(null);
    setEditingRuleEnabled(true);
    setEditingRuleHits(0);
    setEditingFallbackFolderName(null);
    setRuleFormError(null);
    setRuleName('');
    setLogicMode('OR');
    setConditions([{ field: '发件人', op: '包含', value: '' }]);
    setHasAttachmentCheck(false);
    setActionTagCheck(Boolean(presetTag));
    setActionTagValue(presetTag || '');
    setActionFolderCheck(false);
    setActionFolderKey(selectableFolders[0]?.folderKey || '');
    setActionArchiveCheck(false);
    setActionReadCheck(false);
    setActionStarCheck(false);
    setApplyExistingCheck(true);
    setRuleModalOpen(true);
  };

  const openEditRuleModal = (rule: FilterRuleItem) => {
    setEditingRuleId(rule.id);
    setEditingRuleEnabled(rule.enabled);
    setEditingRuleHits(rule.hits);
    setEditingFallbackFolderName(rule.actionFolderName || null);
    setRuleFormError(null);
    setRuleName(rule.name);
    setLogicMode(rule.logic === 'AND' ? 'AND' : 'OR');
    setConditions(
      rule.conditions && rule.conditions.length > 0
        ? rule.conditions.map((c) => ({ ...c }))
        : [{ field: '发件人', op: '包含', value: '' }]
    );
    setHasAttachmentCheck(Boolean(rule.hasAttachment));
    setActionTagCheck(Boolean(rule.actionTag));
    setActionTagValue(rule.actionTag || '');
    setActionFolderCheck(Boolean(rule.actionFolder));
    setActionFolderKey(rule.actionFolder || selectableFolders[0]?.folderKey || '');
    setActionArchiveCheck(Boolean(rule.actionArchive) && !rule.actionFolder);
    setActionReadCheck(Boolean(rule.actionMarkRead));
    setActionStarCheck(Boolean(rule.actionStar));
    setApplyExistingCheck(true);
    setRuleModalOpen(true);
  };

  // Live summary & match preview for Rule Builder Modal
  const joiner = logicMode === 'AND' ? ' 且 ' : ' 或 ';
  const activeConds = conditions.filter((c) => c.value.trim().length > 0);
  const condText = (activeConds.length > 0 ? activeConds : conditions)
    .map((c) => `${c.field}${c.op} "${c.value || '...'}"`)
    .join(joiner);
  const attText = hasAttachmentCheck
    ? activeConds.length > 0
      ? ' 且包含附件'
      : '包含附件'
    : '';
  const displayCondText =
    activeConds.length > 0 ? `${condText}${attText}` : hasAttachmentCheck ? '包含附件' : condText;
  const cleanTag = actionTagValue.trim();
  const selectedFolderObj = useMemo(
    () => selectableFolders.find((f) => f.folderKey === actionFolderKey) || null,
    [selectableFolders, actionFolderKey]
  );
  const resolvedFolderName =
    selectedFolderObj?.displayName ||
    (actionFolderKey && editingFallbackFolderName ? editingFallbackFolderName : '');
  const effectiveFolderKey =
    actionFolderCheck && actionFolderKey && (selectedFolderObj || editingFallbackFolderName)
      ? actionFolderKey
      : null;
  const effectiveFolderName = effectiveFolderKey ? resolvedFolderName || '目标文件夹' : null;

  const selectedActionLabels = [
    effectiveFolderName ? `直接放入文件夹「${effectiveFolderName}」` : null,
    actionTagCheck && cleanTag ? `添加标签「${cleanTag}」` : null,
    actionArchiveCheck ? '跳过收件箱直接归档' : null,
    actionReadCheck ? '自动标记为已读' : null,
    actionStarCheck ? '星标重点标记' : null,
  ].filter(Boolean) as string[];
  const actionSummary = selectedActionLabels.length
    ? selectedActionLabels.join('、')
    : '暂未选择处理动作';
  const liveRuleSummary = `当邮件满足${logicMode === 'AND' ? '全部' : '任意'}条件（${displayCondText}）时，自动${actionSummary}。`;

  const draftRule: FilterRuleItem = useMemo(
    () => ({
      id: editingRuleId || 'preview',
      name: ruleName.trim() || '新建自动规则',
      condition: displayCondText,
      action: actionSummary,
      hits: editingRuleId ? editingRuleHits : 0,
      enabled: editingRuleId ? editingRuleEnabled : true,
      logic: logicMode,
      conditions: activeConds.length > 0 ? activeConds : conditions,
      hasAttachment: hasAttachmentCheck,
      actionTag: actionTagCheck && cleanTag ? cleanTag : null,
      actionFolder: effectiveFolderKey,
      actionFolderName: effectiveFolderName,
      actionArchive: actionArchiveCheck,
      actionMarkRead: actionReadCheck,
      actionStar: actionStarCheck,
    }),
    [
      editingRuleId,
      editingRuleHits,
      editingRuleEnabled,
      ruleName,
      displayCondText,
      actionSummary,
      logicMode,
      activeConds,
      conditions,
      hasAttachmentCheck,
      actionTagCheck,
      cleanTag,
      effectiveFolderKey,
      effectiveFolderName,
      actionArchiveCheck,
      actionReadCheck,
      actionStarCheck,
    ]
  );

  const liveMatchCount = useMemo(
    () => emails.filter((e) => matchesFilterRule(e, draftRule)).length,
    [emails, draftRule]
  );

  const handleSaveRule = async () => {
    const trimmedName = ruleName.trim();
    const hasConditionVal =
      hasAttachmentCheck || conditions.some((c) => c.value.trim().length > 0);
    if (!hasConditionVal) {
      setRuleFormError('请至少填写一个匹配条件关键词，或勾选「仅对包含附件的邮件生效」。');
      return;
    }
    if (selectedActionLabels.length === 0) {
      setRuleFormError('请至少选择一项自动执行动作（如直接放入文件夹、添加标签、标记已读等）。');
      return;
    }
    setRuleFormError(null);
    setSavingRule(true);
    try {
      const finalName =
        trimmedName ||
        (effectiveFolderName
          ? `自动放入：${effectiveFolderName}`
          : cleanTag
          ? `自动归类：${cleanTag}`
          : `自动规则 ${filters.length + 1}`);
      const nextRule: FilterRuleItem = {
        ...draftRule,
        id: editingRuleId || `flt-${Date.now()}`,
        name: finalName,
        enabled: editingRuleId ? (applyExistingCheck ? true : editingRuleEnabled) : true,
        hits: editingRuleId ? editingRuleHits : 0,
      };
      const matched = await onAddFilter(nextRule, applyExistingCheck);
      setRuleModalOpen(false);
      if (applyExistingCheck) {
        showRuleToast(
          matched > 0
            ? `规则「${finalName}」已保存并立即生效，共处理 ${matched} 封邮件`
            : `规则「${finalName}」已保存，当前暂无匹配的现有邮件`
        );
      } else {
        showRuleToast(`规则「${finalName}」已保存，新邮件到达时自动生效`);
      }
    } catch (err) {
      setRuleFormError(`保存规则失败：${String(err)}`);
    } finally {
      setSavingRule(false);
    }
  };

  const handleRunRuleNow = async (rule: FilterRuleItem) => {
    if (runningRuleId) return;
    setRunningRuleId(rule.id);
    try {
      const matched = await onRunFilter(rule.id);
      showRuleToast(
        matched > 0
          ? `规则「${rule.name}」已立即生效，共处理 ${matched} 封邮件`
          : `规则「${rule.name}」已执行，当前暂无匹配的现有邮件`
      );
    } catch (err) {
      showRuleToast(`执行规则「${rule.name}」失败：${String(err)}`);
    } finally {
      setRunningRuleId(null);
    }
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

  const scrollToSection = (id: string) => {
    setActiveNav(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSaveAll = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2400);
  };

  const handleAddBlock = () => {
    const val = blockInput.trim();
    if (!val || systemSettings.blocklist.includes(val)) return;
    onUpdateSystemSettings({ blocklist: [...systemSettings.blocklist, val] });
    setBlockInput('');
  };

  const handlePresetClick = (key: keyof typeof LLM_PRESETS) => {
    setActivePreset(key);
    const p = LLM_PRESETS[key];
    setLlmName(p.name);
    setLlmUrl(p.url);
    setLlmModel(p.model);
    setLlmTemp(String(p.temp));
    setLlmConnStatus('待验证');
  };

  const handleTestLlm = async () => {
    setTestingLlm(true);
    setLlmConnStatus('正在测试连通性...');
    const start = performance.now();
    try {
      await mailService.invokeLlmChat({
        baseUrl: llmUrl.trim(),
        apiKey: llmKey.trim(),
        model: llmModel.trim() || 'gpt-4o-mini',
        temperature: parseFloat(llmTemp) || 0.3,
        messages: [{ role: 'user', content: 'ping' }],
      });
      const ms = Math.round(performance.now() - start);
      setLlmConnStatus(`连接正常 · ${llmModel.trim() || 'model'} (${ms}ms)`);
    } catch (e) {
      setLlmConnStatus(`连接失败：${String(e).slice(0, 48)}`);
    } finally {
      setTestingLlm(false);
    }
  };

  const handleSaveLlmProfile = () => {
    onAddLlm({
      id: `llm-${Date.now()}`,
      name: llmName.trim() || '自定义 OpenAI 模型',
      baseUrl: llmUrl.trim() || 'https://api.openai.com/v1',
      apiKey: llmKey.trim(),
      hasApiKey: Boolean(llmKey.trim()),
      model: llmModel.trim() || 'gpt-4o-mini',
      temperature: parseFloat(llmTemp) || 0.3,
      active: true,
      enableTranslate,
      enablePolish,
    });
    setLlmKey('');
    setLlmModalOpen(false);
  };

  const basePreview = (llmUrl.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const modelPreview = llmModel.trim() || 'gpt-4o-mini';

  return (
    <div className="min-h-screen w-full bg-light-surface flex flex-col px-6 py-4 gap-6 max-w-[1720px] mx-auto">
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

          <h1 className="font-headline text-title-lg text-light-on-surface">
            系统设置
          </h1>
        </div>

        <div className="flex items-center gap-gutter-md">
          {savedToast && (
            <span className="font-label text-label-md text-light-secondary">设置已保存</span>
          )}
          <button
            type="button"
            onClick={() => onNavigate('account')}
            className="inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change cursor-pointer"
          >
            <span className="material-symbols-outlined text-title-md" aria-hidden="true">
              person
            </span>
            <span>账户与资料</span>
          </button>
          <button
            type="button"
            onClick={handleSaveAll}
            className="inline-flex items-center justify-center gap-gutter-xs px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary transition-colors duration-state-change hover:bg-light-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary focus-visible:ring-offset-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-title-md" aria-hidden="true">
              check
            </span>
            <span className="font-label text-label-lg">保存设置</span>
          </button>
        </div>
      </header>

      {/* Main 2-Column Settings Layout */}
      <main className="w-full grid grid-cols-12 gap-gutter-xl items-start flex-1">
        {/* Left Navigation Rail */}
        <aside className="col-span-12 lg:col-span-3 flex flex-col gap-gutter-md lg:sticky lg:top-24">
          <nav
            aria-label="系统设置分类"
            className="bg-light-surface-container-lowest/80 rounded-xl p-gutter-md flex flex-col gap-gutter-xs"
          >
            {[
              { id: 'filters-section', icon: 'filter_alt', label: '自动过滤规则', count: activeRuleCount },
              { id: 'labels-section', icon: 'label', label: '个人标签', count: labels.length },
              { id: 'llm-section', icon: 'auto_awesome', label: 'AI 大模型配置' },
              { id: 'forwarding-section', icon: 'forward_to_inbox', label: '自动转发与休假' },
              { id: 'blocklist-section', icon: 'block', label: '发件人黑名单' },
              { id: 'sync-section', icon: 'sync', label: '同步与本地缓存' },
            ].map((item) => {
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  className={`flex items-center justify-between gap-gutter-sm px-gutter-md py-gutter-sm rounded-lg font-label text-label-lg transition-colors duration-state-change text-left cursor-pointer ${
                    active
                      ? 'bg-light-surface-container-low text-light-on-surface'
                      : 'text-light-on-surface-variant hover:bg-light-surface-container-low'
                  }`}
                >
                  <span className="flex items-center gap-gutter-sm min-w-0">
                    <span
                      className={`material-symbols-outlined text-title-md shrink-0 ${
                        active ? 'text-light-primary' : ''
                      }`}
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </span>
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span className="font-mono text-mono-sm tabular-nums text-light-on-surface-variant shrink-0">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right Settings Panels */}
        <div className="col-span-12 lg:col-span-9 flex flex-col gap-gutter-lg">
          {/* Section 1: Auto-Filter Rules */}
          <section
            id="filters-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md scroll-mt-24"
          >
            <div className="flex flex-wrap items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <div className="flex items-center gap-gutter-sm">
                  <h2 className="font-headline text-headline-md text-light-on-surface">
                    自动过滤规则
                  </h2>
                  <span className="font-mono text-mono-sm tabular-nums text-light-on-surface-variant">
                    {activeRuleCount} / {filters.length} 条生效中
                  </span>
                </div>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  新邮件到达时自动按发件人、主题、正文或附件条件匹配，并自动放入指定文件夹、添加标签、标记已读、加星或静默归档；也可随时点击「立即生效」对现有邮件重新整理。
                </p>
              </div>

              <button
                type="button"
                onClick={() => openNewRuleModal()}
                className="inline-flex items-center justify-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container transition-colors duration-state-change shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  add
                </span>
                <span className="font-label text-label-lg">新建规则</span>
              </button>
            </div>

            {ruleToast && (
              <div className="flex items-center justify-between gap-gutter-sm px-gutter-md py-gutter-xs rounded-lg bg-light-secondary-container/50 text-light-on-surface">
                <div className="flex items-center gap-gutter-xs min-w-0">
                  <span
                    className="material-symbols-outlined text-title-md text-light-secondary shrink-0"
                    aria-hidden="true"
                  >
                    check_circle
                  </span>
                  <span className="font-body text-body-sm truncate">{ruleToast}</span>
                </div>
                <button
                  type="button"
                  aria-label="关闭提示"
                  onClick={() => setRuleToast(null)}
                  className="w-6 h-6 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container cursor-pointer shrink-0"
                >
                  <span className="material-symbols-outlined text-body-sm" aria-hidden="true">
                    close
                  </span>
                </button>
              </div>
            )}

            {filters.length === 0 ? (
              <div className="py-8 px-gutter-lg rounded-xl bg-light-surface-container-low/60 flex flex-col items-center text-center gap-gutter-sm">
                <span
                  className="material-symbols-outlined text-headline-lg text-light-on-surface-variant"
                  aria-hidden="true"
                >
                  filter_alt
                </span>
                <p className="font-body text-body-sm text-light-on-surface-variant max-w-md">
                  暂未配置自动过滤规则，创建后新邮件到达时将自动完成标签分类或静默归档。
                </p>
                <button
                  type="button"
                  onClick={() => openNewRuleModal()}
                  className="mt-1 inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full bg-light-surface-container-lowest text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                    add
                  </span>
                  <span>创建第一条自动规则</span>
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-gutter-sm">
                {filters.map((rule) => (
                  <li
                    key={rule.id}
                    className="group flex items-start justify-between gap-gutter-md p-gutter-md rounded-xl bg-light-surface-container-low/70 hover:bg-light-surface-container-low transition-colors"
                  >
                    <div className="flex flex-col gap-gutter-xs min-w-0">
                      <div className="flex flex-wrap items-center gap-gutter-sm">
                        <span className="font-title text-title-md text-light-on-surface">
                          {rule.name}
                        </span>
                        <span className="font-mono text-mono-sm tabular-nums text-light-secondary">
                          已命中 {rule.hits} 封
                        </span>
                        {rule.actionFolder && (
                          <button
                            type="button"
                            onClick={() => onViewFolderInInbox(rule.actionFolder!)}
                            className="inline-flex items-center gap-1 text-light-primary hover:underline font-label text-label-sm cursor-pointer"
                          >
                            <span>
                              查看「
                              {rule.actionFolderName ||
                                imapFolders.find((f) => f.folderKey === rule.actionFolder)
                                  ?.displayName ||
                                '目标文件夹'}
                              」
                            </span>
                            <span
                              className="material-symbols-outlined text-body-sm"
                              aria-hidden="true"
                            >
                              arrow_forward
                            </span>
                          </button>
                        )}
                        {rule.actionTag && (
                          <button
                            type="button"
                            onClick={() => onViewTagInInbox(rule.actionTag!)}
                            className="inline-flex items-center gap-1 text-light-primary hover:underline font-label text-label-sm cursor-pointer"
                          >
                            <span>查看「{rule.actionTag}」邮件</span>
                            <span
                              className="material-symbols-outlined text-body-sm"
                              aria-hidden="true"
                            >
                              arrow_forward
                            </span>
                          </button>
                        )}
                      </div>
                      <p className="font-body text-body-sm text-light-on-surface-variant">
                        条件：{rule.condition}
                      </p>
                      <p className="font-body text-body-sm text-light-on-surface">
                        动作：{rule.action}
                      </p>
                    </div>

                    <div className="flex items-center gap-gutter-xs shrink-0">
                      <button
                        type="button"
                        disabled={runningRuleId !== null}
                        onClick={() => void handleRunRuleNow(rule)}
                        title="立即对所有现有邮件执行此规则"
                        className="inline-flex items-center gap-1 px-gutter-sm py-1 rounded-full bg-light-surface-container-lowest text-light-primary hover:bg-light-surface-container font-label text-label-sm transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <span
                          className={`material-symbols-outlined text-body-md ${
                            runningRuleId === rule.id ? 'animate-spin' : ''
                          }`}
                          aria-hidden="true"
                        >
                          {runningRuleId === rule.id ? 'progress_activity' : 'play_arrow'}
                        </span>
                        <span>{runningRuleId === rule.id ? '执行中...' : '立即生效'}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`编辑规则 ${rule.name}`}
                        title="编辑规则"
                        onClick={() => openEditRuleModal(rule)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                          edit
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`删除规则 ${rule.name}`}
                        title="删除规则"
                        onClick={() => onDeleteFilter(rule.id)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full text-light-on-surface-variant hover:bg-light-error-container hover:text-light-on-error-container transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                          delete_outline
                        </span>
                      </button>
                      <SwitchToggle
                        checked={rule.enabled}
                        onChange={() => onToggleFilter(rule.id)}
                        ariaLabel={`切换规则 ${rule.name}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Section 2: Personal Labels */}
          <section
            id="labels-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md scroll-mt-24"
          >
            <div className="flex flex-wrap items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <div className="flex items-center gap-gutter-sm">
                  <h2 className="font-headline text-headline-md text-light-on-surface">
                    个人标签
                  </h2>
                  <span className="font-mono text-mono-sm tabular-nums text-light-on-surface-variant">
                    共 {labels.length} 个
                  </span>
                </div>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  在邮件列表中可右键为单封邮件贴标签，也可点击下方标签直接筛选邮件或一键关联自动过滤规则。
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditingLabelId(null);
                  setLabelNameInput('');
                  setLabelModalOpen(true);
                }}
                className="inline-flex items-center justify-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container transition-colors duration-state-change shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  add
                </span>
                <span className="font-label text-label-lg">新建标签</span>
              </button>
            </div>

            {labels.length === 0 ? (
              <div className="py-8 px-gutter-lg rounded-xl bg-light-surface-container-low/60 flex flex-col items-center text-center gap-gutter-sm">
                <span
                  className="material-symbols-outlined text-headline-lg text-light-on-surface-variant"
                  aria-hidden="true"
                >
                  label_off
                </span>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  还没有个人标签，点击右上角「新建标签」即可开始整理重点邮件。
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-light-outline-variant/25">
                {labels.map((lbl) => (
                  <li
                    key={lbl.id}
                    className="group flex items-center justify-between gap-gutter-md py-3 px-2 rounded-lg hover:bg-light-surface-container-low/70 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onViewTagInInbox(lbl.name)}
                      className="flex items-center gap-gutter-sm min-w-0 text-left cursor-pointer"
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${lbl.dotClass}`}
                        aria-hidden="true"
                      />
                      <span className="font-title text-title-md text-light-on-surface truncate hover:text-light-primary transition-colors">
                        {lbl.name}
                      </span>
                      <span className="font-mono text-mono-sm text-light-on-surface-variant tabular-nums">
                        · {lbl.count} 封邮件
                      </span>
                    </button>

                    <div className="flex items-center gap-gutter-xs shrink-0">
                      <button
                        type="button"
                        onClick={() => onViewTagInInbox(lbl.name)}
                        className="px-gutter-sm py-1 rounded-full text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface font-label text-label-sm transition-colors cursor-pointer"
                      >
                        查看邮件
                      </button>
                      <button
                        type="button"
                        onClick={() => openNewRuleModal(lbl.name)}
                        title="为此标签创建自动过滤规则"
                        className="inline-flex items-center gap-1 px-gutter-sm py-1 rounded-full text-light-primary hover:bg-light-surface-container font-label text-label-sm transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-body-md" aria-hidden="true">
                          filter_alt
                        </span>
                        <span>建规则</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`编辑标签 ${lbl.name}`}
                        title="重命名"
                        onClick={() => {
                          setEditingLabelId(lbl.id);
                          setLabelNameInput(lbl.name);
                          setLabelModalOpen(true);
                        }}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full text-light-on-surface-variant hover:bg-light-surface-container transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                          edit
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`删除标签 ${lbl.name}`}
                        title="删除标签"
                        onClick={() => onDeleteLabel(lbl.id)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full text-light-on-surface-variant hover:bg-light-error-container hover:text-light-on-error-container transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                          delete_outline
                        </span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Section 3: AI LLM Configuration (OpenAI Compatible) */}
          <section
            id="llm-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md scroll-mt-24"
          >
            <div className="flex flex-wrap items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <div className="flex items-center gap-gutter-sm">
                  <h2 className="font-headline text-headline-md text-light-on-surface">
                    邮件翻译与 AI 大模型配置
                  </h2>
                  <span className="font-mono text-mono-sm text-light-secondary">
                    免费通道 + OpenAI 兼容
                  </span>
                </div>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  支持零配置免密钥免费通道与自定义 OpenAI 兼容大模型双引擎翻译（结果自动本地缓存），同时支持写信一键美化。
                </p>
              </div>

              <button
                type="button"
                onClick={() => setLlmModalOpen(true)}
                className="inline-flex items-center justify-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container transition-colors duration-state-change shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  add
                </span>
                <span className="font-label text-label-lg">添加自定义模型</span>
              </button>
            </div>

            {/* Translation Engine & Target Language Defaults */}
            <div className="flex flex-col gap-gutter-sm py-gutter-sm border-y border-light-outline-variant/25">
              <div className="flex flex-wrap items-center justify-between gap-gutter-md">
                <div className="flex flex-col">
                  <span className="font-title text-title-md text-light-on-surface">
                    默认邮件翻译引擎
                  </span>
                  <span className="font-body text-body-sm text-light-on-surface-variant">
                    阅读邮件点击「翻译邮件」时默认使用的通道，也可在译文栏随时单封切换
                  </span>
                </div>
                <div
                  className="flex items-center gap-gutter-xs bg-light-surface-container-low p-gutter-xs rounded-full"
                  role="group"
                  aria-label="默认邮件翻译引擎"
                >
                  {(
                    [
                      { id: 'free', label: '免配置免费通道' },
                      { id: 'ai', label: '自定义 AI 大模型' },
                    ] as const
                  ).map((opt) => {
                    const active = (systemSettings.translationEngine || 'free') === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onUpdateSystemSettings({ translationEngine: opt.id })}
                        className={`px-gutter-md py-gutter-xs rounded-full font-label text-label-md whitespace-nowrap shrink-0 transition-colors duration-state-change cursor-pointer ${
                          active
                            ? 'bg-light-surface-container-lowest text-light-on-surface shadow-sm'
                            : 'text-light-on-surface-variant hover:text-light-on-surface'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-gutter-md pt-gutter-xs">
                <div className="flex flex-col">
                  <span className="font-title text-title-md text-light-on-surface">
                    默认翻译目标语言
                  </span>
                  <span className="font-body text-body-sm text-light-on-surface-variant">
                    选择「自动识别」时，外文邮件自动译为简体中文，中文邮件自动译为 English
                  </span>
                </div>
                <div
                  className="flex flex-wrap items-center gap-gutter-xs bg-light-surface-container-low p-gutter-xs rounded-full"
                  role="group"
                  aria-label="默认翻译目标语言"
                >
                  {(
                    [
                      { id: 'auto', label: '自动识别' },
                      { id: 'zh-CN', label: '简体中文' },
                      { id: 'en', label: 'English' },
                      { id: 'ja', label: '日本語' },
                      { id: 'ko', label: '한국어' },
                    ] as const
                  ).map((opt) => {
                    const active = (systemSettings.translationTargetLang || 'auto') === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onUpdateSystemSettings({ translationTargetLang: opt.id })}
                        className={`px-gutter-md py-gutter-xs rounded-full font-label text-label-md whitespace-nowrap shrink-0 transition-colors duration-state-change cursor-pointer ${
                          active
                            ? 'bg-light-surface-container-lowest text-light-on-surface shadow-sm'
                            : 'text-light-on-surface-variant hover:text-light-on-surface'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <ul className="flex flex-col gap-gutter-sm">
              {llmProfiles.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-gutter-md p-gutter-md rounded-lg bg-light-surface-container-low/70"
                >
                  <div className="flex flex-col gap-gutter-xs min-w-0">
                    <div className="flex flex-wrap items-center gap-gutter-sm">
                      <span className="font-title text-title-md text-light-on-surface">
                        {p.name}
                      </span>
                      <span className="font-mono text-mono-sm text-light-on-surface-variant">
                        · {p.model}
                      </span>
                      {p.active && (
                        <span className="font-label text-label-sm text-light-secondary">
                          · 当前启用
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-mono-sm text-light-on-surface-variant truncate">
                      {p.baseUrl} · Temperature {p.temperature}
                    </p>
                  </div>
                  <div className="flex items-center gap-gutter-xs shrink-0">
                    {!p.active && (
                      <button
                        type="button"
                        onClick={() => onActivateLlm(p.id)}
                        className="px-gutter-md py-gutter-xs rounded-full bg-light-surface-container-lowest text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change cursor-pointer"
                      >
                        设为默认
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Section 4: Auto-Forwarding & Vacation Responder */}
          <section
            id="forwarding-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md scroll-mt-24"
          >
            <h2 className="font-headline text-headline-md text-light-on-surface">
              自动转发与休假回复
            </h2>

            <div className="flex flex-col gap-gutter-md">
              <div className="flex items-center justify-between gap-gutter-md">
                <div className="flex flex-col">
                  <span className="font-title text-title-md text-light-on-surface">
                    开启休假自动回复
                  </span>
                  <span className="font-body text-body-sm text-light-on-surface-variant">
                    不在工作状态时自动向发件人发送礼貌的回执说明
                  </span>
                </div>
                <SwitchToggle
                  checked={systemSettings.vacationResponder}
                  onChange={(next) => onUpdateSystemSettings({ vacationResponder: next })}
                  ariaLabel="切换休假自动回复"
                />
              </div>

              <div className="h-px bg-light-surface-container-high" aria-hidden="true" />

              <div className="flex items-center justify-between gap-gutter-md">
                <div className="flex flex-col">
                  <span className="font-title text-title-md text-light-on-surface">
                    自动转发邮件副本
                  </span>
                  <span className="font-body text-body-sm text-light-on-surface-variant">
                    将收件箱新邮件静默转发至备用归档邮箱 backup@atelier.cn
                  </span>
                </div>
                <SwitchToggle
                  checked={systemSettings.autoForward}
                  onChange={(next) => onUpdateSystemSettings({ autoForward: next })}
                  ariaLabel="切换自动转发邮件副本"
                />
              </div>
            </div>
          </section>

          {/* Section 5: Sender Blocklist */}
          <section
            id="blocklist-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md scroll-mt-24"
          >
            <div className="flex flex-col gap-gutter-xs">
              <h2 className="font-headline text-headline-md text-light-on-surface">
                发件人黑名单
              </h2>
              <p className="font-body text-body-sm text-light-on-surface-variant">
                来自以下邮箱或域名的信件将直接移入废纸篓，不触发任何桌面提醒。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-gutter-xs">
              {systemSettings.blocklist.map((entry) => (
                <span
                  key={entry}
                  className="inline-flex items-center gap-gutter-xs pl-gutter-md pr-gutter-xs py-gutter-xs rounded-full bg-light-surface-container-low text-light-on-surface"
                >
                  <span className="font-mono text-mono-sm">{entry}</span>
                  <button
                    type="button"
                    aria-label={`移除拦截 ${entry}`}
                    onClick={() =>
                      onUpdateSystemSettings({
                        blocklist: systemSettings.blocklist.filter((b) => b !== entry),
                      })
                    }
                    className="w-5 h-5 rounded-full inline-flex items-center justify-center hover:bg-light-surface-container cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-body-sm" aria-hidden="true">
                      close
                    </span>
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-gutter-sm">
              <input
                type="text"
                value={blockInput}
                onChange={(e) => setBlockInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddBlock();
                  }
                }}
                placeholder="输入要拦截的邮箱地址或 @域名..."
                className="flex-1 px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-1 focus:ring-light-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddBlock}
                className="px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-lg transition-colors duration-state-change cursor-pointer"
              >
                加入黑名单
              </button>
            </div>
          </section>

          {/* Section 6: Sync Frequency & Local Cache */}
          <section
            id="sync-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md scroll-mt-24"
          >
            <h2 className="font-headline text-headline-md text-light-on-surface">
              同步频率与本地缓存
            </h2>

            <div className="flex flex-wrap items-center justify-between gap-gutter-md">
              <div className="flex flex-col">
                <span className="font-title text-title-md text-light-on-surface">
                  收件同步频率
                </span>
                <span className="font-body text-body-sm text-light-on-surface-variant">
                  选择桌面端后台拉取新邮件的时间间隔
                </span>
              </div>

              <div
                className="flex items-center gap-gutter-xs bg-light-surface-container-low p-gutter-xs rounded-full"
                role="group"
                aria-label="同步频率"
              >
                {(['实时推送', '每 5 分钟', '每 15 分钟', '手动'] as const).map((freq) => {
                  const active = systemSettings.syncFrequency === freq;
                  return (
                    <button
                      key={freq}
                      type="button"
                      onClick={() => onUpdateSystemSettings({ syncFrequency: freq })}
                      className={`px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
                        active
                          ? 'bg-light-surface-container-lowest text-light-on-surface shadow-sm'
                          : 'text-light-on-surface-variant hover:text-light-on-surface'
                      }`}
                    >
                      {freq}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-light-surface-container-high" aria-hidden="true" />

            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex flex-col">
                <span className="font-title text-title-md text-light-on-surface">
                  关闭窗口时最小化到 Windows 系统托盘
                </span>
                <span className="font-body text-body-sm text-light-on-surface-variant">
                  应用在后台静默保持 IMAP 轮询与定时发送任务运行
                </span>
              </div>
              <SwitchToggle
                checked={systemSettings.minimizeToTray ?? true}
                onChange={(next) => onUpdateSystemSettings({ minimizeToTray: next })}
                ariaLabel="切换关闭窗口最小化到托盘"
              />
            </div>

            <div className="h-px bg-light-surface-container-high" aria-hidden="true" />

            <div className="flex flex-wrap items-center justify-between gap-gutter-md">
              <div className="flex flex-col">
                <span className="font-title text-title-md text-light-on-surface">
                  新邮件 Windows 原生桌面通知
                </span>
                <span className="font-body text-body-sm text-light-on-surface-variant">
                  {notifyToast || '后台同步到未读新邮件时自动推送系统通知'}
                </span>
              </div>
              <div className="flex items-center gap-gutter-sm">
                <button
                  type="button"
                  onClick={async () => {
                    const res = await mailService.sendTestNotification();
                    setNotifyToast(res.message);
                    setTimeout(() => setNotifyToast(null), 3200);
                  }}
                  className="px-gutter-md py-gutter-xs rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change cursor-pointer"
                >
                  测试通知
                </button>
                <SwitchToggle
                  checked={systemSettings.desktopNotifications ?? true}
                  onChange={(next) => onUpdateSystemSettings({ desktopNotifications: next })}
                  ariaLabel="切换新邮件桌面通知"
                />
              </div>
            </div>

            <div className="h-px bg-light-surface-container-high" aria-hidden="true" />

            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex flex-col">
                <span className="font-title text-title-md text-light-on-surface">
                  本地附件离线缓存与 SQLite 数据库
                </span>
                <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
                  {systemSettings.cacheText}
                </span>
              </div>

              <button
                type="button"
                disabled={clearingCache}
                onClick={async () => {
                  setClearingCache(true);
                  await onClearCache();
                  setClearingCache(false);
                }}
                className="px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change cursor-pointer disabled:opacity-60"
              >
                {clearingCache ? '正在清理...' : '清理本地缓存'}
              </button>
            </div>
          </section>
        </div>
      </main>

      {/* Auto-Filter Rule Builder Modal */}
      {ruleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-light-scrim/35 p-gutter-lg overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rule-modal-title"
          onClick={() => setRuleModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_24px_60px_-12px_rgba(35,25,20,0.22)] flex flex-col gap-gutter-lg"
          >
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <h2 id="rule-modal-title" className="font-headline text-headline-md text-light-on-surface">
                  {editingRuleId ? '编辑自动过滤规则' : '新建自动过滤规则'}
                </h2>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  设置匹配条件与自动处理动作，新邮件到达时将按规则自动放入文件夹、打标签、标记已读或静默归档。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setRuleModalOpen(false)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            <label className="flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">
                规则名称
              </span>
              <input
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="例如：财务发票自动归类 / 验证码自动已读归档"
                className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
              />
            </label>

            {/* Conditions */}
            <div className="flex flex-col gap-gutter-sm">
              <div className="flex items-center justify-between gap-gutter-md">
                <span className="font-title text-title-md text-light-on-surface">
                  1. 当邮件满足以下条件时
                </span>
                <div
                  className="flex items-center gap-gutter-xs bg-light-surface-container-low p-gutter-xs rounded-full"
                  role="group"
                  aria-label="条件逻辑关系"
                >
                  {(
                    [
                      { id: 'AND', label: '满足全部 (AND)' },
                      { id: 'OR', label: '满足任意 (OR)' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setLogicMode(mode.id)}
                      className={`px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
                        logicMode === mode.id
                          ? 'bg-light-surface-container-lowest text-light-on-surface shadow-sm'
                          : 'text-light-on-surface-variant hover:text-light-on-surface'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-gutter-xs">
                {conditions.map((c, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-gutter-sm bg-light-surface-container-low/70 p-gutter-xs rounded-xl"
                  >
                    <select
                      value={c.field}
                      onChange={(e) => {
                        const val = e.target.value as FilterCondition['field'];
                        setConditions((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, field: val } : item))
                        );
                      }}
                      className="px-gutter-md py-gutter-xs rounded-lg bg-light-surface-container-lowest border-0 font-label text-label-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                    >
                      <option value="发件人">发件人</option>
                      <option value="收件人">收件人</option>
                      <option value="主题">主题</option>
                      <option value="正文">正文</option>
                    </select>

                    <select
                      value={c.op}
                      onChange={(e) => {
                        const val = e.target.value as FilterCondition['op'];
                        setConditions((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, op: val } : item))
                        );
                      }}
                      className="px-gutter-md py-gutter-xs rounded-lg bg-light-surface-container-lowest border-0 font-label text-label-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                    >
                      <option value="包含">包含</option>
                      <option value="不包含">不包含</option>
                      <option value="完全等于">完全等于</option>
                    </select>

                    <input
                      type="text"
                      value={c.value}
                      onChange={(e) => {
                        const val = e.target.value;
                        setConditions((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, value: val } : item))
                        );
                      }}
                      placeholder="输入匹配关键词或邮箱..."
                      className="flex-1 px-gutter-md py-gutter-xs rounded-lg bg-light-surface-container-lowest border-0 font-body text-body-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                    />

                    <button
                      type="button"
                      aria-label="移除条件"
                      onClick={() => {
                        if (conditions.length > 1) {
                          setConditions((prev) => prev.filter((_, i) => i !== idx));
                        }
                      }}
                      className="w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                        close
                      </span>
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-gutter-xs">
                <button
                  type="button"
                  onClick={() =>
                    setConditions((prev) => [...prev, { field: '主题', op: '包含', value: '' }])
                  }
                  className="inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                    add
                  </span>
                  <span>添加条件</span>
                </button>

                <label className="inline-flex items-center gap-gutter-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasAttachmentCheck}
                    onChange={(e) => setHasAttachmentCheck(e.target.checked)}
                    className="rounded border-light-outline-variant accent-light-primary"
                  />
                  <span className="font-body text-body-sm text-light-on-surface">
                    仅对包含附件的邮件生效
                  </span>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-gutter-sm">
              <span className="font-title text-title-md text-light-on-surface">
                2. 自动执行以下动作
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter-sm">
                {/* Direct Move to Folder Action */}
                <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-gutter-sm p-gutter-md rounded-xl bg-light-surface-container-low/80">
                  <label className="flex items-center gap-gutter-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={actionFolderCheck}
                      disabled={selectableFolders.length === 0}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setActionFolderCheck(checked);
                        if (checked) {
                          setActionArchiveCheck(false);
                          if (!actionFolderKey && selectableFolders[0]) {
                            setActionFolderKey(selectableFolders[0].folderKey);
                          }
                        }
                      }}
                      className="rounded border-light-outline-variant accent-light-primary disabled:opacity-50"
                    />
                    <div className="flex flex-col">
                      <span className="font-body text-body-md text-light-on-surface">
                        直接放入文件夹
                      </span>
                      <span className="font-body text-body-sm text-light-on-surface-variant">
                        {selectableFolders.length > 0
                          ? '匹配邮件将跳过收件箱，直接移入所选邮箱文件夹（同步到服务器）'
                          : '暂无可用文件夹，请先在收件箱文件夹条点击「新建文件夹」或「刷新」'}
                      </span>
                    </div>
                  </label>

                  {(selectableFolders.length > 0 || (actionFolderKey && editingFallbackFolderName)) && (
                    <select
                      aria-label="选择目标文件夹"
                      value={actionFolderKey}
                      onChange={(e) => {
                        setActionFolderKey(e.target.value);
                        if (e.target.value) {
                          setActionFolderCheck(true);
                          setActionArchiveCheck(false);
                        }
                      }}
                      className="min-w-[180px] max-w-[260px] px-gutter-md py-gutter-xs rounded-lg bg-light-surface-container-lowest border-0 font-label text-label-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none cursor-pointer"
                    >
                      {actionFolderKey &&
                        !selectableFolders.some((f) => f.folderKey === actionFolderKey) && (
                          <option value={actionFolderKey}>
                            {editingFallbackFolderName || '已选文件夹'}
                          </option>
                        )}
                      {selectableFolders.map((f) => (
                        <option key={f.id} value={f.folderKey}>
                          {f.displayName}
                          {hasMultipleAccounts && f.accountEmail ? ` (${f.accountEmail})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="flex flex-col gap-2 p-gutter-md rounded-xl bg-light-surface-container-low/80">
                  <label className="flex items-center justify-between gap-gutter-sm cursor-pointer">
                    <div className="flex items-center gap-gutter-sm">
                      <input
                        type="checkbox"
                        checked={actionTagCheck}
                        onChange={(e) => setActionTagCheck(e.target.checked)}
                        className="rounded border-light-outline-variant accent-light-primary"
                      />
                      <span className="font-body text-body-md text-light-on-surface">添加标签</span>
                    </div>
                    <input
                      type="text"
                      value={actionTagValue}
                      onChange={(e) => {
                        setActionTagValue(e.target.value);
                        if (e.target.value.trim()) setActionTagCheck(true);
                      }}
                      placeholder="输入或选标签"
                      className="w-32 px-gutter-sm py-1 rounded-full bg-light-surface-container-lowest border-0 font-label text-label-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-1 focus:ring-light-primary focus:outline-none"
                    />
                  </label>
                  {labels.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {labels.slice(0, 6).map((lbl) => (
                        <button
                          key={lbl.id}
                          type="button"
                          onClick={() => {
                            setActionTagCheck(true);
                            setActionTagValue(lbl.name);
                          }}
                          className={`px-2 py-0.5 rounded-full font-label text-label-sm transition-colors cursor-pointer ${
                            actionTagCheck && actionTagValue === lbl.name
                              ? 'bg-light-primary text-light-on-primary'
                              : 'bg-light-surface-container-lowest text-light-on-surface-variant hover:text-light-on-surface'
                          }`}
                        >
                          {lbl.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-gutter-sm p-gutter-md rounded-xl bg-light-surface-container-low/80 cursor-pointer hover:bg-light-surface-container-low">
                  <input
                    type="checkbox"
                    checked={actionArchiveCheck}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setActionArchiveCheck(checked);
                      if (checked) setActionFolderCheck(false);
                    }}
                    className="rounded border-light-outline-variant accent-light-primary"
                  />
                  <span className="font-body text-body-md text-light-on-surface">
                    跳过收件箱（直接归档）
                  </span>
                </label>

                <label className="flex items-center gap-gutter-sm p-gutter-md rounded-xl bg-light-surface-container-low/80 cursor-pointer hover:bg-light-surface-container-low">
                  <input
                    type="checkbox"
                    checked={actionReadCheck}
                    onChange={(e) => setActionReadCheck(e.target.checked)}
                    className="rounded border-light-outline-variant accent-light-primary"
                  />
                  <span className="font-body text-body-md text-light-on-surface">
                    自动标记为已读
                  </span>
                </label>

                <label className="flex items-center gap-gutter-sm p-gutter-md rounded-xl bg-light-surface-container-low/80 cursor-pointer hover:bg-light-surface-container-low">
                  <input
                    type="checkbox"
                    checked={actionStarCheck}
                    onChange={(e) => setActionStarCheck(e.target.checked)}
                    className="rounded border-light-outline-variant accent-light-primary"
                  />
                  <span className="font-body text-body-md text-light-on-surface">
                    星标重点标记
                  </span>
                </label>
              </div>
            </div>

            {/* Live Summary */}
            <div className="bg-light-secondary-container/40 rounded-lg px-gutter-md py-gutter-sm flex items-center justify-between gap-gutter-md">
              <p className="font-body text-body-sm text-light-on-surface text-pretty">
                {liveRuleSummary}
              </p>
              <span className="font-mono text-mono-sm text-light-secondary tabular-nums shrink-0">
                预计命中 {liveMatchCount} 封
              </span>
            </div>

            {ruleFormError && (
              <p className="font-body text-body-sm text-light-error px-gutter-sm">
                {ruleFormError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-gutter-md pt-gutter-xs">
              <label className="inline-flex items-center gap-gutter-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyExistingCheck}
                  onChange={(e) => setApplyExistingCheck(e.target.checked)}
                  className="rounded border-light-outline-variant accent-light-primary"
                />
                <span className="font-body text-body-sm text-light-on-surface-variant tabular-nums">
                  立即应用到现有 {liveMatchCount} 封匹配邮件
                </span>
              </label>

              <div className="flex items-center gap-gutter-sm shrink-0">
                <button
                  type="button"
                  disabled={savingRule}
                  onClick={() => setRuleModalOpen(false)}
                  className="inline-flex items-center justify-center px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-lg transition-colors duration-state-change cursor-pointer disabled:opacity-60"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={savingRule}
                  onClick={() => void handleSaveRule()}
                  className="inline-flex items-center justify-center gap-gutter-xs px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container transition-colors duration-state-change cursor-pointer disabled:opacity-60"
                >
                  <span
                    className={`material-symbols-outlined text-title-md ${
                      savingRule ? 'animate-spin' : ''
                    }`}
                    aria-hidden="true"
                  >
                    {savingRule ? 'progress_activity' : 'check'}
                  </span>
                  <span className="font-label text-label-lg">
                    {savingRule
                      ? '正在保存...'
                      : editingRuleId
                      ? applyExistingCheck
                        ? '保存并立即生效'
                        : '保存修改'
                      : '保存并启用规则'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New / Edit Personal Label Modal */}
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveLabel();
                  }
                }}
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

      {/* Custom OpenAI-Compatible LLM Modal */}
      {llmModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-light-scrim/35 p-gutter-lg overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="llm-modal-title"
          onClick={() => setLlmModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_24px_60px_-12px_rgba(35,25,20,0.22)] flex flex-col gap-gutter-lg"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <div className="flex items-center gap-gutter-sm">
                  <h2 id="llm-modal-title" className="font-headline text-headline-md text-light-on-surface">
                    添加自定义大模型
                  </h2>
                  <span className="font-mono text-mono-sm text-light-secondary">
                    OpenAI 兼容格式
                  </span>
                </div>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  支持接入任何兼容 /v1/chat/completions 协议的大语言模型，用于收件箱翻译与写信一键美化。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setLlmModalOpen(false)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            {/* Quick Provider Presets */}
            <div className="flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">
                快速填充常用服务商模板
              </span>
              <div className="flex flex-wrap items-center gap-gutter-xs" role="group" aria-label="模型服务商模板">
                {(Object.keys(LLM_PRESETS) as (keyof typeof LLM_PRESETS)[]).map((key) => {
                  const active = activePreset === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handlePresetClick(key)}
                      className={`px-gutter-md py-gutter-xs rounded-full font-label text-label-md transition-colors duration-state-change cursor-pointer ${
                        active
                          ? 'bg-light-secondary-container text-light-on-secondary-container'
                          : 'bg-light-surface-container-low text-light-on-surface-variant hover:bg-light-surface-container'
                      }`}
                    >
                      {LLM_PRESETS[key].label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Form Fields */}
            <div className="flex flex-col gap-gutter-sm">
              <label className="flex flex-col gap-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant">
                  配置名称
                </span>
                <input
                  type="text"
                  value={llmName}
                  onChange={(e) => setLlmName(e.target.value)}
                  placeholder="例如：我的 OpenAI 兼容网关"
                  className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant">
                  API Base URL（不含 /chat/completions 后缀）
                </span>
                <input
                  type="url"
                  value={llmUrl}
                  onChange={(e) => setLlmUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-mono text-mono-sm text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-gutter-xs">
                <span className="font-label text-label-md text-light-on-surface-variant">
                  API Key
                </span>
                <div className="relative flex items-center">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={llmKey}
                    onChange={(e) => setLlmKey(e.target.value)}
                    placeholder="输入 sk-... 密钥"
                    className="w-full pl-gutter-md pr-12 py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-mono text-mono-sm text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label="显示或隐藏 API Key"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 w-8 h-8 rounded-full inline-flex items-center justify-center text-light-on-surface-variant hover:bg-light-surface-container cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                      {showKey ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </label>

              <div className="grid grid-cols-2 gap-gutter-sm">
                <label className="flex flex-col gap-gutter-xs">
                  <span className="font-label text-label-md text-light-on-surface-variant">
                    模型名称 (Model ID)
                  </span>
                  <input
                    type="text"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    placeholder="例如：gpt-4o-mini / deepseek-chat"
                    className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-mono text-mono-sm text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-gutter-xs">
                  <span className="font-label text-label-md text-light-on-surface-variant">
                    采样温度 (Temperature)
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={llmTemp}
                    onChange={(e) => setLlmTemp(e.target.value)}
                    className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-mono text-mono-sm tabular-nums text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                  />
                </label>
              </div>

              {/* Capability Checkboxes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter-sm pt-gutter-xs">
                <label className="flex items-center gap-gutter-sm p-gutter-md rounded-xl bg-light-surface-container-low/80 cursor-pointer hover:bg-light-surface-container-low">
                  <input
                    type="checkbox"
                    checked={enableTranslate}
                    onChange={(e) => setEnableTranslate(e.target.checked)}
                    className="rounded border-light-outline-variant accent-light-primary"
                  />
                  <div className="flex flex-col">
                    <span className="font-body text-body-md text-light-on-surface">
                      收件箱邮件翻译
                    </span>
                    <span className="font-body text-body-sm text-light-on-surface-variant">
                      阅读长邮件时一键对照译文
                    </span>
                  </div>
                </label>
                <label className="flex items-center gap-gutter-sm p-gutter-md rounded-xl bg-light-surface-container-low/80 cursor-pointer hover:bg-light-surface-container-low">
                  <input
                    type="checkbox"
                    checked={enablePolish}
                    onChange={(e) => setEnablePolish(e.target.checked)}
                    className="rounded border-light-outline-variant accent-light-primary"
                  />
                  <div className="flex flex-col">
                    <span className="font-body text-body-md text-light-on-surface">
                      发件箱一键美化
                    </span>
                    <span className="font-body text-body-sm text-light-on-surface-variant">
                      自动优化商务措辞与段落排版
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Live Endpoint Preview Strip */}
            <div className="bg-light-secondary-container/40 rounded-lg px-gutter-md py-gutter-sm flex items-center justify-between gap-gutter-md">
              <p className="font-mono text-mono-sm text-light-on-surface truncate">
                POST {basePreview}/chat/completions · model: {modelPreview} · temp: {llmTemp || '0.3'}
              </p>
              <span className="font-label text-label-sm text-light-secondary shrink-0">
                {llmConnStatus}
              </span>
            </div>

            {/* Modal Footer Actions */}
            <div className="flex items-center justify-between gap-gutter-md pt-gutter-xs">
              <button
                type="button"
                disabled={testingLlm}
                onClick={() => void handleTestLlm()}
                className="inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-md transition-colors duration-state-change cursor-pointer disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  bolt
                </span>
                <span>{testingLlm ? '测试中...' : '测试连通性'}</span>
              </button>

              <div className="flex items-center gap-gutter-sm shrink-0">
                <button
                  type="button"
                  onClick={() => setLlmModalOpen(false)}
                  className="inline-flex items-center justify-center px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-lg transition-colors duration-state-change cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveLlmProfile}
                  className="inline-flex items-center justify-center gap-gutter-xs px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container transition-colors duration-state-change cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                    check
                  </span>
                  <span className="font-label text-label-lg">保存并启用模型</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

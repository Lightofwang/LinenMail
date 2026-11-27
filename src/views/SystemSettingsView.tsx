import React, { useMemo, useState } from 'react';
import { SwitchToggle } from '../components/SwitchToggle';
import { mailService, matchesFilterRule } from '../services/mailService';
import {
  AppRoute,
  EmailItem,
  FilterCondition,
  FilterRuleItem,
  LlmProfile,
  SystemSettingsState,
} from '../types/mail';

interface SystemSettingsViewProps {
  emails: EmailItem[];
  filters: FilterRuleItem[];
  llmProfiles: LlmProfile[];
  systemSettings: SystemSettingsState;
  onBackToInbox: () => void;
  onNavigate: (route: AppRoute) => void;
  onToggleFilter: (id: string) => void;
  onAddFilter: (rule: FilterRuleItem, applyExisting: boolean) => Promise<void>;
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
  filters,
  llmProfiles,
  systemSettings,
  onBackToInbox,
  onNavigate,
  onToggleFilter,
  onAddFilter,
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

  // New Filter Builder Modal (Stitch screen _________1.html)
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [ruleName, setRuleName] = useState('账单与电子发票自动归档');
  const [logicMode, setLogicMode] = useState<'AND' | 'OR'>('OR');
  const [conditions, setConditions] = useState<FilterCondition[]>([
    { field: '发件人', op: '包含', value: 'billing@' },
    { field: '主题', op: '包含', value: '发票' },
  ]);
  const [hasAttachmentCheck, setHasAttachmentCheck] = useState(false);
  const [actionTagCheck, setActionTagCheck] = useState(true);
  const [actionTagValue, setActionTagValue] = useState('财务票据');
  const [actionArchiveCheck, setActionArchiveCheck] = useState(true);
  const [actionReadCheck, setActionReadCheck] = useState(true);
  const [actionStarCheck, setActionStarCheck] = useState(false);
  const [applyExistingCheck, setApplyExistingCheck] = useState(true);

  // Add Custom LLM Modal (Stitch screen _________2.html)
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

  // Live summary text for Filter Builder Modal
  const joiner = logicMode === 'AND' ? ' 且 ' : ' 或 ';
  const condText = conditions
    .map((c) => `${c.field}${c.op} "${c.value || '...'}"`)
    .join(joiner);
  const attText = hasAttachmentCheck ? ' 且包含附件' : '';
  const selectedActionLabels = [
    actionTagCheck ? `添加标签「${actionTagValue}」` : null,
    actionArchiveCheck ? '跳过收件箱直接归档' : null,
    actionReadCheck ? '自动标记为已读' : null,
    actionStarCheck ? '星标重点标记' : null,
  ].filter(Boolean) as string[];
  const actionSummary = selectedActionLabels.length
    ? selectedActionLabels.join('、')
    : '暂未选择处理动作';
  const liveFilterSummary = `当邮件满足${logicMode === 'AND' ? '全部' : '任意'}条件（${condText}${attText}）时，自动${actionSummary}。`;

  const draftRule: FilterRuleItem = useMemo(
    () => ({
      id: 'preview',
      name: ruleName.trim() || '新建规则',
      condition: `${condText}${attText}`,
      action: actionSummary,
      hits: 0,
      enabled: true,
      logic: logicMode,
      conditions,
      hasAttachment: hasAttachmentCheck,
      actionTag: actionTagCheck ? actionTagValue : null,
      actionArchive: actionArchiveCheck,
      actionMarkRead: actionReadCheck,
      actionStar: actionStarCheck,
    }),
    [
      ruleName,
      condText,
      attText,
      actionSummary,
      logicMode,
      conditions,
      hasAttachmentCheck,
      actionTagCheck,
      actionTagValue,
      actionArchiveCheck,
      actionReadCheck,
      actionStarCheck,
    ]
  );

  const liveMatchCount = useMemo(
    () => emails.filter((e) => matchesFilterRule(e, draftRule)).length,
    [emails, draftRule]
  );

  const handleSaveFilterRule = async () => {
    if (ruleName.trim()) {
      await onAddFilter(
        {
          ...draftRule,
          id: `flt-${Date.now()}`,
          hits: applyExistingCheck ? liveMatchCount : 0,
        },
        applyExistingCheck
      );
    }
    setFilterModalOpen(false);
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

          <h1 className="font-headline text-title-lg text-light-on-surface">
            系统设置与邮件过滤器
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
              { id: 'filters-section', icon: 'filter_alt', label: '邮件过滤器' },
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
          </nav>
        </aside>

        {/* Right Settings Panels */}
        <div className="col-span-12 lg:col-span-9 flex flex-col gap-gutter-lg">
          {/* Section 0: AI LLM Configuration (OpenAI Compatible) */}
          <section
            id="llm-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <div className="flex items-center gap-gutter-sm">
                  <h2 className="font-headline text-headline-md text-light-on-surface">
                    AI 大模型配置
                  </h2>
                  <span className="px-gutter-sm py-0.5 rounded-full bg-light-secondary-container text-light-on-secondary-container font-mono text-mono-sm">
                    OpenAI 兼容格式
                  </span>
                </div>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  支持接入自定义 OpenAI 格式接口（Chat Completions），用于收件箱智能翻译与写信一键美化。
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
                      <span className="font-mono text-mono-sm px-gutter-sm py-0.5 rounded-full bg-light-surface-container-lowest text-light-on-surface-variant">
                        {p.model}
                      </span>
                      {p.active && (
                        <span className="font-label text-label-sm px-gutter-sm py-0.5 rounded-full bg-light-secondary-container text-light-on-secondary-container">
                          当前启用
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

          {/* Section 1: Email Filters */}
          <section
            id="filters-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <h2 className="font-headline text-headline-md text-light-on-surface">
                  邮件过滤器与自动处理
                </h2>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  新邮件到达时按顺序自动匹配条件，完成归档、打标签或拦截处理。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFilterModalOpen(true)}
                className="inline-flex items-center justify-center gap-gutter-xs px-gutter-md py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container transition-colors duration-state-change shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                  add
                </span>
                <span className="font-label text-label-lg">新建过滤规则</span>
              </button>
            </div>

            <ul className="flex flex-col gap-gutter-sm">
              {filters.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-gutter-md p-gutter-md rounded-lg bg-light-surface-container-low/70"
                >
                  <div className="flex flex-col gap-gutter-xs min-w-0">
                    <div className="flex items-center gap-gutter-sm">
                      <span className="font-title text-title-md text-light-on-surface">
                        {f.name}
                      </span>
                      <span className="font-mono text-mono-sm tabular-nums px-gutter-sm py-0.5 rounded-full bg-light-secondary-container text-light-on-secondary-container">
                        已处理 {f.hits} 封
                      </span>
                    </div>
                    <p className="font-body text-body-sm text-light-on-surface-variant">
                      条件：{f.condition}
                    </p>
                    <p className="font-body text-body-sm text-light-on-surface">动作：{f.action}</p>
                  </div>

                  <SwitchToggle
                    checked={f.enabled}
                    onChange={() => onToggleFilter(f.id)}
                    ariaLabel={`切换规则 ${f.name}`}
                  />
                </li>
              ))}
            </ul>
          </section>

          {/* Section 2: Auto-Forwarding & Vacation Responder */}
          <section
            id="forwarding-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md"
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

          {/* Section 3: Sender Blocklist */}
          <section
            id="blocklist-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md"
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

          {/* Section 4: Sync Frequency & Local Cache */}
          <section
            id="sync-section"
            className="bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_12px_36px_-8px_rgba(35,25,20,0.07)] flex flex-col gap-gutter-md"
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

      {/* Rich Filter Rule Builder Modal (from _________1.html) */}
      {filterModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-light-scrim/35 p-gutter-lg overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="filter-modal-title"
          onClick={() => setFilterModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl bg-light-surface-container-lowest rounded-xl p-gutter-xl shadow-[0_24px_60px_-12px_rgba(35,25,20,0.22)] flex flex-col gap-gutter-lg"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-gutter-md">
              <div className="flex flex-col gap-gutter-xs">
                <h2 id="filter-modal-title" className="font-headline text-headline-md text-light-on-surface">
                  新建邮件过滤规则
                </h2>
                <p className="font-body text-body-sm text-light-on-surface-variant">
                  设置匹配条件与自动处理动作，新邮件到达时将静默执行。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setFilterModalOpen(false)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full text-light-on-surface-variant hover:bg-light-surface-container hover:text-light-on-surface transition-colors duration-state-change cursor-pointer"
              >
                <span className="material-symbols-outlined text-title-lg" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            {/* Rule Name */}
            <label className="flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-light-on-surface-variant">
                规则名称
              </span>
              <input
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="例如：自动归档验证码与通知邮件"
                className="w-full px-gutter-md py-gutter-sm rounded-lg bg-light-surface-container-low border-0 font-body text-body-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
              />
            </label>

            {/* Conditions Section */}
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

            {/* Actions Section */}
            <div className="flex flex-col gap-gutter-sm">
              <span className="font-title text-title-md text-light-on-surface">
                2. 自动执行以下动作
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter-sm">
                <label className="flex items-center justify-between gap-gutter-sm p-gutter-md rounded-xl bg-light-surface-container-low/80 cursor-pointer hover:bg-light-surface-container-low">
                  <div className="flex items-center gap-gutter-sm">
                    <input
                      type="checkbox"
                      checked={actionTagCheck}
                      onChange={(e) => setActionTagCheck(e.target.checked)}
                      className="rounded border-light-outline-variant accent-light-primary"
                    />
                    <span className="font-body text-body-md text-light-on-surface">添加标签</span>
                  </div>
                  <select
                    value={actionTagValue}
                    onChange={(e) => setActionTagValue(e.target.value)}
                    className="px-gutter-sm py-1 rounded-full bg-light-surface-container-lowest border-0 font-label text-label-md text-light-on-surface focus:ring-1 focus:ring-light-primary focus:outline-none"
                  >
                    <option>财务票据</option>
                    <option>设计评审</option>
                    <option>精选订阅</option>
                    <option>工程研发</option>
                  </select>
                </label>

                <label className="flex items-center gap-gutter-sm p-gutter-md rounded-xl bg-light-surface-container-low/80 cursor-pointer hover:bg-light-surface-container-low">
                  <input
                    type="checkbox"
                    checked={actionArchiveCheck}
                    onChange={(e) => setActionArchiveCheck(e.target.checked)}
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

            {/* Compact Live Summary Strip */}
            <div className="bg-light-secondary-container/40 rounded-lg px-gutter-md py-gutter-sm flex items-center justify-between gap-gutter-md">
              <p className="font-body text-body-sm text-light-on-surface text-pretty">
                {liveFilterSummary}
              </p>
              <span className="font-mono text-mono-sm text-light-secondary tabular-nums shrink-0">
                预计命中 {liveMatchCount} 封
              </span>
            </div>

            {/* Modal Footer Actions */}
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
                  onClick={() => setFilterModalOpen(false)}
                  className="inline-flex items-center justify-center px-gutter-md py-gutter-sm rounded-full bg-light-surface-container-low text-light-on-surface hover:bg-light-surface-container font-label text-label-lg transition-colors duration-state-change cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveFilterRule}
                  className="inline-flex items-center justify-center gap-gutter-xs px-gutter-lg py-gutter-sm rounded-full bg-light-primary text-light-on-primary hover:bg-light-primary-container transition-colors duration-state-change cursor-pointer"
                >
                  <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                    check
                  </span>
                  <span className="font-label text-label-lg">保存并启用规则</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rich Custom OpenAI-Compatible LLM Modal (from _________2.html) */}
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
                  <span className="px-gutter-sm py-0.5 rounded-full bg-light-secondary-container text-light-on-secondary-container font-mono text-mono-sm">
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

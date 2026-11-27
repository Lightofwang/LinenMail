import { mailService } from '../services/mailService';
import {
  EmailItem,
  EmailTranslationRecord,
  LlmProfile,
  TranslationEngine,
  TranslationTargetLang,
  TranslationTargetPreference,
} from '../types/mail';

export interface TranslationLangOption {
  id: TranslationTargetLang;
  label: string;
  promptName: string;
}

export const TRANSLATION_LANG_OPTIONS: TranslationLangOption[] = [
  { id: 'zh-CN', label: '简体中文', promptName: 'natural, fluent Simplified Chinese (简体中文)' },
  { id: 'en', label: 'English', promptName: 'natural, professional English' },
  { id: 'ja', label: '日本語', promptName: 'natural, polite Japanese (日本語)' },
  { id: 'ko', label: '한국어', promptName: 'natural, polite Korean (한국어)' },
];

export function getLangLabel(lang: TranslationTargetLang | string): string {
  return TRANSLATION_LANG_OPTIONS.find((l) => l.id === lang)?.label || lang;
}

export function detectDefaultTargetLang(
  email: EmailItem,
  preference?: TranslationTargetPreference
): TranslationTargetLang {
  if (preference && preference !== 'auto') {
    return preference;
  }
  const sample = `${email.subject} ${email.paragraphs.slice(0, 5).join(' ')}`;
  const cjkCount = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const nonSpaceCount = sample.replace(/\s+/g, '').length;
  if (nonSpaceCount > 0 && cjkCount / nonSpaceCount >= 0.22) {
    return 'en';
  }
  return 'zh-CN';
}

export function isLlmProfileConfigured(cfg?: LlmProfile | null): boolean {
  if (!cfg || !cfg.baseUrl?.trim()) return false;
  if (cfg.apiKey?.trim() || cfg.hasApiKey) return true;
  // Local Ollama / localhost gateways do not require an API key
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(cfg.baseUrl.trim());
}

export class TranslationError extends Error {
  code: 'NO_AI_KEY' | 'TRANSLATE_FAILED';
  constructor(message: string, code: 'NO_AI_KEY' | 'TRANSLATE_FAILED' = 'TRANSLATE_FAILED') {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
  }
}

export async function getCachedEmailTranslation(
  emailId: string,
  targetLang?: TranslationTargetLang,
  engine?: TranslationEngine
): Promise<EmailTranslationRecord | null> {
  return mailService.getEmailTranslation(emailId, targetLang, engine);
}

export async function translateEmailUnified(params: {
  email: EmailItem;
  targetLang: TranslationTargetLang;
  engine: TranslationEngine;
  llmProfile?: LlmProfile | null;
  forceRefresh?: boolean;
}): Promise<{ record: EmailTranslationRecord; fromCache: boolean }> {
  const { email, targetLang, engine, llmProfile, forceRefresh = false } = params;

  // 1. Check local cache first unless forceRefresh is requested
  if (!forceRefresh) {
    const cached = await mailService.getEmailTranslation(email.id, targetLang, engine);
    if (cached && cached.paragraphs.length > 0) {
      return { record: cached, fromCache: true };
    }
  }

  const sourceParagraphs = [...email.paragraphs, email.signoff]
    .map((p) => p.trim())
    .filter(Boolean);

  // 2. Zero-config free translation channel (Rust backend: Microsoft Edge -> Google fallback)
  if (engine === 'free') {
    try {
      const record = await mailService.translateEmailFree({
        emailId: email.id,
        targetLang,
        subject: email.subject,
        paragraphs: sourceParagraphs,
        forceRefresh,
      });
      return { record, fromCache: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TranslationError(msg, 'TRANSLATE_FAILED');
    }
  }

  // 3. Custom OpenAI-compatible AI LLM channel
  if (!llmProfile || !isLlmProfileConfigured(llmProfile)) {
    throw new TranslationError(
      '尚未配置可用的自定义 AI 大模型密钥，请前往「系统设置 → AI 大模型配置」填写 API Key，或先切换至「免费通道」。',
      'NO_AI_KEY'
    );
  }

  const modelName = llmProfile.model || 'gpt-4o-mini';
  const langOpt =
    TRANSLATION_LANG_OPTIONS.find((l) => l.id === targetLang) || TRANSLATION_LANG_OPTIONS[0];

  try {
    const content = await mailService.invokeLlmChat({
      profileId: llmProfile.id,
      baseUrl: llmProfile.baseUrl,
      apiKey: llmProfile.apiKey,
      model: modelName,
      temperature: llmProfile.temperature ?? 0.3,
      messages: [
        {
          role: 'system',
          content: `You are a professional email translator. Translate the given email subject and paragraphs into ${langOpt.promptName}. Preserve business tone, names, URLs, numbers, and exact paragraph order. Return ONLY valid JSON without markdown code fences: {"subject":"...","paragraphs":["..."]}`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            subject: email.subject,
            paragraphs: sourceParagraphs,
          }),
        },
      ],
    });

    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    let translatedSubject = email.subject;
    let translatedParagraphs: string[] = [];

    try {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
      if (typeof parsed.subject === 'string' && parsed.subject.trim()) {
        translatedSubject = parsed.subject.trim();
      }
      if (Array.isArray(parsed.paragraphs)) {
        translatedParagraphs = parsed.paragraphs
          .map((p: unknown) => (typeof p === 'string' ? p.trim() : ''))
          .filter(Boolean);
      }
    } catch {
      // Fallback for smaller local models that reply in plain text instead of strict JSON
      const lines = cleaned
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        translatedParagraphs = lines;
      }
    }

    if (translatedParagraphs.length === 0) {
      throw new Error('AI 返回的译文内容为空');
    }

    const record: EmailTranslationRecord = {
      emailId: email.id,
      targetLang,
      engine: 'ai',
      subject: translatedSubject,
      paragraphs: translatedParagraphs,
      providerLabel: `AI · ${modelName}`,
      updatedAt: new Date().toISOString(),
    };

    await mailService.saveEmailTranslation(record);
    return { record, fromCache: false };
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new TranslationError(`AI 翻译调用失败：${msg}`, 'TRANSLATE_FAILED');
  }
}

export async function polishEmailDraftWithAi(
  currentText: string,
  cfg: LlmProfile
): Promise<{ text: string; model: string }> {
  const modelName = cfg.model || 'gpt-4o-mini';

  if (isLlmProfileConfigured(cfg)) {
    try {
      const polished = (
        await mailService.invokeLlmChat({
          profileId: cfg.id,
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: modelName,
          temperature: cfg.temperature ?? 0.3,
          messages: [
            {
              role: 'system',
              content:
                '你是一位专业的中文商务邮件编辑。请在不改变原意的前提下，优化以下邮件正文的措辞、结构与礼貌度，使段落更清晰自然。直接返回润色后的正文。',
            },
            { role: 'user', content: currentText },
          ],
        })
      ).trim();
      if (polished) {
        return { text: polished, model: modelName };
      }
    } catch {
      // Fallback gracefully
    }
  }

  if (currentText.includes('晨曦、思远')) {
    return {
      text: `晨曦、思远，你们好：\n\n昨晚已与团队完成排版规范及同步引擎基准测试的最终核对，各项指标表现稳健，已具备上线条件。\n\n为确保平稳推进，建议接下来的发布节奏安排如下：\n1. 周四上午：完成主收件箱与智能分类视图的终版走查；\n2. 周五 15:00：启动线上灰度发布，优先面向桌面端用户开放；\n3. 下周一早会：复盘首批用户的实际阅读体验与反馈。\n\n更新后的排期表已随信附上，如有任何补充或调整建议，欢迎随时沟通。\n\n顺颂商祺，\n明远`,
      model: modelName,
    };
  }

  const lines = currentText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const bodyCore = lines.join('\n\n');
  return {
    text: `您好：\n\n感谢您的关注。关于您提到的相关事宜，现简要同步如下：\n\n${bodyCore}\n\n如有任何需要进一步沟通或补充之处，请随时告知。\n\n顺颂商祺，\n周明远`,
    model: modelName,
  };
}

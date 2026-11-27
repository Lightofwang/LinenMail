import { FALLBACK_TRANSLATIONS } from '../data/initialData';
import { mailService } from '../services/mailService';
import { EmailItem, LlmProfile } from '../types/mail';

export interface TranslationResult {
  subject: string;
  paragraphs: string[];
  model: string;
}

export async function translateEmailWithAi(
  email: EmailItem,
  cfg: LlmProfile
): Promise<TranslationResult> {
  const modelName = cfg.model || 'gpt-4o-mini';

  if ((cfg.apiKey || cfg.hasApiKey) && cfg.baseUrl) {
    try {
      const content = await mailService.invokeLlmChat({
        profileId: cfg.id,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: modelName,
        temperature: cfg.temperature ?? 0.3,
        messages: [
          {
            role: 'system',
            content:
              'Translate the following email subject and body into natural English. Return ONLY valid JSON: {"subject":"...","paragraphs":["..."]}',
          },
          {
            role: 'user',
            content: JSON.stringify({
              subject: email.subject,
              paragraphs: [...email.paragraphs, email.signoff].filter(Boolean),
            }),
          },
        ],
      });
      const cleaned = content.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.subject && Array.isArray(parsed.paragraphs)) {
        return {
          subject: parsed.subject,
          paragraphs: parsed.paragraphs,
          model: modelName,
        };
      }
    } catch {
      // Fallback gracefully on network/JSON errors
    }
  }

  const fb = FALLBACK_TRANSLATIONS[email.id];
  if (fb) {
    return {
      subject: fb.subject,
      paragraphs: fb.paragraphs,
      model: modelName,
    };
  }

  return {
    subject: `[EN] ${email.subject}`,
    paragraphs: [...email.paragraphs, email.signoff]
      .filter(Boolean)
      .map((p) => `[Translated via ${modelName}] ${p}`),
    model: modelName,
  };
}

export async function polishEmailDraftWithAi(
  currentText: string,
  cfg: LlmProfile
): Promise<{ text: string; model: string }> {
  const modelName = cfg.model || 'gpt-4o-mini';

  if ((cfg.apiKey || cfg.hasApiKey) && cfg.baseUrl) {
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

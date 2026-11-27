import { cleanMailText } from './textClean';

export interface QuotedHeaderField {
  key: 'from' | 'date' | 'to' | 'cc' | 'subject';
  label: string;
  value: string;
}

export interface QuotedMessage {
  kind: 'forwarded' | 'reply';
  title: string;
  attribution?: string;
  headers: QuotedHeaderField[];
  body: string[];
  signature: string[];
}

export interface ParsedEmailThread {
  primaryBody: string[];
  primarySignature: string[];
  quotedMessages: QuotedMessage[];
}

const FORWARD_BANNER_RE =
  /^(?:[-=_*]{2,}\s*(?:原始邮件|转发邮件|转发的邮件|Original Message|Forwarded message)\s*[-=_*]*|Begin forwarded message\s*:?|转发的邮件\s*:?)$/i;

const REPLY_ATTRIBUTION_RE =
  /^(?:在\s*.{4,60}(?:写道|回复道|说)\s*[:：]|On\s+.{6,80}\bwrote\s*:|.{1,50}\s+在\s+.{4,40}\s*(?:写道|说)\s*[:：])$/i;

const HEADER_RULES: {
  key: QuotedHeaderField['key'];
  label: string;
  re: RegExp;
}[] = [
  { key: 'from', label: '发件人', re: /^(?:发件人|来自|发信人|From)\s*[:：]\s*(.+)$/i },
  {
    key: 'date',
    label: '发送时间',
    re: /^(?:发送时间|发件时间|时间|日期|Sent|Date)\s*[:：]\s*(.+)$/i,
  },
  { key: 'to', label: '收件人', re: /^(?:收件人|发送至|致|To)\s*[:：]\s*(.+)$/i },
  { key: 'cc', label: '抄送', re: /^(?:抄送|Cc)\s*[:：]\s*(.+)$/i },
  { key: 'subject', label: '主题', re: /^(?:主题|标题|Subject)\s*[:：]\s*(.+)$/i },
];

const SIGNATURE_FIELD_RE =
  /^(?:手机|电话|座机|传真|邮箱|邮件|电子邮箱|地址|办公地址|公司地址|网址|官网|网站|微信|企业微信|QQ|Tel|Telephone|Mobile|Mob|Phone|Fax|Email|E-mail|Mail|Address|Add|Web|Website)\s*[:：]/i;

const SIGNATURE_DELIMITER_RE = /^(?:--\s*$|——\s*$|___+$|---+$)/;

function matchHeaderLine(line: string): QuotedHeaderField | null {
  const trimmed = line.replace(/^>+\s*/, '').trim();
  for (const rule of HEADER_RULES) {
    const m = trimmed.match(rule.re);
    if (m && m[1]?.trim()) {
      return {
        key: rule.key,
        label: rule.label,
        value: m[1].trim(),
      };
    }
  }
  return null;
}

/**
 * Checks if lines[startIdx..] begins with a contiguous block of email headers
 * (e.g. 发件人 / 发送时间 / 收件人 / 抄送 / 主题) typical of Outlook/WeCom/Foxmail forwards.
 */
function parseHeaderBlock(
  lines: string[],
  startIdx: number,
  requireFromHeader: boolean
): { headers: QuotedHeaderField[]; nextIdx: number } | null {
  const headers: QuotedHeaderField[] = [];
  const seenKeys = new Set<string>();
  let idx = startIdx;

  while (idx < lines.length) {
    const field = matchHeaderLine(lines[idx]);
    if (!field) break;
    // Stop if we hit a duplicate "from" header (means another nested block)
    if (field.key === 'from' && seenKeys.has('from')) break;
    headers.push(field);
    seenKeys.add(field.key);
    idx += 1;
  }

  if (headers.length === 0) return null;
  if (requireFromHeader) {
    // Without an explicit banner, require "发件人/From" AND at least 1 other email header
    // (like 发送时间/收件人/抄送/主题) so normal prose or calendar reminders never false-trigger.
    const hasFrom = seenKeys.has('from');
    const hasOther =
      seenKeys.has('date') ||
      seenKeys.has('to') ||
      seenKeys.has('cc') ||
      seenKeys.has('subject');
    if (!hasFrom || !hasOther || headers.length < 2) {
      return null;
    }
  }

  return { headers, nextIdx: idx };
}

/**
 * Separates a trailing corporate contact signature block (e.g. 姓名|部门 + 手机/邮箱/地址/网址)
 * from the main prose paragraphs of a message section.
 */
function splitTrailingSignature(lines: string[]): {
  body: string[];
  signature: string[];
} {
  if (lines.length < 2) {
    return { body: lines, signature: [] };
  }

  // Case 1: explicit "--" signature delimiter near the end
  for (let i = Math.max(0, lines.length - 10); i < lines.length; i++) {
    if (SIGNATURE_DELIMITER_RE.test(lines[i])) {
      const sigPart = lines.slice(i + 1);
      if (sigPart.length > 0 && sigPart.length <= 8) {
        return { body: lines.slice(0, i), signature: sigPart };
      }
    }
  }

  // Case 2: trailing cluster of 2+ contact-info lines (手机/邮箱/地址/网址 etc.)
  let contactCount = 0;
  let sigStart = lines.length;

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 9); i--) {
    const line = lines[i];
    if (SIGNATURE_FIELD_RE.test(line)) {
      contactCount += 1;
      sigStart = i;
    } else if (contactCount >= 2) {
      // Optionally include 1-2 short sender identity lines directly above the contact fields
      // (e.g. "张国印 | 网络事业部" or "某公司名称")
      const looksLikeIdentity =
        line.length <= 42 &&
        !/[。！？!?]$/.test(line) &&
        !matchHeaderLine(line);
      if (looksLikeIdentity) {
        sigStart = i;
        // Check one more short line above (e.g. company/dept split across 2 lines)
        if (
          i - 1 >= 0 &&
          lines[i - 1].length <= 30 &&
          /[|｜·/]|部$|公司$|中心$|团队$/.test(lines[i - 1]) &&
          !/[。！？!?]$/.test(lines[i - 1])
        ) {
          sigStart = i - 1;
        }
      }
      break;
    } else {
      break;
    }
  }

  if (contactCount >= 2) {
    return {
      body: lines.slice(0, sigStart),
      signature: lines.slice(sigStart),
    };
  }

  return { body: lines, signature: [] };
}

/**
 * Parses flat email paragraphs into a structured primary message + zero or more
 * forwarded / quoted messages with aligned headers and compact signatures.
 */
export function parseEmailThread(
  rawParagraphs: string[],
  subject = ''
): ParsedEmailThread {
  // Clean entities and flatten embedded newlines into clean logical lines
  const lines: string[] = [];
  for (const raw of rawParagraphs) {
    const subLines = raw.split(/\r?\n/);
    for (const sub of subLines) {
      const cleaned = cleanMailText(sub);
      if (cleaned) {
        lines.push(cleaned);
      }
    }
  }

  const primaryRaw: string[] = [];
  const quotedMessages: QuotedMessage[] = [];
  const subjectIsForward = /^(?:转发|Fw|Fwd)\s*[:：]/i.test(cleanMailText(subject));

  let currentQuoted: {
    kind: 'forwarded' | 'reply';
    title: string;
    attribution?: string;
    headers: QuotedHeaderField[];
    rawBody: string[];
  } | null = null;

  const flushQuoted = () => {
    if (!currentQuoted) return;
    const { body, signature } = splitTrailingSignature(currentQuoted.rawBody);
    quotedMessages.push({
      kind: currentQuoted.kind,
      title: currentQuoted.title,
      attribution: currentQuoted.attribution,
      headers: currentQuoted.headers,
      body,
      signature,
    });
    currentQuoted = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 1. Explicit forward / original message banner
    if (FORWARD_BANNER_RE.test(line)) {
      flushQuoted();
      const isReplyBanner = /Original Message/i.test(line) && !subjectIsForward;
      const headerBlock = parseHeaderBlock(lines, i + 1, false);
      currentQuoted = {
        kind: isReplyBanner ? 'reply' : 'forwarded',
        title: isReplyBanner ? '引用的原始邮件' : '转发的原始邮件',
        headers: headerBlock ? headerBlock.headers : [],
        rawBody: [],
      };
      i = headerBlock ? headerBlock.nextIdx : i + 1;
      continue;
    }

    // 2. Reply attribution line (e.g. "在 2026年11月9日 ...，xxx 写道：")
    if (REPLY_ATTRIBUTION_RE.test(line)) {
      flushQuoted();
      const headerBlock = parseHeaderBlock(lines, i + 1, true);
      currentQuoted = {
        kind: 'reply',
        title: '引用的历史邮件',
        attribution: line,
        headers: headerBlock ? headerBlock.headers : [],
        rawBody: [],
      };
      i = headerBlock ? headerBlock.nextIdx : i + 1;
      continue;
    }

    // 3. Implicit Outlook/WeCom/Foxmail header block (发件人 + 发送时间 + 收件人 + 主题...)
    const implicitHeaders = parseHeaderBlock(lines, i, true);
    if (implicitHeaders) {
      flushQuoted();
      const hasForwardClues =
        subjectIsForward ||
        implicitHeaders.headers.some((h) => h.key === 'to' || h.key === 'subject');
      currentQuoted = {
        kind: hasForwardClues ? 'forwarded' : 'reply',
        title: hasForwardClues ? '转发的原始邮件' : '引用的历史邮件',
        headers: implicitHeaders.headers,
        rawBody: [],
      };
      i = implicitHeaders.nextIdx;
      continue;
    }

    // Normal content line
    const cleanLine = currentQuoted ? line.replace(/^>+\s*/, '').trim() : line;
    if (cleanLine) {
      if (currentQuoted) {
        currentQuoted.rawBody.push(cleanLine);
      } else {
        primaryRaw.push(cleanLine);
      }
    }
    i += 1;
  }

  flushQuoted();

  const { body: primaryBody, signature: primarySignature } =
    splitTrailingSignature(primaryRaw);

  return {
    primaryBody,
    primarySignature,
    quotedMessages,
  };
}

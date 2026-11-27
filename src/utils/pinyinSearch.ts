import { pinyin } from 'pinyin-pro';
import { ContactItem, DirectoryContact } from '../types/mail';

interface PinyinIndexEntry {
  key: string;
  lowerName: string;
  lowerEmail: string;
  lowerLocal: string;
  lowerMeta: string;
  initials: string;
  fullPinyin: string;
  metaInitials: string;
}

const pinyinCache = new Map<string, PinyinIndexEntry>();

function toPinyinKeys(text: string): { initials: string; full: string } {
  const cleaned = text.trim();
  if (!cleaned) return { initials: '', full: '' };
  try {
    const firstArr = pinyin(cleaned, {
      pattern: 'first',
      toneType: 'none',
      type: 'array',
    });
    const fullArr = pinyin(cleaned, {
      toneType: 'none',
      type: 'array',
    });
    const initials = firstArr
      .join('')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const full = fullArr
      .join('')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return { initials, full };
  } catch {
    const fallback = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
    return { initials: fallback, full: fallback };
  }
}

function getIndexEntry(contact: ContactItem): PinyinIndexEntry {
  const meta = `${contact.department || ''} ${contact.role || ''}`.trim();
  const cacheKey = `${contact.email.toLowerCase()}|${contact.name}|${meta}`;
  const cached = pinyinCache.get(cacheKey);
  if (cached) return cached;

  const lowerEmail = contact.email.trim().toLowerCase();
  const lowerLocal = lowerEmail.split('@')[0] || '';
  const lowerName = contact.name.trim().toLowerCase();
  const lowerMeta = meta.toLowerCase();
  const namePy = toPinyinKeys(contact.name);
  const metaPy = meta ? toPinyinKeys(meta) : { initials: '', full: '' };

  const entry: PinyinIndexEntry = {
    key: cacheKey,
    lowerName,
    lowerEmail,
    lowerLocal,
    lowerMeta,
    initials: namePy.initials,
    fullPinyin: namePy.full,
    metaInitials: metaPy.initials,
  };
  pinyinCache.set(cacheKey, entry);
  return entry;
}

function scoreContact(contact: ContactItem, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase();
  const compactQ = q.replace(/\s+/g, '');
  if (!compactQ) return 0;

  const idx = getIndexEntry(contact);
  let score = 0;

  if (idx.initials && idx.initials === compactQ) {
    score = 1100;
  } else if (idx.initials && idx.initials.startsWith(compactQ)) {
    score = 1000;
  } else if (idx.lowerName.startsWith(q)) {
    score = 960;
  } else if (idx.fullPinyin && idx.fullPinyin.startsWith(compactQ)) {
    score = 920;
  } else if (idx.lowerLocal.startsWith(compactQ)) {
    score = 880;
  } else if (idx.initials && idx.initials.includes(compactQ)) {
    score = 740;
  } else if (idx.lowerName.includes(q)) {
    score = 700;
  } else if (idx.fullPinyin && idx.fullPinyin.includes(compactQ)) {
    score = 660;
  } else if (idx.lowerEmail.includes(compactQ)) {
    score = 600;
  } else if (
    (idx.lowerMeta && idx.lowerMeta.includes(q)) ||
    (idx.metaInitials && idx.metaInitials.includes(compactQ))
  ) {
    score = 500;
  }

  if (score === 0) return 0;

  if (contact.starred) score += 45;
  if (contact.source === 'carddav' || contact.source === 'import') score += 25;
  score += Math.min(20, contact.threads.length * 2);
  return score;
}

export function searchContactsWithPinyin(
  contacts: ContactItem[],
  query: string,
  excludeEmails: string[] = [],
  limit = 8
): ContactItem[] {
  const excludeSet = new Set(excludeEmails.map((e) => e.trim().toLowerCase()));
  const candidates = contacts.filter((c) => {
    const lower = c.email.trim().toLowerCase();
    return lower.includes('@') && !excludeSet.has(lower);
  });

  const q = query.trim();
  if (!q) {
    return [...candidates]
      .sort((a, b) => {
        const aScore =
          (a.starred ? 100 : 0) +
          (a.source === 'carddav' || a.source === 'import' ? 30 : 0) +
          Math.min(40, a.threads.length * 4);
        const bScore =
          (b.starred ? 100 : 0) +
          (b.source === 'carddav' || b.source === 'import' ? 30 : 0) +
          Math.min(40, b.threads.length * 4);
        if (bScore !== aScore) return bScore - aScore;
        return a.name.localeCompare(b.name, 'zh-CN');
      })
      .slice(0, limit);
  }

  return candidates
    .map((contact) => ({ contact, score: scoreContact(contact, q) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.contact.name.localeCompare(b.contact.name, 'zh-CN');
    })
    .slice(0, limit)
    .map((item) => item.contact);
}

export function matchesContactQuery(contact: ContactItem, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (scoreContact(contact, q) > 0) return true;
  const lower = q.toLowerCase();
  return contact.attachments.some((a) => a.name.toLowerCase().includes(lower));
}

/**
 * Browser-side VCF / CSV parser for web preview fallback when Tauri desktop runtime is absent.
 */
export function parseClientContactsFile(rawText: string, filename: string): DirectoryContact[] {
  const cleaned = rawText.replace(/^\uFEFF/, '');
  const nowStr = new Date().toLocaleDateString('zh-CN');
  const isCsv =
    filename.toLowerCase().endsWith('.csv') ||
    (!cleaned.includes('BEGIN:VCARD') && cleaned.includes(','));

  const results: DirectoryContact[] = [];

  if (isCsv) {
    const lines = cleaned.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
    const findIdx = (keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));
    const emailIdx = findIdx(['电子邮件', '邮箱', 'email', 'e-mail', 'mail']);
    const nameIdx = findIdx(['姓名', '名字', '显示名', '名称', 'name']);
    const deptIdx = findIdx(['部门', '组织', '公司', 'department', 'company', 'org']);
    const roleIdx = findIdx(['职位', '职务', 'title', 'role']);

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      const email =
        (emailIdx >= 0 ? cols[emailIdx] : cols.find((c) => c.includes('@')))?.toLowerCase() || '';
      if (!email.includes('@')) continue;
      const name = (nameIdx >= 0 ? cols[nameIdx] : '') || email.split('@')[0];
      results.push({
        email,
        name,
        department: deptIdx >= 0 ? cols[deptIdx] || '' : '',
        role: roleIdx >= 0 ? cols[roleIdx] || '' : '',
        source: 'import',
        updatedAt: nowStr,
      });
    }
    return results;
  }

  // vCard fallback parser
  const unfolded = cleaned.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  for (const card of cards) {
    let fn = '';
    let org = '';
    let title = '';
    const emails: string[] = [];
    for (const line of card.split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).toUpperCase().split(';')[0].split('.').pop() || '';
      const val = line.slice(idx + 1).trim();
      if (key === 'FN' && val) fn = val;
      else if (key === 'ORG' && val) org = val.replace(/;/g, ' / ').replace(/^\s*\/\s*|\s*\/\s*$/g, '');
      else if (key === 'TITLE' && val) title = val;
      else if (key === 'EMAIL' && val.includes('@')) emails.push(val.toLowerCase());
    }
    for (const email of emails) {
      results.push({
        email,
        name: fn || email.split('@')[0],
        department: org,
        role: title,
        source: 'import',
        updatedAt: nowStr,
      });
    }
  }
  return results;
}

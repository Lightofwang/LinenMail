const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
};

function decodeEntitiesOnce(text: string): string {
  return text.replace(
    /&([a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);?/g,
    (match, entity: string) => {
      const hasSemicolon = match.endsWith(';');
      const lower = entity.toLowerCase();
      // Only decode without trailing semicolon for known whitespace entity &nbsp
      if (!hasSemicolon && lower !== 'nbsp') {
        return match;
      }
      if (lower in NAMED_ENTITIES) {
        return NAMED_ENTITIES[lower];
      }
      if (lower.startsWith('#x')) {
        const code = parseInt(lower.slice(2), 16);
        if (code === 0xa0) return ' ';
        if (code >= 32 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code);
          } catch {
            return match;
          }
        }
      } else if (lower.startsWith('#')) {
        const code = parseInt(lower.slice(1), 10);
        if (code === 160) return ' ';
        if (code >= 32 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code);
          } catch {
            return match;
          }
        }
      }
      return match;
    }
  );
}

/**
 * Safely decodes single- or double-encoded HTML entities in plain-text email
 * previews & bodies (e.g. WeCom / QQ Mail &nbsp; or &amp;nbsp;) without ever
 * parsing or injecting HTML into the DOM.
 */
export function cleanMailText(raw: string): string {
  if (!raw) return '';
  let result = raw;

  // Run up to 3 passes to unwind double-encoded entities like &amp;nbsp;
  for (let pass = 0; pass < 3; pass++) {
    if (!result.includes('&')) break;
    const next = decodeEntitiesOnce(result);
    if (next === result) break;
    result = next;
  }

  return result
    .replace(/[\u00a0\u2002\u2003\u2009]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

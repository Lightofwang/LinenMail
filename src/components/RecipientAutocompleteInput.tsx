import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ContactItem } from '../types/mail';
import { searchContactsWithPinyin } from '../utils/pinyinSearch';

interface RecipientAutocompleteInputProps {
  values: string[];
  onChange: (next: string[]) => void;
  contacts: ContactItem[];
  placeholder?: string;
  ariaLabel?: string;
  inputValue?: string;
  onInputValueChange?: (val: string) => void;
}

export const RecipientAutocompleteInput: React.FC<RecipientAutocompleteInputProps> = ({
  values,
  onChange,
  contacts,
  placeholder = '输入姓名、拼音首字母或邮箱...',
  ariaLabel = '添加邮箱地址',
  inputValue: controlledInput,
  onInputValueChange,
}) => {
  const [internalInput, setInternalInput] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const query = controlledInput !== undefined ? controlledInput : internalInput;
  const setQuery = (val: string) => {
    if (onInputValueChange) onInputValueChange(val);
    if (controlledInput === undefined) setInternalInput(val);
  };

  const contactNameByEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of contacts) {
      map.set(c.email.trim().toLowerCase(), c.name);
    }
    return map;
  }, [contacts]);

  const suggestions = useMemo(() => {
    if (!open) return [];
    // Show suggestions when typing, or show top frequent contacts on focus if we have contacts
    if (!query.trim() && contacts.length === 0) return [];
    return searchContactsWithPinyin(contacts, query, values, 8);
  }, [contacts, query, values, open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, suggestions.length]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addEmail = (raw: string) => {
    const cleaned = raw.trim().replace(/[,;]+$/, '').trim();
    if (!cleaned) return;
    // Allow pasting multiple comma/semicolon-separated emails at once
    const parts = cleaned
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const next = [...values];
    for (const part of parts) {
      const match = part.match(/<([^>]+)>/);
      const email = (match ? match[1] : part).trim();
      if (email && !next.some((existing) => existing.toLowerCase() === email.toLowerCase())) {
        next.push(email);
      }
    }
    onChange(next);
    setQuery('');
    setActiveIndex(0);
  };

  const selectContact = (contact: ContactItem) => {
    addEmail(contact.email);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (!open && contacts.length > 0) {
        setOpen(true);
        return;
      }
      if (suggestions.length > 0) {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % suggestions.length);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      if (suggestions.length > 0) {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      }
      return;
    }

    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (open && suggestions.length > 0 && query.trim()) {
        e.preventDefault();
        const picked = suggestions[Math.min(activeIndex, suggestions.length - 1)];
        if (picked) selectContact(picked);
        return;
      }
      if (e.key === 'Enter' && query.trim()) {
        e.preventDefault();
        addEmail(query);
        setOpen(false);
        return;
      }
    }

    if ((e.key === ',' || e.key === ';') && query.trim()) {
      e.preventDefault();
      if (open && suggestions.length > 0 && !query.includes('@')) {
        const picked = suggestions[Math.min(activeIndex, suggestions.length - 1)];
        if (picked) {
          selectContact(picked);
          return;
        }
      }
      addEmail(query);
      return;
    }

    if (e.key === 'Backspace' && !query && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const formatChipLabel = (email: string) => {
    const name = contactNameByEmail.get(email.trim().toLowerCase());
    if (name && name.toLowerCase() !== email.split('@')[0]?.toLowerCase()) {
      return `${name} <${email}>`;
    }
    return email;
  };

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <div
        className="flex items-center flex-wrap gap-gutter-xs"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((email) => (
          <span
            key={email}
            title={email}
            className="inline-flex items-center gap-gutter-xs pl-gutter-md pr-gutter-xs py-gutter-xs rounded-full bg-light-secondary-container text-light-on-secondary-container max-w-full"
          >
            <span className="font-label text-label-md truncate max-w-[260px]">
              {formatChipLabel(email)}
            </span>
            <button
              type="button"
              aria-label={`移除 ${email}`}
              onClick={(ev) => {
                ev.stopPropagation();
                onChange(values.filter((item) => item !== email));
              }}
              className="inline-flex items-center justify-center w-5 h-5 rounded-full hover:bg-light-surface-container-lowest transition-colors duration-state-change cursor-pointer shrink-0"
            >
              <span className="material-symbols-outlined text-body-sm" aria-hidden="true">
                close
              </span>
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => {
            if (contacts.length > 0) setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Delay commit slightly so dropdown mousedown fires first
            setTimeout(() => {
              if (!containerRef.current?.contains(document.activeElement)) {
                setOpen(false);
                if (query.trim().includes('@')) {
                  addEmail(query);
                }
              }
            }, 120);
          }}
          aria-label={ariaLabel}
          placeholder={values.length === 0 ? placeholder : '继续添加...'}
          className="min-w-[180px] flex-1 bg-transparent border-0 p-0 font-body text-body-md text-light-on-surface placeholder:text-light-on-surface-variant focus:ring-0 focus:outline-none"
        />
      </div>

      {/* Pinyin & Name Autocomplete Dropdown */}
      {open && suggestions.length > 0 && (
        <div
          role="listbox"
          aria-label="联系人联想建议"
          className="absolute left-0 top-full mt-2 w-full max-w-[440px] max-h-72 overflow-y-auto linen-scroll bg-light-surface-container-lowest rounded-xl p-1.5 shadow-[0_18px_42px_-10px_rgba(35,25,20,0.18)] ring-1 ring-light-outline-variant/45 z-50 flex flex-col gap-0.5"
        >
          <div className="px-2.5 py-1 flex items-center justify-between text-label-sm font-label text-light-on-surface-variant">
            <span>{query.trim() ? '拼音 / 通讯录联想' : '常用联系人'}</span>
            <span>↑↓ 选择 · Enter 确认</span>
          </div>

          {suggestions.map((contact, idx) => {
            const isHighlighted = idx === activeIndex;
            const sourceTag =
              contact.source === 'carddav'
                ? '企业通讯录'
                : contact.source === 'import'
                ? '已导入'
                : null;

            return (
              <button
                key={contact.email}
                type="button"
                role="option"
                aria-selected={isHighlighted}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectContact(contact);
                }}
                className={`w-full text-left flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg transition-colors duration-state-change cursor-pointer ${
                  isHighlighted
                    ? 'bg-light-secondary-container/70 text-light-on-surface'
                    : 'hover:bg-light-surface-container-low text-light-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-full bg-light-surface-container-high text-light-primary font-title text-title-sm inline-flex items-center justify-center shrink-0">
                    {contact.initials}
                  </span>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-title text-title-sm text-light-on-surface truncate">
                        {contact.name}
                      </span>
                      {contact.department && (
                        <span className="font-label text-label-sm text-light-on-surface-variant truncate">
                          · {contact.department}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-mono-sm text-light-on-surface-variant truncate">
                      {contact.email}
                    </span>
                  </div>
                </div>

                {sourceTag && (
                  <span className="shrink-0 px-2 py-0.5 rounded-full bg-light-surface-container-low text-light-on-surface-variant font-label text-label-sm">
                    {sourceTag}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

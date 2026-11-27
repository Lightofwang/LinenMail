import React from 'react';

interface SwitchToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}

export const SwitchToggle: React.FC<SwitchToggleProps> = ({ checked, onChange, ariaLabel }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-state-change focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-primary ${
        checked ? 'bg-light-primary' : 'bg-light-surface-container-highest'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-light-surface-container-lowest transition-transform duration-state-change ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
};

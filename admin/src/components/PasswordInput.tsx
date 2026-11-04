import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// The admin app's own copy of src/components/PasswordInput.tsx (admin/ is a separate app and imports nothing from src/; keep the two in step).
// A password box with an eye button inside it: click it to see what you typed, click again to hide it (CEO, 4 Nov 2026).

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const SHOW_PASSWORD_LABEL = 'Show password';
export const HIDE_PASSWORD_LABEL = 'Hide password';

export const PasswordInput: React.FC<Props> = ({ className, style, ...rest }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        className={className}
        style={{ ...style, paddingRight: '3rem' }}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={visible ? HIDE_PASSWORD_LABEL : SHOW_PASSWORD_LABEL}
        aria-pressed={visible}
        title={visible ? HIDE_PASSWORD_LABEL : SHOW_PASSWORD_LABEL}
        className="absolute inset-y-0 right-0 flex items-center justify-center w-11 text-slate-400 hover:text-slate-600 focus-visible:text-[#15803D] focus:outline-none cursor-pointer"
      >
        {visible ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
      </button>
    </div>
  );
};

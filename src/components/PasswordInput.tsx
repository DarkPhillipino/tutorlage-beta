import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// A password box with an eye button inside it: click it to see what you typed, click again to hide it (CEO, 4 Nov 2026).
// Every password box in the app uses this, so they all behave the same. It takes every normal <input> attribute except `type`.
// The box always starts hidden, and goes back to hidden whenever the screen is left (the choice is not stored anywhere).
// The eye is a real button (reachable with the Tab key, named for screen readers) and sits inside the box on the right; the box keeps
// room for it with inline padding so the text never runs underneath it.

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
        // Stops the browser, the password manager and spell-check from treating the revealed text as ordinary text to remember.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Keep the cursor in the box when the eye is pressed with a mouse or finger, so typing can carry on straight away.
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

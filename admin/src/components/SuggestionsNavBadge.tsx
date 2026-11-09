import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { COUNT_EVERY_MS, SUGGESTIONS_CHANGED_EVENT, countNewSuggestions, type SuggestionsClient } from '../lib/suggestions';

const db = supabase as unknown as SuggestionsClient;

// The unread count beside "Suggestions" in the menu: how many suggestions are still "new". Reads again every minute, when the admin comes back to the
// window, and when the Suggestions page handles one. Draws nothing for 0, and 0 is also what a database without the table answers.
export const SuggestionsNavBadge: React.FC = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let stopped = false;
    const read = () => {
      countNewSuggestions(db).then((n) => {
        if (!stopped) setCount(n);
      });
    };
    read();
    const timer = window.setInterval(read, COUNT_EVERY_MS);
    window.addEventListener(SUGGESTIONS_CHANGED_EVENT, read);
    window.addEventListener('focus', read);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener(SUGGESTIONS_CHANGED_EVENT, read);
      window.removeEventListener('focus', read);
    };
  }, []);
  if (count <= 0) return null;
  return (
    <span
      data-suggestions-unread
      aria-label={`${count} new ${count === 1 ? 'suggestion' : 'suggestions'}`}
      className="ml-auto min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-amber-400 text-[#0A192F] text-[10px] font-extrabold text-center"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
};

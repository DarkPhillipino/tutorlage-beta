import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { AppNotification } from '../types';
import { fetchMyNotifications, markNotificationsRead } from '../lib/queries';
import { useAuth } from '../lib/AuthContext';

// The database has written notifications since the first session features
// (a tutor accepted, a meeting link was added, a session was cancelled or
// completed, a refund was processed or a card couldn't be charged), but no
// screen showed them. This is the one place they appear. Opening the list
// marks what's shown as read.
export const NotificationsBell: React.FC = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      setItems(await fetchMyNotifications(user.id));
    } catch (err) {
      console.error('fetchMyNotifications failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Load on sign-in, then every two minutes so new ones show without a reload.
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 120_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const unread = items.filter((n) => !n.readAt);

  const toggle = async () => {
    const opening = !isOpen;
    setIsOpen(opening);
    if (opening && unread.length > 0) {
      const ids = unread.map((n) => n.id);
      try {
        await markNotificationsRead(ids);
        const now = new Date().toISOString();
        setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: now } : n)));
      } catch (err) {
        console.error('markNotificationsRead failed:', err);
      }
    }
  };

  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={toggle}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        className="relative w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
        aria-label={unread.length ? `Notifications, ${unread.length} new` : 'Notifications'}
      >
        <Bell className="w-5 h-5 text-[#0F172A]" />
        {unread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#15803D] text-white text-[10px] font-bold flex items-center justify-center">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50">
          {isLoading && items.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-xs text-slate-500 text-center">Nothing new. Updates about your sessions and payments appear here.</p>
          ) : (
            items.map((n) => (
              <div key={n.id} className={`px-4 py-3 border-b border-slate-100 last:border-0 ${n.readAt ? '' : 'bg-emerald-50/60'}`}>
                <div className="text-xs font-bold text-[#0F172A]">{n.title}</div>
                {n.body && <div className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">{n.body}</div>}
                <div className="text-[10px] text-slate-400 mt-1">{new Date(n.createdAt).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Loader2, Settings, Plus } from 'lucide-react';
import { fetchSystemSettings, upsertSystemSetting } from '../lib/queries';
import { useAdminAuth } from '../lib/AuthContext';
import { SystemSetting } from '../types';
import { getErrorMessage } from '../lib/errors';

export const SystemSettingsPage: React.FC = () => {
  const { adminProfile } = useAdminAuth();
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setIsLoading(true);
    fetchSystemSettings().then(setSettings).catch(() => setSettings([])).finally(() => setIsLoading(false));
  };

  useEffect(load, []);

  const handleAdd = async () => {
    if (!adminProfile || !newKey.trim()) return;
    setError(null);
    let parsedValue: unknown = newValue;
    try {
      parsedValue = JSON.parse(newValue);
    } catch {
      // Plain string values are fine too — not every setting is JSON.
    }
    setIsSaving(true);
    try {
      await upsertSystemSetting(newKey.trim(), parsedValue, adminProfile.id);
      setNewKey('');
      setNewValue('');
      load();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save that setting.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-extrabold text-[#0F172A] mb-6">System Settings</h1>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-semibold">Loading settings…</span>
        </div>
      ) : settings.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center mb-4">
          <Settings className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-[#0F172A]">No settings configured yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden mb-4">
          {settings.map((s) => (
            <div key={s.settingKey} className="p-4">
              <div className="text-sm font-bold text-[#0F172A]">{s.settingKey}</div>
              {s.description && <div className="text-xs text-slate-500 mt-0.5">{s.description}</div>}
              <pre className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2 mt-1.5 overflow-x-auto">{JSON.stringify(s.settingValue, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl p-4 border border-slate-200">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Add / Update Setting</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="setting_key"
            className="flex-1 min-w-[8rem] bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder='value (JSON or plain text)'
            className="flex-1 min-w-[8rem] bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          />
          <button
            onClick={handleAdd}
            disabled={isSaving}
            className="flex items-center gap-1 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold px-3 py-2.5 rounded-lg cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
        {error && <p className="text-xs text-rose-600 font-semibold mt-2">{error}</p>}
      </div>
    </div>
  );
};

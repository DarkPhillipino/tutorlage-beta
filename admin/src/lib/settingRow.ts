// The row the System Settings screens send to public.system_settings (used by queries.ts upsertSystemSetting).
//
// A description is part of the row only when the caller gives one. The save is an upsert, and an upsert writes exactly the columns it is
// sent: leaving `description` out keeps the saved text, sending null would blank it. (Before 4 Nov 2026 this file did not exist and the
// row always carried `description: description ?? null`, so saving a value from the 'Add / Update Setting' box wiped that setting's
// description.) Pass null on purpose to clear a description.
export interface SettingRow {
  setting_key: string;
  setting_value: unknown;
  last_updated_by: string;
  updated_at: string;
  description?: string | null;
}

export function settingRow(key: string, value: unknown, adminId: string, description?: string | null, now: Date = new Date()): SettingRow {
  const row: SettingRow = { setting_key: key, setting_value: value, last_updated_by: adminId, updated_at: now.toISOString() };
  if (description !== undefined) row.description = description;
  return row;
}

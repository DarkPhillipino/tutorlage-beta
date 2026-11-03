import React, { useCallback, useEffect, useState } from 'react';
import {
  BankDetails, ClosedWallets, PayoutQueue, PayoutRow, SettingWriter, SettingsLoad, TopupQueue, TopupRow, TotalsResult, WalletAdminClient, WalletDetail, WalletList, WalletListRow,
  SWITCH_KEY, addTopupByHand, adjustWallet, canAdjustWallet, canUseWallet, fetchClosedAccountWallets, fetchPayoutQueue, fetchTopupQueue, fetchTotals, fetchWalletDetail,
  fetchWalletList, fetchWalletSettings, markPayoutCannotPay, markPayoutPaid, markTopupSuccessful, markTopupUnsuccessful, openBankDetails, openTutorBankDetails, planSettingSaves,
  rand0, refreshWalletRow, refundResultSentence, refundToWallet, returnWalletMoney, runBalanceCheck, saveSettingWrites, settingLabel, viewProof, walletErrorMessage,
} from '../lib/walletAdmin';
import type { EdgeHandlers } from './WalletEdgeForms';
import type { AdminRole } from '../types';
import { DocumentViewer, type ViewerDocument } from './DocumentViewer';
import { AccessLogNote } from './AccessLogNote';
import { Loading } from './WalletParts';
import { WalletTopupsBody } from './WalletTopupsBody';
import { WalletPayoutsBody } from './WalletPayoutsBody';
import { WalletBalancesBody, type CheckState } from './WalletBalancesBody';
import { WalletSettingsBody } from './WalletSettingsBody';

// The wallet tabs of the Payments page (phase 4 of the wallet + manual bank transfer work). This file only loads and calls: the screens are the
// *Body components, the rules and every database call are in lib/walletAdmin.ts. The database client is a prop (the page hands in the admin
// app's own), so a practice page can hand in a pretend one. Nothing renders for an admin who is not a finance manager or a super admin.

export type TabId = 'topups' | 'payouts' | 'wallets' | 'settings';
export const walletTabFromSearch = (value: string | null | undefined): TabId | undefined =>
  value === 'topups' || value === 'payouts' || value === 'wallets' || value === 'settings' ? value : undefined;
interface Props {
  client: WalletAdminClient;
  role: AdminRole | null | undefined;
  // The System Settings write path (queries.ts upsertSystemSetting, bound to the signed-in admin).
  saveSetting: SettingWriter;
  // The tab to open first (a clicked Windows notification opens /payouts?wallet=topups ...). Default: top-ups to check.
  initialTab?: TabId;
}

const TopupsTab: React.FC<{ client: WalletAdminClient; onChanged: () => void }> = ({ client, onChanged }) => {
  const [queue, setQueue] = useState<TopupQueue | null>(null);
  const [viewing, setViewing] = useState<ViewerDocument | null>(null);
  const [logNotActive, setLogNotActive] = useState(false);
  const load = useCallback(() => { void fetchTopupQueue(client).then(setQueue); }, [client]);
  useEffect(load, [load]);

  const view = (row: TopupRow) => {
    if (!row.proofPath) return;
    const path = row.proofPath;
    setViewing({
      key: row.id,
      title: `Proof of payment: ${row.payerName}`,
      subtitle: `Reference ${row.reference} · claimed ${rand0(row.claimedRand)}`,
      open: () => viewProof(client, path, row.payerId),
    });
  };
  const done = (changed: boolean) => { if (changed) { load(); onChanged(); } };

  if (!queue) return <Loading text="Loading top-ups…" />;
  return (
    <>
      <AccessLogNote show={logNotActive} />
      {viewing && <DocumentViewer documents={[viewing]} onClose={() => setViewing(null)} onOpened={(v) => setLogNotActive(!v.logged)} />}
      <WalletTopupsBody
        queue={queue}
        onView={view}
        onRetry={load}
        onSuccessful={async (row, received, comment) => {
          try { await markTopupSuccessful(client, row.id, received, comment); done(true); return null; } catch (e) { return walletErrorMessage(e); }
        }}
        onUnsuccessful={async (row, comment) => {
          try { await markTopupUnsuccessful(client, row.id, comment); done(true); return null; } catch (e) { return walletErrorMessage(e); }
        }}
      />
    </>
  );
};

const PayoutsTab: React.FC<{ client: WalletAdminClient; onChanged: () => void }> = ({ client, onChanged }) => {
  const [queue, setQueue] = useState<PayoutQueue | null>(null);
  const load = useCallback(() => { void fetchPayoutQueue(client).then(setQueue); }, [client]);
  useEffect(load, [load]);
  if (!queue) return <Loading text="Loading payout requests…" />;
  return (
    <WalletPayoutsBody
      queue={queue}
      onRetry={load}
      onOpenBank={(row: PayoutRow): Promise<BankDetails> => openBankDetails(client, row.id)}
      onPaid={async (row, reference, paidOn) => {
        try { await markPayoutPaid(client, row.id, reference, paidOn); load(); onChanged(); return null; } catch (e) { return walletErrorMessage(e); }
      }}
      onCannotPay={async (row, comment) => {
        try { await markPayoutCannotPay(client, row.id, comment); load(); onChanged(); return null; } catch (e) { return walletErrorMessage(e); }
      }}
    />
  );
};

const WalletsTab: React.FC<{ client: WalletAdminClient; role: AdminRole | null | undefined; onChanged: () => void }> = ({ client, role, onChanged }) => {
  const [totals, setTotals] = useState<TotalsResult | null>(null);
  const [list, setList] = useState<WalletList | null>(null);
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<{ row: WalletListRow; detail: WalletDetail | null } | null>(null);
  const [check, setCheck] = useState<CheckState>({ state: 'idle' });
  const [closed, setClosed] = useState<ClosedWallets | null>(null);

  const loadTotals = useCallback(() => { void fetchTotals(client).then(setTotals); }, [client]);
  const search = useCallback((text: string) => { void fetchWalletList(client, text).then(setList); }, [client]);
  const loadClosed = useCallback(() => { void fetchClosedAccountWallets(client).then(setClosed); }, [client]);
  useEffect(() => { loadTotals(); search(''); loadClosed(); }, [loadTotals, search, loadClosed]);

  const select = (row: WalletListRow | null) => {
    if (!row) return setSelected(null);
    setSelected({ row, detail: null });
    void fetchWalletDetail(client, row.profileId).then((detail) => setSelected((current) => (current && current.row.profileId === row.profileId ? { row: current.row, detail } : current)));
  };
  const runCheck = () => {
    setCheck({ state: 'running' });
    runBalanceCheck(client).then((result) => setCheck({ state: 'done', result })).catch((e) => setCheck({ state: 'error', message: walletErrorMessage(e) }));
  };
  const refresh = () => { loadTotals(); search(term); loadClosed(); };

  // After a money action: the figures, the lists and this person's card are loaded again, but the card keeps its old content until the new one arrives, so the
  // sentence saying what just happened stays on the screen.
  const reloadSelected = async (row: WalletListRow) => {
    refresh();
    onChanged();
    const fresh = await refreshWalletRow(client, row);
    setSelected((cur) => (cur && cur.row.profileId === row.profileId ? { row: fresh, detail: cur.detail } : cur));
    const detail = await fetchWalletDetail(client, row.profileId);
    setSelected((cur) => (cur && cur.row.profileId === row.profileId ? { row: fresh, detail } : cur));
  };
  const edge: EdgeHandlers = {
    onRefund: async (session, amount, reason, takeBack, key) => {
      try {
        const result = await refundToWallet(client, session.sessionId, amount, reason, takeBack, key);
        if (selected) await reloadSelected(selected.row);
        return { ok: true, message: refundResultSentence(result, session.tutorName) };
      } catch (e) {
        return { ok: false, error: walletErrorMessage(e) };
      }
    },
    onReturn: async (row, amount, reason, reference, key) => {
      try {
        const result = await returnWalletMoney(client, row.profileId, amount, reason, reference, key);
        await reloadSelected(row);
        return { ok: true, message: result.already ? 'That was already recorded. Nothing more was posted.' : `${rand0(amount)} recorded as returned to ${row.name}. It is in their ledger.` };
      } catch (e) {
        return { ok: false, error: walletErrorMessage(e) };
      }
    },
    onHandTopup: async (row, amount, reason, reference, key) => {
      try {
        const result = await addTopupByHand(client, row.profileId, amount, reference, reason, key);
        await reloadSelected(row);
        return { ok: true, message: result.already ? 'That top-up was already added. Nothing more was posted.' : `${rand0(amount)} added to ${row.name}'s wallet (reference ${result.reference}). They were told.` };
      } catch (e) {
        return { ok: false, error: walletErrorMessage(e) };
      }
    },
    onOpenTutorBank: (row) => openTutorBankDetails(client, row.profileId),
  };

  if (!totals || !list) return <Loading text="Loading wallets…" />;
  return (
    <WalletBalancesBody
      totals={totals}
      list={list}
      term={term}
      onTerm={setTerm}
      onSearch={() => search(term)}
      selected={selected}
      onSelect={select}
      check={check}
      onRunCheck={runCheck}
      canAdjust={canAdjustWallet(role)}
      onRetry={refresh}
      closed={closed}
      edge={edge}
      onAdjust={async (row, amount, reason, key) => {
        try {
          await adjustWallet(client, row.profileId, amount, reason, key);
          refresh();
          onChanged();
          const fresh = await fetchWalletList(client, row.name);
          const updated = fresh.state === 'ok' ? fresh.wallets.find((w) => w.profileId === row.profileId) : undefined;
          select(updated ?? row);
          return null;
        } catch (e) {
          return walletErrorMessage(e);
        }
      }}
    />
  );
};

const SettingsTab: React.FC<{ client: WalletAdminClient; saveSetting: SettingWriter; onChanged: () => void }> = ({ client, saveSetting, onChanged }) => {
  const [load, setLoad] = useState<SettingsLoad | null>(null);
  const reload = useCallback(() => fetchWalletSettings(client).then(setLoad), [client]);
  useEffect(() => { void reload(); }, [reload]);
  if (!load) return <Loading text="Loading settings…" />;
  return (
    <WalletSettingsBody
      load={load}
      onRetry={() => { void reload(); }}
      onSave={async (next) => {
        if (load.state !== 'ok') return 'The settings are not loaded.';
        const result = await saveSettingWrites(saveSetting, planSettingSaves(load.values, next), load.values.descriptions);
        await reload();
        onChanged();
        if (!result.failed) return null;
        const before = result.saved.length > 0 ? ` Saved before that: ${result.saved.map(settingLabel).join(', ')}.` : '';
        return `${settingLabel(result.failed.key)} was not saved: ${result.failed.message}${before}`;
      }}
      onSwitch={async (enabled) => {
        if (load.state !== 'ok') return 'The settings are not loaded.';
        const result = await saveSettingWrites(saveSetting, [{ key: SWITCH_KEY, value: enabled }], load.values.descriptions);
        await reload();
        return result.failed ? `The switch was not changed: ${result.failed.message}` : null;
      }}
    />
  );
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'topups', label: 'Top-ups to check' },
  { id: 'payouts', label: 'Payout requests' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'settings', label: 'Wallet settings' },
];

export const WalletTabs: React.FC<Props> = ({ client, role, saveSetting, initialTab }) => {
  const [tab, setTab] = useState<TabId>(initialTab ?? 'topups');
  const [totals, setTotals] = useState<TotalsResult | null>(null);
  const loadTotals = useCallback(() => { void fetchTotals(client).then(setTotals); }, [client]);
  useEffect(() => { if (canUseWallet(role)) loadTotals(); }, [loadTotals, role]);

  // A support or verification admin sees nothing of this (and the database refuses them anyway).
  if (!canUseWallet(role)) return null;
  const badge = (id: TabId): number => {
    if (totals?.state !== 'ok') return 0;
    return id === 'topups' ? totals.totals.proofSent : id === 'payouts' ? totals.totals.payoutsRequested : 0;
  };

  return (
    <section data-wallet-tabs aria-label="Wallet and bank transfers">
      <div className="flex flex-wrap items-baseline gap-x-3 mb-1">
        <h2 className="text-lg font-extrabold text-[#0F172A]">Wallets and bank transfers</h2>
        <span className="text-xs text-slate-500">Learners add money by bank transfer; you check it by hand. Tutors ask to be paid; you pay by hand.</span>
      </div>
      <div role="tablist" aria-label="Wallet tabs" className="flex flex-wrap gap-1 border-b border-slate-200 mb-4">
        {TABS.map((t) => {
          const count = badge(t.id);
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              id={`wallet-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`wallet-panel-${t.id}`}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-bold rounded-t-xl border-b-2 cursor-pointer ${active ? 'border-[#15803D] text-[#15803D] bg-white' : 'border-transparent text-slate-500 hover:text-[#0F172A]'}`}
            >
              {t.label}
              {count > 0 && <span data-badge className="ml-1.5 inline-block min-w-5 text-center text-[10px] font-extrabold bg-rose-600 text-white rounded-full px-1.5 py-0.5">{count}</span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`wallet-panel-${tab}`} aria-labelledby={`wallet-tab-${tab}`}>
        {tab === 'topups' && <TopupsTab client={client} onChanged={loadTotals} />}
        {tab === 'payouts' && <PayoutsTab client={client} onChanged={loadTotals} />}
        {tab === 'wallets' && <WalletsTab client={client} role={role} onChanged={loadTotals} />}
        {tab === 'settings' && <SettingsTab client={client} saveSetting={saveSetting} onChanged={loadTotals} />}
      </div>
    </section>
  );
};

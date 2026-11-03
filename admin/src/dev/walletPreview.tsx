import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletTabs } from '../components/WalletTabs';
import type { WalletAdminClient } from '../lib/walletAdmin';
import type { AdminRole } from '../types';
import '../index.css';

// A practice copy of the wallet tabs of the Payments page. The REAL screens and the REAL rules (lib/walletAdmin.ts) run against a pretend
// database made in this page: three top-ups with proof, one waiting for proof, two payout requests, four wallets, a few ledger lines and the
// wallet settings. Pressing Successful, Mark paid, Adjust and Save changes the pretend data (so the lists update), nothing is sent anywhere, no
// sign-in is needed, and every name, number and bank detail below is made up. Open http://localhost:3198/dev-wallet.html. The real page is pages/Payouts.tsx.

type Row = Record<string, unknown>;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const db = {
  profiles: [
    { id: ID(1), full_name: 'Thandi Pretend', role: 'student' }, { id: ID(2), full_name: 'Nomsa Pretend', role: 'parent' },
    { id: ID(3), full_name: 'Sipho Pretend', role: 'tutor' }, { id: ID(4), full_name: 'Lerato Pretend', role: 'student' },
  ] as Row[],
  wallet_topups: [
    { id: 't1', profile_id: ID(2), reference: 'TL-7K4M9Q', amount_rand: 500, status: 'proof_sent', proof_path: `${ID(2)}/t1.png`, proof_attached_at: hoursAgo(30), received_rand: null, decided_at: null, decision_comment: null, created_at: hoursAgo(31) },
    { id: 't2', profile_id: ID(1), reference: 'TL-A2B3C4', amount_rand: 200, status: 'proof_sent', proof_path: `${ID(1)}/t2.png`, proof_attached_at: hoursAgo(2), received_rand: null, decided_at: null, decision_comment: null, created_at: hoursAgo(3) },
    { id: 't3', profile_id: ID(4), reference: 'TL-ZZ9YX8', amount_rand: 100, status: 'awaiting_proof', proof_path: null, proof_attached_at: null, received_rand: null, decided_at: null, decision_comment: null, created_at: hoursAgo(1) },
    { id: 't0', profile_id: ID(1), reference: 'TL-OLD123', amount_rand: 150, status: 'successful', proof_path: null, proof_attached_at: null, received_rand: 150, decided_at: hoursAgo(50), decision_comment: null, created_at: hoursAgo(60) },
  ] as Row[],
  payout_requests: [
    { id: 'p1', tutor_id: ID(3), amount_rand: 640, status: 'requested', bank_details_changed_at: hoursAgo(40), session_ids: ['s1', 's2'], requested_at: hoursAgo(26), decided_at: null, paid_on: null, bank_reference: null, decision_comment: null },
    { id: 'p2', tutor_id: ID(3), amount_rand: 90, status: 'requested', bank_details_changed_at: hoursAgo(900), session_ids: ['s3'], requested_at: hoursAgo(1), decided_at: null, paid_on: null, bank_reference: null, decision_comment: null },
  ] as Row[],
  wallets: [
    { profile_id: ID(1), available_rand: 320, held_rand: 180 }, { profile_id: ID(2), available_rand: 900, held_rand: 0 }, { profile_id: ID(3), available_rand: 90, held_rand: 640 },
  ] as Row[],
  wallet_ledger: [
    { id: 'l3', seq: 3, profile_id: ID(1), kind: 'hold', available_delta: -180, held_delta: 180, available_after: 320, held_after: 180, note: null, created_at: hoursAgo(5) },
    { id: 'l2', seq: 2, profile_id: ID(1), kind: 'topup', available_delta: 350, held_delta: 0, available_after: 500, held_after: 0, note: null, created_at: hoursAgo(50) },
  ] as Row[],
  system_settings: [
    ['wallet_payments_enabled', false], ['free_sessions_enabled', true], ['wallet_bank_name', ''], ['wallet_bank_account_holder', ''], ['wallet_bank_account_number', ''],
    ['wallet_bank_branch_code', ''], ['wallet_bank_account_type', ''], ['wallet_topup_min_rand', 50], ['wallet_topup_max_rand', 5000], ['wallet_balance_cap_rand', 10000],
    ['wallet_topup_max_waiting', 3], ['wallet_topup_max_per_day', 10], ['wallet_topup_stale_days', 7], ['wallet_proof_keep_days_successful', 90], ['wallet_proof_keep_days_unsuccessful', 30],
  ].map(([k, v]) => ({ setting_key: k, setting_value: v, description: `Pretend description of ${k}` })) as Row[],
};
const calls: string[] = [];

function table(name: keyof typeof db) {
  let rows = [...db[name]];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  b.select = () => b;
  b.in = (col: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[col])); return b; };
  b.eq = (col: string, value: unknown) => { rows = rows.filter((r) => r[col] === value); return b; };
  b.order = (col: string, o?: { ascending?: boolean }) => { rows.sort((x, y) => (String(x[col] ?? '') < String(y[col] ?? '') ? -1 : 1) * (o?.ascending === false ? -1 : 1)); return b; };
  b.limit = (n: number) => { rows = rows.slice(0, n); return b; };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  b.then = (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej);
  return b;
}
const find = (name: keyof typeof db, key: string, id: unknown) => db[name].find((r) => r[key] === id)!;

function proofUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 480; canvas.height = 300;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#0F172A'; c.fillRect(0, 0, 480, 300);
  c.fillStyle = '#fff'; c.font = 'bold 28px sans-serif';
  c.fillText('PRETEND proof of payment', 30, 120); c.fillText('R500  ·  TL-7K4M9Q', 30, 170);
  return canvas.toDataURL('image/png');
}

const client: WalletAdminClient = {
  from: (name: string) => table(name as keyof typeof db),
  rpc: async (fn, args = {}) => {
    calls.push(fn);
    const ok = (data: unknown) => ({ data, error: null });
    const fail = (message: string) => ({ data: null, error: { message } });
    if (fn === 'wallet_totals') {
      const open = db.wallet_topups.filter((t) => t.status === 'proof_sent');
      const total = db.wallets.reduce((s, w) => s + Number(w.available_rand) + Number(w.held_rand), 0);
      return ok({ wallets: db.wallets.length, available_rand: 1310, held_rand: 820, total_rand: total, tutor_wallets_rand: 730, topups_waiting: open.length + 1, topups_proof_sent: open.length,
        payouts_requested: db.payout_requests.filter((p) => p.status === 'requested').length, payouts_requested_rand: 730, booked_sessions: 2, booked_tutor_share_rand: 270, held_for_others_rand: total + 270 });
    }
    if (fn === 'admin_wallet_balance_check') return ok({ checked: db.wallets.length, mismatch_count: 0, mismatches: [], checked_at: new Date().toISOString() });
    if (fn === 'admin_search_profiles') return ok(db.profiles.filter((p) => String(p.full_name).toLowerCase().includes(String(args.p_term).toLowerCase())));
    if (fn === 'admin_mark_topup_successful') {
      const t = find('wallet_topups', 'id', args.p_topup); t.status = 'successful'; t.received_rand = args.p_received; t.decision_comment = args.p_comment; t.decided_at = new Date().toISOString();
      return ok({ already: false });
    }
    if (fn === 'admin_mark_topup_unsuccessful') {
      const t = find('wallet_topups', 'id', args.p_topup); t.status = 'unsuccessful'; t.decision_comment = args.p_comment; t.decided_at = new Date().toISOString();
      return ok({ already: false });
    }
    if (fn === 'admin_open_bank_details') return ok({ bank_name: 'Pretend Bank', account_holder: 'S Pretend', branch_code: '000000', account_number: '1111111111', amount_rand: 640, status: 'requested' });
    if (fn === 'admin_mark_payout_paid') { const p = find('payout_requests', 'id', args.p_payout); p.status = 'paid'; p.paid_on = args.p_paid_on ?? '2026-11-03'; p.bank_reference = args.p_bank_reference; p.decided_at = new Date().toISOString(); return ok({ already: false }); }
    if (fn === 'admin_mark_payout_cannot_pay') { const p = find('payout_requests', 'id', args.p_payout); p.status = 'could_not_pay'; p.decision_comment = args.p_comment; p.decided_at = new Date().toISOString(); return ok({ already: false }); }
    if (fn === 'admin_adjust_wallet') {
      const w = find('wallets', 'profile_id', args.p_profile);
      if (Number(args.p_amount) < 0 && Number(w.available_rand) < -Number(args.p_amount)) return fail(`The wallet holds R${w.available_rand} available; an adjustment never takes it below zero.`);
      w.available_rand = Number(w.available_rand) + Number(args.p_amount);
      db.wallet_ledger.unshift({ id: `l${db.wallet_ledger.length + 5}`, seq: db.wallet_ledger.length + 5, profile_id: args.p_profile, kind: 'adjustment', available_delta: args.p_amount, held_delta: 0, available_after: w.available_rand, held_after: w.held_rand, note: args.p_reason, created_at: new Date().toISOString() });
      return ok({ already: false });
    }
    // Wallet phase 6 (pretend answers; nothing is saved): closed accounts with money, the sessions a wallet paid for, a refund, money returned, a hand top-up.
    if (fn === 'admin_closed_account_wallets') {
      return ok([{ profile_id: ID(9), role: 'student', display_name: 'Former learner', available_rand: 500, held_rand: 0, open_payout_rand: 0, unconfirmed_rand: 150, closure_id: 'z1', closure_status: 'db_deleted',
        closed_at: hoursAgo(24 * 33), topup_references: ['TL-OLD123'], has_bank_details: false }]);
    }
    if (fn === 'admin_wallet_sessions') {
      return ok([{ session_id: 's9', scheduled_start: hoursAgo(72), status: 'completed', price_rand: 200, refunded_rand: 0, tutor_id: ID(3), tutor_share_rand: 140, tutor_credited: true, tutor_reduced_rand: 0 },
        { session_id: 's10', scheduled_start: new Date(Date.now() + 5 * 86_400_000).toISOString(), status: 'scheduled', price_rand: 100, refunded_rand: 0, tutor_id: ID(3), tutor_share_rand: 0, tutor_credited: false, tutor_reduced_rand: 0 }]);
    }
    if (fn === 'admin_refund_to_wallet') {
      const covered = Number(args.p_amount) <= 60;
      return ok({ already: false, refunded_rand: args.p_amount, refunded_total_rand: args.p_amount, price_rand: 200, tutor_credited: true,
        tutor_reduced_rand: args.p_take_back && covered ? Math.round(Number(args.p_amount) * 0.7) : 0, tutor_shortfall_rand: args.p_take_back && !covered ? Math.round(Number(args.p_amount) * 0.7) : 0 });
    }
    if (fn === 'admin_return_wallet_money') return ok({ already: false });
    if (fn === 'admin_add_topup_by_hand') return ok({ already: false, reference: 'TL-HAND22' });
    if (fn === 'admin_open_tutor_bank_details') return ok({ bank_name: 'Pretend Bank', account_holder: 'S Pretend', branch_code: '000000', account_number: '1111111111' });
    if (fn === 'log_document_access') return ok('row');
    return fail('function does not exist');
  },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: proofUrl() }, error: null }) }) },
};

const saveSetting = async (key: string, value: unknown) => {
  calls.push(`save:${key}`);
  const row = find('system_settings', 'setting_key', key);
  if (key === 'wallet_topup_max_rand' && Number(value) > Number(find('system_settings', 'setting_key', 'wallet_balance_cap_rand').setting_value)) {
    throw { message: 'The limits must satisfy: smallest transfer <= largest transfer <= wallet cap' };
  }
  row.setting_value = value;
};

function Preview() {
  const [role, setRole] = useState<AdminRole>('super_admin');
  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#0F172A] font-sans p-8">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          Practice copy: pretend data, nothing is saved or sent, no sign-in. Look as:{' '}
          {(['super_admin', 'finance_manager', 'support_agent', 'verification_officer'] as AdminRole[]).map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)} className={`mr-2 px-2 py-0.5 rounded ${role === r ? 'bg-[#0F172A] text-white' : 'bg-white border border-slate-300'}`}>{r}</button>
          ))}
        </p>
        <h1 className="text-2xl font-extrabold mb-4">Payments</h1>
        <WalletTabs key={role} client={client} role={role} saveSetting={saveSetting} />
        <p data-nothing-for-role className="text-xs text-slate-400 mt-4">{role === 'support_agent' || role === 'verification_officer' ? 'This role sees nothing of the wallet.' : ''}</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
(window as unknown as { __calls: string[] }).__calls = calls;

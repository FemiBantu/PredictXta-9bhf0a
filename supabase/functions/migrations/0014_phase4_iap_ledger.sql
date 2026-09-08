-- Migration 0014: Phase 4 IAP Ledger & Purchase Hardening
-- Adds: coin_transactions ledger table, updated_at to purchase_audit_log,
--       rewrites add_user_coins to write immutable ledger entries

-- ─── Add updated_at to purchase_audit_log if missing ────────────────────────
alter table public.purchase_audit_log
  add column if not exists updated_at timestamp with time zone default now();

-- ─── Immutable coin transaction ledger ───────────────────────────────────────
-- Every credit/debit to user_coins is recorded here.
-- Rows are INSERT-only from server (service_role). Clients may only SELECT own rows.
create table if not exists public.coin_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.user_profiles(id) on delete cascade,
  amount          integer not null,       -- positive = credit, negative = debit
  balance_after   integer not null,
  transaction_type text not null,         -- 'purchase', 'challenge_reward', 'referral', 'spend', 'admin_grant', 'refund'
  reference_id    text,                   -- idempotency_key, challenge_pick.id, etc.
  reference_type  text,                   -- 'iap', 'challenge', 'referral', 'manual'
  description     text,
  created_at      timestamp with time zone default now()
);

create index if not exists ct_user_id_idx   on public.coin_transactions (user_id, created_at desc);
create index if not exists ct_type_idx      on public.coin_transactions (transaction_type, created_at desc);
create index if not exists ct_reference_idx on public.coin_transactions (reference_id) where reference_id is not null;

alter table public.coin_transactions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='coin_transactions' and policyname='authenticated_select_own_transactions') then
    create policy authenticated_select_own_transactions
      on public.coin_transactions for select to authenticated
      using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='coin_transactions' and policyname='service_insert_transactions') then
    create policy service_insert_transactions
      on public.coin_transactions for insert
      with check (true);
  end if;
end $$;

-- ─── Rewrite add_user_coins to write ledger entries ──────────────────────────
-- SECURITY DEFINER ensures this function runs as the DB owner regardless
-- of which role calls it.  search_path is fixed to prevent injection.
create or replace function public.add_user_coins(
  p_user_id         uuid,
  p_amount          integer,
  p_transaction_type text  default 'purchase',
  p_reference_id    text   default null,
  p_reference_type  text   default 'iap',
  p_description     text   default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_balance integer;
begin
  -- Upsert user_coins row — balance cannot go below 0
  insert into public.user_coins (user_id, balance, created_at, updated_at)
  values (p_user_id, greatest(0, p_amount), now(), now())
  on conflict (user_id)
  do update set
    balance    = greatest(0, public.user_coins.balance + p_amount),
    updated_at = now()
  returning balance into v_new_balance;

  -- Write immutable ledger entry
  insert into public.coin_transactions (
    user_id, amount, balance_after,
    transaction_type, reference_id, reference_type, description
  ) values (
    p_user_id, p_amount, v_new_balance,
    p_transaction_type, p_reference_id, p_reference_type, p_description
  );

  return v_new_balance;
end;
$$;

-- ─── Phase 4 feature flags ────────────────────────────────────────────────────
insert into public.feature_flags (flag_key, description, enabled, rollout_pct, target_env) values
  ('iap_apple_server_api',      'Use App Store Server API (JWT) instead of legacy verifyReceipt',    true,  100, 'production'),
  ('iap_google_play_api',       'Enable Google Play Developer API real-time purchase verification',   true,  100, 'production'),
  ('iap_coin_ledger',           'Write all coin grants to immutable coin_transactions ledger',        true,  100, 'production'),
  ('iap_restore_server_verify', 'Verify each restored purchase server-side on iOS restore flow',     true,  100, 'production')
on conflict (flag_key) do nothing;

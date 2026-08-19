-- =============================================================================
-- Migration 0005: Subscriptions, Coins & IAP
-- PredictXta — vip_subscriptions, user_coins, purchase_audit_log.
-- =============================================================================

-- ─── VIP Subscriptions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vip_subscriptions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  plan       text        NOT NULL,
  status     text        DEFAULT 'active',
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vip_subs_user_status_exp_idx ON public.vip_subscriptions(user_id, status, expires_at DESC);

ALTER TABLE public.vip_subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vip_subscriptions' AND policyname='authenticated_select_own_vip') THEN
    CREATE POLICY authenticated_select_own_vip ON public.vip_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vip_subscriptions' AND policyname='authenticated_insert_own_vip') THEN
    CREATE POLICY authenticated_insert_own_vip ON public.vip_subscriptions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vip_subscriptions' AND policyname='service_update_vip') THEN
    CREATE POLICY service_update_vip           ON public.vip_subscriptions FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── User Coins ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_coins (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  balance    integer     NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_coins ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_coins' AND policyname='authenticated_select_own_coins') THEN
    CREATE POLICY authenticated_select_own_coins ON public.user_coins FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_coins' AND policyname='authenticated_insert_own_coins') THEN
    CREATE POLICY authenticated_insert_own_coins ON public.user_coins FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_coins' AND policyname='service_update_coins') THEN
    CREATE POLICY service_update_coins           ON public.user_coins FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── Purchase Audit Log (Server-Side IAP Verification) ────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_audit_log (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  product_id          text        NOT NULL,
  platform            text        NOT NULL,       -- 'ios' | 'android'
  transaction_id      text,
  purchase_token      text,
  idempotency_key     text        NOT NULL UNIQUE,
  status              text        NOT NULL DEFAULT 'pending',  -- pending|verified|failed|refunded
  product_type        text        NOT NULL,       -- 'subscription' | 'consumable'
  plan                text        NOT NULL,
  is_restore          boolean     NOT NULL DEFAULT false,
  verification_details jsonb,
  granted_at          timestamptz,
  error_message       text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pal_user_id_idx      ON public.purchase_audit_log(user_id);
CREATE INDEX IF NOT EXISTS pal_idempotency_idx  ON public.purchase_audit_log(idempotency_key);
CREATE INDEX IF NOT EXISTS pal_status_idx       ON public.purchase_audit_log(status);
CREATE INDEX IF NOT EXISTS pal_product_idx      ON public.purchase_audit_log(product_id);
CREATE INDEX IF NOT EXISTS pal_created_idx      ON public.purchase_audit_log(created_at DESC);

ALTER TABLE public.purchase_audit_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='purchase_audit_log' AND policyname='authenticated_select_own_purchases') THEN
    CREATE POLICY authenticated_select_own_purchases ON public.purchase_audit_log FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='purchase_audit_log' AND policyname='service_manage_purchases') THEN
    CREATE POLICY service_manage_purchases           ON public.purchase_audit_log FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

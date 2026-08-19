-- =============================================================================
-- Migration 0003: Notifications & Chat
-- PredictXta — notifications, chat_rooms, chat_messages.
-- =============================================================================

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  title      text        NOT NULL,
  body       text        NOT NULL,
  type       text        DEFAULT 'general',
  read       boolean     DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON public.notifications(user_id, created_at DESC)
  WHERE read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='authenticated_select_own_notifications') THEN
    CREATE POLICY authenticated_select_own_notifications ON public.notifications FOR SELECT  TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='authenticated_insert_notifications') THEN
    CREATE POLICY authenticated_insert_notifications     ON public.notifications FOR INSERT  TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='authenticated_update_own_notifications') THEN
    CREATE POLICY authenticated_update_own_notifications ON public.notifications FOR UPDATE  TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

-- ─── Chat Rooms ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  description   text,
  type          text        DEFAULT 'public',
  match_id      uuid,
  emoji         text        DEFAULT '⚽',
  members_count integer     DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chat_rooms' AND policyname='anon_select_chat_rooms') THEN
    CREATE POLICY anon_select_chat_rooms          ON public.chat_rooms FOR SELECT TO anon          USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chat_rooms' AND policyname='authenticated_select_chat_rooms') THEN
    CREATE POLICY authenticated_select_chat_rooms ON public.chat_rooms FOR SELECT TO authenticated  USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chat_rooms' AND policyname='authenticated_insert_chat_rooms') THEN
    CREATE POLICY authenticated_insert_chat_rooms ON public.chat_rooms FOR INSERT TO authenticated  WITH CHECK (true);
  END IF;
END $$;

-- ─── Chat Messages ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid        REFERENCES public.chat_rooms(id)    ON DELETE CASCADE,
  user_id    uuid        REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  username   text,
  content    text        NOT NULL,
  created_at timestamptz DEFAULT now(),
  reactions  jsonb       DEFAULT '{}',
  is_pinned  boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS chat_messages_room_created_idx ON public.chat_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_pinned_idx       ON public.chat_messages(room_id, is_pinned) WHERE is_pinned = true;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chat_messages' AND policyname='anon_select_chat_messages') THEN
    CREATE POLICY anon_select_chat_messages              ON public.chat_messages FOR SELECT TO anon          USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chat_messages' AND policyname='authenticated_select_chat_messages') THEN
    CREATE POLICY authenticated_select_chat_messages     ON public.chat_messages FOR SELECT TO authenticated  USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chat_messages' AND policyname='authenticated_insert_chat_messages') THEN
    CREATE POLICY authenticated_insert_chat_messages     ON public.chat_messages FOR INSERT TO authenticated  WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chat_messages' AND policyname='authenticated_update_message_reactions') THEN
    CREATE POLICY authenticated_update_message_reactions ON public.chat_messages FOR UPDATE TO authenticated  USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chat_messages' AND policyname='authenticated_delete_chat_messages') THEN
    CREATE POLICY authenticated_delete_chat_messages     ON public.chat_messages FOR DELETE TO authenticated  USING (true);
  END IF;
END $$;

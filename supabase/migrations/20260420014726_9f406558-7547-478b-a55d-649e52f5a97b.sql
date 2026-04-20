CREATE TABLE IF NOT EXISTS public.app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_secrets (key, value)
SELECT 'gcal_token_key', encode(extensions.gen_random_bytes(32), 'base64')
WHERE NOT EXISTS (SELECT 1 FROM public.app_secrets WHERE key = 'gcal_token_key');

CREATE OR REPLACE FUNCTION public._gcal_key_text()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT value FROM public.app_secrets WHERE key = 'gcal_token_key';
$$;
REVOKE ALL ON FUNCTION public._gcal_key_text() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.google_calendar_tokens
  ADD COLUMN IF NOT EXISTS access_token_enc bytea,
  ADD COLUMN IF NOT EXISTS refresh_token_enc bytea;

UPDATE public.google_calendar_tokens
SET access_token_enc = extensions.pgp_sym_encrypt(access_token::text, public._gcal_key_text())
WHERE access_token_enc IS NULL AND access_token IS NOT NULL;

UPDATE public.google_calendar_tokens
SET refresh_token_enc = extensions.pgp_sym_encrypt(refresh_token::text, public._gcal_key_text())
WHERE refresh_token_enc IS NULL AND refresh_token IS NOT NULL;

ALTER TABLE public.google_calendar_tokens ALTER COLUMN access_token DROP NOT NULL;
UPDATE public.google_calendar_tokens SET access_token = NULL, refresh_token = NULL;

DROP POLICY IF EXISTS "Users view their own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users insert their own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users update their own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users delete their own google tokens" ON public.google_calendar_tokens;

CREATE POLICY "Users view own token metadata"
  ON public.google_calendar_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete their own google tokens"
  ON public.google_calendar_tokens FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.gcal_encrypt(plaintext text)
RETURNS bytea
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT extensions.pgp_sym_encrypt(plaintext, public._gcal_key_text());
$$;
REVOKE ALL ON FUNCTION public.gcal_encrypt(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gcal_decrypt(ciphertext bytea)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT extensions.pgp_sym_decrypt(ciphertext, public._gcal_key_text());
$$;
REVOKE ALL ON FUNCTION public.gcal_decrypt(bytea) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Authenticated users can join events" ON public.event_users;

CREATE POLICY "Only invitees, group members, or event owner can join"
  ON public.event_users FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = event_users.event_id AND e.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = event_users.event_id
          AND e.group_id IS NOT NULL
          AND public.is_group_member(auth.uid(), e.group_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.event_invitations inv
        WHERE inv.event_id = event_users.event_id
          AND (
            inv.invited_user_id = auth.uid()
            OR lower(inv.invited_email) = lower(auth.jwt() ->> 'email')
          )
      )
    )
  );

CREATE POLICY "Group members can view each other's profile"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_groups me
      JOIN public.user_groups other ON other.group_id = me.group_id
      WHERE me.user_id = auth.uid()
        AND other.user_id = profiles.user_id
    )
  );

CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_user ON public.security_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_type ON public.security_audit_log(event_type, created_at DESC);

CREATE POLICY "Users view their own audit entries"
  ON public.security_audit_log FOR SELECT
  USING (auth.uid() = user_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'event_users'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.event_users';
  END IF;
END$$;

-- Server-side RPC to fetch decrypted Google Calendar tokens for a specific user.
-- Avoids round-tripping bytea ciphertext through PostgREST (which serializes it as
-- hex strings and breaks subsequent rpc() calls).
CREATE OR REPLACE FUNCTION public.gcal_get_tokens(_user_id uuid)
RETURNS TABLE(access_token text, refresh_token text, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    extensions.pgp_sym_decrypt(t.access_token_enc, public._gcal_key_text()) AS access_token,
    CASE WHEN t.refresh_token_enc IS NOT NULL
         THEN extensions.pgp_sym_decrypt(t.refresh_token_enc, public._gcal_key_text())
         ELSE NULL END AS refresh_token,
    t.expires_at
  FROM public.google_calendar_tokens t
  WHERE t.user_id = _user_id;
$$;

-- Server-side RPC to update access token after refresh.
CREATE OR REPLACE FUNCTION public.gcal_update_access_token(_user_id uuid, _new_access text, _new_expires timestamptz)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.google_calendar_tokens
  SET access_token_enc = extensions.pgp_sym_encrypt(_new_access, public._gcal_key_text()),
      expires_at = _new_expires,
      updated_at = now()
  WHERE user_id = _user_id;
$$;

-- Restrict execution to service_role only (called from edge functions).
REVOKE ALL ON FUNCTION public.gcal_get_tokens(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gcal_update_access_token(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gcal_get_tokens(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gcal_update_access_token(uuid, text, timestamptz) TO service_role;

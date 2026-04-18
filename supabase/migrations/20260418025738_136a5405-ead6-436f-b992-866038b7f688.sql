
-- Invitations table
CREATE TABLE IF NOT EXISTS public.event_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL,
  invited_user_id UUID,
  invited_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, invited_email)
);

CREATE INDEX IF NOT EXISTS idx_event_invitations_event ON public.event_invitations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_invitations_user ON public.event_invitations(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_event_invitations_email ON public.event_invitations(invited_email);

ALTER TABLE public.event_invitations ENABLE ROW LEVEL SECURITY;

-- View: event owner OR the invitee (by user id or matching email)
CREATE POLICY "View invitations as owner or invitee"
ON public.event_invitations FOR SELECT
USING (
  invited_user_id = auth.uid()
  OR lower(invited_email) = lower((auth.jwt() ->> 'email'))
  OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.user_id = auth.uid())
);

-- Insert: only the event owner can invite
CREATE POLICY "Event owner can invite"
ON public.event_invitations FOR INSERT
WITH CHECK (
  invited_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.user_id = auth.uid())
);

-- Update: only invitee (accept/decline)
CREATE POLICY "Invitee can update status"
ON public.event_invitations FOR UPDATE
USING (
  invited_user_id = auth.uid()
  OR lower(invited_email) = lower((auth.jwt() ->> 'email'))
);

-- Delete: inviter or invitee
CREATE POLICY "Inviter or invitee can delete"
ON public.event_invitations FOR DELETE
USING (
  invited_by = auth.uid()
  OR invited_user_id = auth.uid()
  OR lower(invited_email) = lower((auth.jwt() ->> 'email'))
);

-- Trigger to keep updated_at fresh
DROP TRIGGER IF EXISTS event_invitations_updated_at ON public.event_invitations;
CREATE TRIGGER event_invitations_updated_at
BEFORE UPDATE ON public.event_invitations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add last_synced_at to google_calendar_tokens for sync indicator
ALTER TABLE public.google_calendar_tokens
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

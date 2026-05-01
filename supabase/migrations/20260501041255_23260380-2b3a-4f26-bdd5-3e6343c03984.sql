
-- 1. Restore handle_new_user + trigger on auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Backfill missing profiles for existing users
INSERT INTO public.profiles (user_id, display_name)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', u.email)
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;

-- 3. Restore updated_at triggers
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_google_calendar_tokens_updated_at ON public.google_calendar_tokens;
CREATE TRIGGER update_google_calendar_tokens_updated_at
  BEFORE UPDATE ON public.google_calendar_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS event_invitations_updated_at ON public.event_invitations;
CREATE TRIGGER event_invitations_updated_at
  BEFORE UPDATE ON public.event_invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Fix privilege escalation: user_groups insert must be role='member'
DROP POLICY IF EXISTS "Authenticated users can join groups" ON public.user_groups;
CREATE POLICY "Authenticated users can join groups as member"
  ON public.user_groups FOR INSERT
  WITH CHECK (auth.uid() = user_id AND role = 'member');

-- 5. Auto-promote group creator to admin via SECURITY DEFINER trigger.
-- This bypasses the role='member' constraint above for the very first row,
-- so a creator becomes admin even though end users cannot self-assign admin.
CREATE OR REPLACE FUNCTION public.handle_new_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    INSERT INTO public.user_groups (user_id, group_id, role)
    VALUES (NEW.user_id, NEW.id, 'admin')
    ON CONFLICT (user_id, group_id) DO UPDATE SET role = 'admin';
  END IF;
  RETURN NEW;
END;
$$;

-- Ensure unique constraint exists for ON CONFLICT to work
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_groups_user_group_unique'
  ) THEN
    BEGIN
      ALTER TABLE public.user_groups
        ADD CONSTRAINT user_groups_user_group_unique UNIQUE (user_id, group_id);
    EXCEPTION WHEN duplicate_table THEN NULL;
    END;
  END IF;
END$$;

DROP TRIGGER IF EXISTS on_group_created ON public.groups;
CREATE TRIGGER on_group_created
  AFTER INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_group();


-- 1. Create profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 2. Create user_groups membership table
CREATE TABLE public.user_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, group_id)
);

ALTER TABLE public.user_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their group memberships"
  ON public.user_groups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can join groups"
  ON public.user_groups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave groups"
  ON public.user_groups FOR DELETE
  USING (auth.uid() = user_id);

-- Allow members to see other members in their groups
CREATE POLICY "Members can see group members"
  ON public.user_groups FOR SELECT
  USING (
    group_id IN (
      SELECT ug.group_id FROM public.user_groups ug WHERE ug.user_id = auth.uid()
    )
  );

-- 3. Add user_id to existing tables (nullable to preserve existing data)
ALTER TABLE public.groups ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.events ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.event_users ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. Update groups RLS - drop old permissive policies, add auth-based ones
DROP POLICY IF EXISTS "Anyone can create groups" ON public.groups;
DROP POLICY IF EXISTS "Groups are publicly readable" ON public.groups;

CREATE POLICY "Authenticated users can create groups"
  ON public.groups FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Group members can view groups"
  ON public.groups FOR SELECT
  USING (
    id IN (SELECT ug.group_id FROM public.user_groups ug WHERE ug.user_id = auth.uid())
    OR user_id = auth.uid()
  );

CREATE POLICY "Group creator can update"
  ON public.groups FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Group creator can delete"
  ON public.groups FOR DELETE
  USING (user_id = auth.uid());

-- 5. Update events RLS
DROP POLICY IF EXISTS "Anyone can create events" ON public.events;
DROP POLICY IF EXISTS "Events are publicly readable" ON public.events;

CREATE POLICY "Authenticated users can create events"
  ON public.events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Group members can view events"
  ON public.events FOR SELECT
  USING (
    group_id IN (SELECT ug.group_id FROM public.user_groups ug WHERE ug.user_id = auth.uid())
    OR user_id = auth.uid()
  );

CREATE POLICY "Event creator can update"
  ON public.events FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Event creator can delete"
  ON public.events FOR DELETE
  USING (user_id = auth.uid());

-- 6. Update event_users RLS
DROP POLICY IF EXISTS "Anyone can join events" ON public.event_users;
DROP POLICY IF EXISTS "Event users are publicly readable" ON public.event_users;
DROP POLICY IF EXISTS "Anyone can delete event users" ON public.event_users;

CREATE POLICY "Authenticated users can join events"
  ON public.event_users FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Event participants visible to group members"
  ON public.event_users FOR SELECT
  USING (
    event_id IN (
      SELECT e.id FROM public.events e
      WHERE e.group_id IN (
        SELECT ug.group_id FROM public.user_groups ug WHERE ug.user_id = auth.uid()
      )
      OR e.user_id = auth.uid()
    )
    OR user_id = auth.uid()
  );

CREATE POLICY "Users can update their own participation"
  ON public.event_users FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own participation"
  ON public.event_users FOR DELETE
  USING (user_id = auth.uid());

-- 7. Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 8. Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Enable realtime on event_users
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_users;

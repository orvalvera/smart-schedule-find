-- Fix recursive RLS on user_groups by using a SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.is_group_member(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_groups
    WHERE user_id = _user_id AND group_id = _group_id
  )
$$;

-- Drop the recursive policy and replace it
DROP POLICY IF EXISTS "Members can see group members" ON public.user_groups;

CREATE POLICY "Members can see group members"
ON public.user_groups FOR SELECT
USING (public.is_group_member(auth.uid(), group_id));

-- Also fix the recursive references in groups, events, event_users
DROP POLICY IF EXISTS "Group members can view groups" ON public.groups;
CREATE POLICY "Group members can view groups"
ON public.groups FOR SELECT
USING (public.is_group_member(auth.uid(), id) OR user_id = auth.uid());

DROP POLICY IF EXISTS "Group members can view events" ON public.events;
CREATE POLICY "Group members can view events"
ON public.events FOR SELECT
USING ((group_id IS NOT NULL AND public.is_group_member(auth.uid(), group_id)) OR user_id = auth.uid());

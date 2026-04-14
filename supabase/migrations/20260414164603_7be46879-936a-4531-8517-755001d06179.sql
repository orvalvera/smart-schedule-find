
-- Create groups table
CREATE TABLE public.groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create groups" ON public.groups FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Groups are publicly readable" ON public.groups FOR SELECT TO public USING (true);

-- Add group_id and name to events
ALTER TABLE public.events ADD COLUMN group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE;
ALTER TABLE public.events ADD COLUMN name text NOT NULL DEFAULT '';

-- Add delete policy for event_users so participants can remove their schedule
CREATE POLICY "Anyone can delete event users" ON public.event_users FOR DELETE TO public USING (true);

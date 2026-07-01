
-- Relax write policies on tables the admin UI writes to from the client.
-- The app authenticates admins via a shared password (no Supabase Auth user),
-- so has_role(auth.uid(), 'admin') is always false and breaks writes.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'schedules',
    'schedule_time_slots',
    'schedule_slot_positions',
    'schedule_assignments',
    'members',
    'member_custom_fields',
    'custom_fields',
    'exam_periods',
    'templates',
    'app_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins can insert %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can update %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can delete %1$s" ON public.%1$I', t);
  END LOOP;
END $$;

-- Specific (some policies were named differently)
DROP POLICY IF EXISTS "Admins can insert settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can insert assignments" ON public.schedule_assignments;
DROP POLICY IF EXISTS "Admins can update assignments" ON public.schedule_assignments;
DROP POLICY IF EXISTS "Admins can delete assignments" ON public.schedule_assignments;
DROP POLICY IF EXISTS "Admins can insert slot positions" ON public.schedule_slot_positions;
DROP POLICY IF EXISTS "Admins can update slot positions" ON public.schedule_slot_positions;
DROP POLICY IF EXISTS "Admins can delete slot positions" ON public.schedule_slot_positions;
DROP POLICY IF EXISTS "Admins can insert time slots" ON public.schedule_time_slots;
DROP POLICY IF EXISTS "Admins can update time slots" ON public.schedule_time_slots;
DROP POLICY IF EXISTS "Admins can delete time slots" ON public.schedule_time_slots;
DROP POLICY IF EXISTS "Admins can insert custom fields" ON public.custom_fields;
DROP POLICY IF EXISTS "Admins can update custom fields" ON public.custom_fields;
DROP POLICY IF EXISTS "Admins can delete custom fields" ON public.custom_fields;
DROP POLICY IF EXISTS "Admins can insert member custom fields" ON public.member_custom_fields;
DROP POLICY IF EXISTS "Admins can update member custom fields" ON public.member_custom_fields;
DROP POLICY IF EXISTS "Admins can delete member custom fields" ON public.member_custom_fields;
DROP POLICY IF EXISTS "Admins can insert exam periods" ON public.exam_periods;
DROP POLICY IF EXISTS "Admins can update exam periods" ON public.exam_periods;
DROP POLICY IF EXISTS "Admins can delete exam periods" ON public.exam_periods;
DROP POLICY IF EXISTS "Admins can insert members" ON public.members;
DROP POLICY IF EXISTS "Admins can update members" ON public.members;
DROP POLICY IF EXISTS "Admins can delete members" ON public.members;
DROP POLICY IF EXISTS "Admins can insert schedules" ON public.schedules;
DROP POLICY IF EXISTS "Admins can update schedules" ON public.schedules;
DROP POLICY IF EXISTS "Admins can delete schedules" ON public.schedules;
DROP POLICY IF EXISTS "Admins can insert templates" ON public.templates;
DROP POLICY IF EXISTS "Admins can update templates" ON public.templates;
DROP POLICY IF EXISTS "Admins can delete templates" ON public.templates;

-- Re-create as permissive policies (matches original app design).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'schedules',
    'schedule_time_slots',
    'schedule_slot_positions',
    'schedule_assignments',
    'members',
    'member_custom_fields',
    'custom_fields',
    'exam_periods',
    'templates',
    'app_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('CREATE POLICY "Public can insert %1$s" ON public.%1$I FOR INSERT WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "Public can update %1$s" ON public.%1$I FOR UPDATE USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "Public can delete %1$s" ON public.%1$I FOR DELETE USING (true)', t);
  END LOOP;
END $$;

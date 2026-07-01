ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS created_by_role text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE public.schedule_slot_positions
ADD COLUMN IF NOT EXISTS group_label TEXT,
ADD COLUMN IF NOT EXISTS programmes TEXT;
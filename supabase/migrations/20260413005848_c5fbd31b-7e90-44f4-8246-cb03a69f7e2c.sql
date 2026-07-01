
-- Create slot positions table
CREATE TABLE public.schedule_slot_positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slot_id UUID NOT NULL REFERENCES public.schedule_time_slots(id) ON DELETE CASCADE,
  position_name TEXT NOT NULL DEFAULT 'Member',
  max_members INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.schedule_slot_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read slot positions" ON public.schedule_slot_positions FOR SELECT USING (true);
CREATE POLICY "Admin can insert slot positions" ON public.schedule_slot_positions FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update slot positions" ON public.schedule_slot_positions FOR UPDATE USING (true);
CREATE POLICY "Admin can delete slot positions" ON public.schedule_slot_positions FOR DELETE USING (true);

-- Update assignments to reference a position
ALTER TABLE public.schedule_assignments ADD COLUMN position_id UUID REFERENCES public.schedule_slot_positions(id) ON DELETE SET NULL;

-- Add default_positions to schedules
ALTER TABLE public.schedules ADD COLUMN default_positions JSONB NOT NULL DEFAULT '[{"name":"Member","max_members":1}]'::jsonb;

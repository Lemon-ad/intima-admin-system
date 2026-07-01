CREATE TABLE public.exam_periods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_exam_periods_member ON public.exam_periods(member_id);
CREATE INDEX idx_exam_periods_dates ON public.exam_periods(start_date, end_date);

ALTER TABLE public.exam_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read exam periods" ON public.exam_periods FOR SELECT USING (true);
CREATE POLICY "Admin can insert exam periods" ON public.exam_periods FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update exam periods" ON public.exam_periods FOR UPDATE USING (true);
CREATE POLICY "Admin can delete exam periods" ON public.exam_periods FOR DELETE USING (true);

CREATE TRIGGER update_exam_periods_updated_at
BEFORE UPDATE ON public.exam_periods
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add note column to time slots (per-slot title/note)
ALTER TABLE public.schedule_time_slots ADD COLUMN IF NOT EXISTS note TEXT;

-- Default no positions for new schedules
ALTER TABLE public.schedules ALTER COLUMN default_positions SET DEFAULT '[]'::jsonb;
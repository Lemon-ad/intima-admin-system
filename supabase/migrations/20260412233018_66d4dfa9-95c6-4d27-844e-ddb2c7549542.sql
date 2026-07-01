-- Create position enum
CREATE TYPE public.member_position AS ENUM ('SLT', 'EXCO', 'Junior');

-- Create schedule status enum  
CREATE TYPE public.schedule_status AS ENUM ('active', 'history');

-- Create schedule type enum
CREATE TYPE public.schedule_type AS ENUM ('all', 'exco');

-- Members table
CREATE TABLE public.members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  student_id TEXT NOT NULL UNIQUE,
  course TEXT NOT NULL,
  position member_position NOT NULL DEFAULT 'Junior',
  schedule_raw TEXT,
  free_times JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Custom fields settings
CREATE TABLE public.custom_fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Member custom field values
CREATE TABLE public.member_custom_fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  UNIQUE(member_id, field_id)
);

-- Templates
CREATE TABLE public.templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Schedules
CREATE TABLE public.schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  schedule_type schedule_type NOT NULL DEFAULT 'all',
  status schedule_status NOT NULL DEFAULT 'active',
  template_id UUID REFERENCES public.templates(id) ON DELETE SET NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Schedule time slots
CREATE TABLE public.schedule_time_slots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  day_label TEXT NOT NULL,
  slot_date DATE,
  time_start TEXT NOT NULL,
  time_end TEXT NOT NULL,
  duty TEXT,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  max_people INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Schedule assignments
CREATE TABLE public.schedule_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slot_id UUID NOT NULL REFERENCES public.schedule_time_slots(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(slot_id, member_id)
);

-- App settings
CREATE TABLE public.app_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Public read policies for /all and /exco pages
CREATE POLICY "Public can read members" ON public.members FOR SELECT USING (true);
CREATE POLICY "Public can read schedules" ON public.schedules FOR SELECT USING (true);
CREATE POLICY "Public can read time slots" ON public.schedule_time_slots FOR SELECT USING (true);
CREATE POLICY "Public can read assignments" ON public.schedule_assignments FOR SELECT USING (true);
CREATE POLICY "Public can read templates" ON public.templates FOR SELECT USING (true);
CREATE POLICY "Public can read custom fields" ON public.custom_fields FOR SELECT USING (true);
CREATE POLICY "Public can read member custom fields" ON public.member_custom_fields FOR SELECT USING (true);
CREATE POLICY "Public can read settings" ON public.app_settings FOR SELECT USING (true);

-- Admin write policies (admin password checked client-side)
CREATE POLICY "Admin can insert members" ON public.members FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update members" ON public.members FOR UPDATE USING (true);
CREATE POLICY "Admin can delete members" ON public.members FOR DELETE USING (true);

CREATE POLICY "Admin can insert schedules" ON public.schedules FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update schedules" ON public.schedules FOR UPDATE USING (true);
CREATE POLICY "Admin can delete schedules" ON public.schedules FOR DELETE USING (true);

CREATE POLICY "Admin can insert time slots" ON public.schedule_time_slots FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update time slots" ON public.schedule_time_slots FOR UPDATE USING (true);
CREATE POLICY "Admin can delete time slots" ON public.schedule_time_slots FOR DELETE USING (true);

CREATE POLICY "Admin can insert assignments" ON public.schedule_assignments FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update assignments" ON public.schedule_assignments FOR UPDATE USING (true);
CREATE POLICY "Admin can delete assignments" ON public.schedule_assignments FOR DELETE USING (true);

CREATE POLICY "Admin can insert templates" ON public.templates FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update templates" ON public.templates FOR UPDATE USING (true);
CREATE POLICY "Admin can delete templates" ON public.templates FOR DELETE USING (true);

CREATE POLICY "Admin can insert custom fields" ON public.custom_fields FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update custom fields" ON public.custom_fields FOR UPDATE USING (true);
CREATE POLICY "Admin can delete custom fields" ON public.custom_fields FOR DELETE USING (true);

CREATE POLICY "Admin can insert member custom fields" ON public.member_custom_fields FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update member custom fields" ON public.member_custom_fields FOR UPDATE USING (true);
CREATE POLICY "Admin can delete member custom fields" ON public.member_custom_fields FOR DELETE USING (true);

CREATE POLICY "Admin can insert settings" ON public.app_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update settings" ON public.app_settings FOR UPDATE USING (true);

-- Update timestamp function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers
CREATE TRIGGER update_members_updated_at BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_schedules_updated_at BEFORE UPDATE ON public.schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes
CREATE INDEX idx_members_position ON public.members(position);
CREATE INDEX idx_schedules_type_status ON public.schedules(schedule_type, status);
CREATE INDEX idx_time_slots_schedule ON public.schedule_time_slots(schedule_id);
CREATE INDEX idx_assignments_slot ON public.schedule_assignments(slot_id);
CREATE INDEX idx_assignments_member ON public.schedule_assignments(member_id);
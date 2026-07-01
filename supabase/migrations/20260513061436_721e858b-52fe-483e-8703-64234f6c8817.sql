-- Push subscriptions: one row per (member, device)
CREATE TABLE public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subs_member ON public.push_subscriptions(member_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read own subscriptions" ON public.push_subscriptions
  FOR SELECT USING (true);
CREATE POLICY "Public can insert subscriptions" ON public.push_subscriptions
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can delete subscriptions" ON public.push_subscriptions
  FOR DELETE USING (true);
CREATE POLICY "Public can update subscriptions" ON public.push_subscriptions
  FOR UPDATE USING (true);

-- VAPID keys: single row, private key only readable by service role
CREATE TABLE public.vapid_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'mailto:admin@intima.local',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vapid_keys ENABLE ROW LEVEL SECURITY;
-- No public policies; only service role can read (bypasses RLS)

-- Sent log to prevent duplicate reminders
CREATE TABLE public.sent_push_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES public.schedule_time_slots(id) ON DELETE CASCADE,
  reminder_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, slot_id, reminder_key)
);

CREATE INDEX idx_sent_push_log_slot ON public.sent_push_log(slot_id);

ALTER TABLE public.sent_push_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read sent log" ON public.sent_push_log
  FOR SELECT USING (true);
-- writes restricted to service role

-- Default reminder schedule setting (array of minutes-before-slot)
INSERT INTO public.app_settings (key, value) VALUES
  ('reminder_offsets_minutes', '[1440, 60, 15]'::jsonb)
ON CONFLICT (key) DO NOTHING;
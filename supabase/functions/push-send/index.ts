import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MALAYSIA_OFFSET_MINUTES = 8 * 60;
const DEFAULT_REMINDER_OFFSETS = [1440, 60, 15, 1];
const MIN_PUSH_TTL_SECONDS = 30 * 60;
const MAX_PUSH_TTL_SECONDS = 7 * 24 * 60 * 60;

function parseSlotTime(timeStr: string): { hour: number; minute: number } {
  const raw = (timeStr || "00:00").trim().toLowerCase().replace(/\s+/g, "");
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!match) return { hour: 0, minute: 0 };

  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const period = match[3];

  if (period === "pm" && hour < 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;

  return { hour, minute };
}

// Parse Malaysia local date/time into an absolute instant without server timezone shifts
function slotToLocalDate(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const { hour, minute } = parseSlotTime(timeStr);
  return new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0) - MALAYSIA_OFFSET_MINUTES * 60_000);
}

function formatMalaysiaYmd(date: Date): string {
  const shifted = new Date(date.getTime() + MALAYSIA_OFFSET_MINUTES * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const testMode = !!body.test;
    const testAll = !!body.all;
    const testMemberId: string | undefined = body.member_id;
    const unhideScheduleId: string | undefined = body.unhide_schedule_id;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load VAPID keys
    const { data: vapid } = await supabase
      .from("vapid_keys")
      .select("public_key, private_key, subject")
      .limit(1)
      .maybeSingle();
    if (!vapid) throw new Error("VAPID keys not initialized");

    // Apple's APNs rejects VAPID subjects with invalid TLDs (e.g. .local).
    // Force a valid mailto/https subject.
    let subject = vapid.subject || "";
    if (!/^mailto:.+@.+\..+/.test(subject) && !/^https:\/\//.test(subject)) {
      subject = "mailto:admin@intima-schedule.lovable.app";
    } else if (/\.local$/i.test(subject)) {
      subject = "mailto:admin@intima-schedule.lovable.app";
    }
    webpush.setVapidDetails(subject, vapid.public_key, vapid.private_key);

    // Android/FCM and iOS/APNs can delay delivery when a browser/PWA has been idle
    // for days. Keep each reminder alive until close to the slot instead of using
    // one short TTL for every reminder.
    const immediateSendOptions = { TTL: MIN_PUSH_TTL_SECONDS, urgency: "high" as const };
    const getReminderSendOptions = (minutesUntilSlot: number) => ({
      TTL: Math.min(
        MAX_PUSH_TTL_SECONDS,
        Math.max(MIN_PUSH_TTL_SECONDS, Math.ceil(Math.max(minutesUntilSlot, 1) * 60)),
      ),
      urgency: "high" as const,
    });

    // Load notification template (with defaults)
    const { data: tplRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "notification_template")
      .maybeSingle();
    const tpl = (tplRow?.value && typeof tplRow.value === "object")
      ? tplRow.value as { title?: string; body?: string }
      : {};
    const titleTpl = tpl.title || "You are in the slot of {schedule}";
    const bodyTpl = tpl.body || "{date} ({time_start}-{time_end})\n{position}\n{time_left} to go";

    const fmtDate = (dateStr: string) => {
      const [y, m, d] = dateStr.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    };
    const fmtDay = (dateStr: string) => {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
    };
    const fmtTimeLeft = (off: number) =>
      off >= 1440 ? `${Math.round(off / 1440)} day${off >= 2880 ? "s" : ""}`
      : off >= 60 ? `${Math.round(off / 60)} hour${off >= 120 ? "s" : ""}`
      : `${off} minute${off === 1 ? "" : "s"}`;

    const render = (s: string, vars: Record<string, string>) =>
      s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");


    // ---- TEST MODE: send a test notification to one member's subscriptions ----
    if (testMode && (testMemberId || testAll)) {
      const q = supabase.from("push_subscriptions").select("*");
      const { data: subs } = testAll ? await q : await q.eq("member_id", testMemberId!);

      let sent = 0, failed = 0;
      const errors: any[] = [];
      for (const s of subs || []) {
        const isApple = /web\.push\.apple\.com/i.test(s.endpoint);
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({
              title: "This is the Test Notification",
              body: "Test Done, you are ready to go!",
              url: "/",
              tag: `test-${s.id}-${Date.now()}`,
              timestamp: Date.now(),
            }),
            immediateSendOptions,
          );
          await supabase.from("push_subscriptions").update({ last_seen_at: new Date().toISOString() }).eq("id", s.id);
          sent++;
        } catch (e: any) {
          failed++;
          errors.push({
            platform: isApple ? "apple" : "other",
            statusCode: e?.statusCode,
            body: e?.body,
            message: e?.message,
          });
          console.error("push failed", isApple ? "apple" : "other", e?.statusCode, e?.body, e?.message);
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", s.id);
          }
        }
      }
      return new Response(JSON.stringify({ ok: true, sent, failed, count: subs?.length || 0, errors }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- UNHIDE MODE: notify all assigned members of a schedule that just became visible ----
    if (unhideScheduleId) {
      const { data: sched } = await supabase
        .from("schedules")
        .select("id, name, is_weekly")
        .eq("id", unhideScheduleId)
        .maybeSingle();
      if (!sched) {
        return new Response(JSON.stringify({ ok: false, error: "schedule not found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: slots } = await supabase
        .from("schedule_time_slots")
        .select("id, day_label, slot_date, time_start, time_end, duty")
        .eq("schedule_id", unhideScheduleId);

      const nowMy = new Date(Date.now() + MALAYSIA_OFFSET_MINUTES * 60_000);
      const todayDow = nowMy.getUTCDay();
      const WEEKDAYS: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
      };

      // Resolve each slot to a concrete upcoming date
      const resolved = (slots || []).map((s) => {
        if (s.slot_date) {
          const dt = slotToLocalDate(s.slot_date, s.time_start || "00:00");
          return { ...s, resolved_date: s.slot_date, ts: dt.getTime() };
        }
        if (sched.is_weekly) {
          const key = (s.day_label || "").trim().toLowerCase();
          const target = WEEKDAYS[key];
          if (target === undefined) return null;
          const diff = (target - todayDow + 7) % 7;
          const dt = new Date(nowMy.getTime() + diff * 86_400_000);
          const y = dt.getUTCFullYear();
          const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
          const d = String(dt.getUTCDate()).padStart(2, "0");
          const ymd = `${y}-${m}-${d}`;
          const start = slotToLocalDate(ymd, s.time_start || "00:00");
          return { ...s, resolved_date: ymd, ts: start.getTime() };
        }
        return null;
      }).filter((x: any) => x && x.ts >= Date.now() - 60 * 60_000) as any[];

      const slotIds = Array.from(new Set(resolved.map((s) => s.id)));
      let sent = 0, failed = 0;
      if (slotIds.length === 0) {
        return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no upcoming slots" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const [{ data: assignments }, { data: positions }] = await Promise.all([
        supabase.from("schedule_assignments").select("slot_id, member_id, position_id").in("slot_id", slotIds),
        supabase.from("schedule_slot_positions").select("id, position_name").in("slot_id", slotIds),
      ]);
      const positionById = new Map((positions || []).map((p) => [p.id, p.position_name]));

      // For each member, pick their soonest assigned slot in this schedule
      const memberNextSlot = new Map<string, { slot: any; position_id?: string | null }>();
      for (const a of assignments || []) {
        const slot = resolved.find((s) => s.id === a.slot_id);
        if (!slot) continue;
        const existing = memberNextSlot.get(a.member_id);
        if (!existing || slot.ts < existing.slot.ts) {
          memberNextSlot.set(a.member_id, { slot, position_id: a.position_id });
        }
      }

      const memberIds = Array.from(memberNextSlot.keys());
      if (memberIds.length === 0) {
        return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no assignees" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const [{ data: subs }, { data: members }] = await Promise.all([
        supabase.from("push_subscriptions").select("*").in("member_id", memberIds),
        supabase.from("members").select("id, name, display_name").in("id", memberIds),
      ]);
      const subsByMember = new Map<string, any[]>();
      for (const s of subs || []) {
        const arr = subsByMember.get(s.member_id) || [];
        arr.push(s);
        subsByMember.set(s.member_id, arr);
      }
      const memberById = new Map((members || []).map((m) => [m.id, m]));

      for (const [memberId, { slot, position_id }] of memberNextSlot.entries()) {
        const memberSubs = subsByMember.get(memberId) || [];
        if (!memberSubs.length) continue;
        const minutesUntil = Math.max(1, Math.round((slot.ts - Date.now()) / 60_000));
        const vars = {
          schedule: sched.name || "",
          member: ((memberById.get(memberId) as any)?.display_name || memberById.get(memberId)?.name || "You"),
          date: fmtDate(slot.resolved_date),
          day: fmtDay(slot.resolved_date),
          time_start: slot.time_start || "",
          time_end: slot.time_end || "",
          duty: slot.duty || "",
          position: position_id ? (positionById.get(position_id) || "") : "",
          time_left: fmtTimeLeft(minutesUntil),
        };
        const title = render(titleTpl, vars);
        const bodyText = render(bodyTpl, vars);
        for (const s of memberSubs) {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ title, body: bodyText, url: "/", tag: `unhide-${sched.id}-${slot.id}-${memberId}`, timestamp: Date.now() }),
              immediateSendOptions,
            );
            sent++;
          } catch (e: any) {
            failed++;
            if (e?.statusCode === 404 || e?.statusCode === 410) {
              await supabase.from("push_subscriptions").delete().eq("id", s.id);
            }
          }
        }
      }

      return new Response(JSON.stringify({ ok: true, sent, failed, members: memberIds.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- CRON MODE: send scheduled reminders ----
    const { data: settingRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "reminder_offsets_minutes")
      .maybeSingle();
    const offsets = Array.isArray(settingRow?.value)
      ? (settingRow!.value as unknown[])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      : DEFAULT_REMINDER_OFFSETS;
    if (offsets.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: "no offsets" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const maxOffset = Math.max(...offsets);
    const horizonEnd = new Date(now.getTime() + (maxOffset + 30) * 60_000);

    // Get upcoming slots within window (we filter by date in JS using local parsing).
    // Include both date-specific slots AND weekly slots (slot_date NULL, day_label = weekday).
    const startDate = formatMalaysiaYmd(now);
    const endDate = formatMalaysiaYmd(horizonEnd);

    const [{ data: datedSlots }, { data: weeklySlots }] = await Promise.all([
      supabase
        .from("schedule_time_slots")
        .select("id, schedule_id, day_label, slot_date, time_start, time_end, duty, schedules!inner(is_hidden)")
        .not("slot_date", "is", null)
        .gte("slot_date", startDate)
        .lte("slot_date", endDate)
        .eq("schedules.is_hidden", false),
      supabase
        .from("schedule_time_slots")
        .select("id, schedule_id, day_label, slot_date, time_start, time_end, duty, schedules!inner(is_weekly, status, is_hidden)")
        .is("slot_date", null)
        .eq("schedules.is_weekly", true)
        .eq("schedules.status", "active")
        .eq("schedules.is_hidden", false),
    ]);

    // Resolve weekly slots to a concrete date within [now, horizonEnd] based on day_label.
    const WEEKDAYS: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    };
    const nowMyShifted = new Date(now.getTime() + MALAYSIA_OFFSET_MINUTES * 60_000);
    const todayMyDow = nowMyShifted.getUTCDay();
    const horizonDays = Math.ceil((horizonEnd.getTime() - now.getTime()) / 86_400_000) + 1;

    const resolvedWeekly: any[] = [];
    for (const w of weeklySlots || []) {
      const key = (w.day_label || "").trim().toLowerCase();
      const targetDow = WEEKDAYS[key];
      if (targetDow === undefined) continue;
      for (let i = 0; i <= horizonDays; i++) {
        if (((todayMyDow + i) % 7) !== targetDow) continue;
        const dt = new Date(nowMyShifted.getTime() + i * 86_400_000);
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
        const d = String(dt.getUTCDate()).padStart(2, "0");
        const resolvedDate = `${y}-${m}-${d}`;
        const slotStart = slotToLocalDate(resolvedDate, w.time_start || "00:00");
        if (slotStart.getTime() < now.getTime() - 10 * 60_000) continue;
        if (slotStart.getTime() > horizonEnd.getTime()) continue;
        resolvedWeekly.push({
          id: w.id,
          schedule_id: w.schedule_id,
          day_label: w.day_label,
          slot_date: resolvedDate,
          time_start: w.time_start,
          time_end: w.time_end,
          duty: w.duty,
          _weekly: true,
        });
      }
    }

    const slots = [...(datedSlots || []), ...resolvedWeekly];

    if (slots.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no upcoming slots" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const slotIds = Array.from(new Set(slots.map((s) => s.id)));
    const [{ data: assignments }, { data: schedules }, { data: positions }] = await Promise.all([
      supabase.from("schedule_assignments").select("slot_id, member_id, position_id").in("slot_id", slotIds),
      supabase.from("schedules").select("id, name").in("id", Array.from(new Set(slots.map((s) => s.schedule_id)))),
      supabase.from("schedule_slot_positions").select("id, position_name").in("slot_id", slotIds),
    ]);
    const positionById = new Map((positions || []).map((p) => [p.id, p.position_name]));

    const memberIds = Array.from(new Set((assignments || []).map((a) => a.member_id)));
    if (memberIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no assignees" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: subs }, { data: members }] = await Promise.all([
      supabase.from("push_subscriptions").select("*").in("member_id", memberIds),
      supabase.from("members").select("id, name, display_name").in("id", memberIds),
    ]);

    const subsByMember = new Map<string, typeof subs>();
    for (const s of subs || []) {
      const arr = subsByMember.get(s.member_id) || [];
      arr.push(s);
      subsByMember.set(s.member_id, arr);
    }
    const memberById = new Map((members || []).map((m) => [m.id, m]));
    const scheduleById = new Map((schedules || []).map((s) => [s.id, s]));

    // Existing sent log for these slots
    const { data: sentLog } = await supabase
      .from("sent_push_log")
      .select("subscription_id, slot_id, reminder_key")
      .in("slot_id", slotIds);
    const sentSet = new Set((sentLog || []).map((r) => `${r.subscription_id}|${r.slot_id}|${r.reminder_key}`));

    let sent = 0, failed = 0, skipped = 0;

    // Cron runs every 5 minutes. Each offset fires on the first tick that lands
    // inside a tight window around the exact mark — wide enough that a 5-min
    // cron gap can't skip it, but narrow enough that "1 day before" doesn't
    // accidentally fire 5 hours before. Window: [off - 6, off + 3] minutes.
    // Per-(subscription, slot, offset) dedupe via sent_push_log prevents repeats.
    const WINDOW_BEFORE = 6;
    const WINDOW_AFTER = 3;
    const uniqOffsets = [...new Set(offsets)];

    for (const slot of slots) {
      if (!slot.slot_date) continue;
      const slotStart = slotToLocalDate(slot.slot_date, slot.time_start || "00:00");
      const minutesUntil = (slotStart.getTime() - now.getTime()) / 60_000;
      if (minutesUntil < -WINDOW_AFTER) continue; // already past

      // Find which offsets are due now (tight window around each mark)
      const firing: number[] = [];
      for (const off of uniqOffsets) {
        if (minutesUntil <= off + WINDOW_AFTER && minutesUntil >= off - WINDOW_BEFORE) {
          firing.push(off);
        }
      }
      if (firing.length === 0) {
        skipped++;
        continue;
      }

      const slotAssignees = (assignments || []).filter((a) => a.slot_id === slot.id);
      const sched = scheduleById.get(slot.schedule_id);

      for (const off of firing) {
        // Include resolved date in key so weekly slots can fire again the following week.
        const reminderKey = `m${off}-${slot.slot_date}`;
        const timeLeft = fmtTimeLeft(off);

        for (const a of slotAssignees) {
          const memberSubs = subsByMember.get(a.member_id) || [];
          const member = memberById.get(a.member_id);
          if (!memberSubs.length) continue;

          const vars = {
            schedule: sched?.name || "",
            member: ((member as any)?.display_name || member?.name || "You"),
            date: slot.slot_date ? fmtDate(slot.slot_date) : (slot.day_label || ""),
            day: slot.slot_date ? fmtDay(slot.slot_date) : (slot.day_label || ""),
            time_start: slot.time_start || "",
            time_end: slot.time_end || "",
            duty: slot.duty || "",
            position: a.position_id ? (positionById.get(a.position_id) || "") : "",
            time_left: timeLeft,
          };
          const title = render(titleTpl, vars);
          const body = render(bodyTpl, vars);

          for (const s of memberSubs) {
            const key = `${s.id}|${slot.id}|${reminderKey}`;
            if (sentSet.has(key)) continue;
            try {
              await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                JSON.stringify({ title, body, url: "/", tag: `slot-${slot.id}-${reminderKey}`, timestamp: Date.now() }),
                getReminderSendOptions(minutesUntil),
              );
              await supabase.from("sent_push_log").insert({
                subscription_id: s.id,
                slot_id: slot.id,
                reminder_key: reminderKey,
              });
              await supabase.from("push_subscriptions").update({ last_seen_at: new Date().toISOString() }).eq("id", s.id);
              sent++;
            } catch (e: any) {
              failed++;
              if (e?.statusCode === 404 || e?.statusCode === 410) {
                await supabase.from("push_subscriptions").delete().eq("id", s.id);
              }
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, failed, skipped, slotsChecked: slots.length, reminderOffsetsUsed: uniqOffsets }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

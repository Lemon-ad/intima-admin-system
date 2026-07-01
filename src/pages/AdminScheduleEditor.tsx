import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { displayName } from "@/lib/utils";
import { useParams, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useSchedule, useTimeSlots, useAssignments, useSaveSlots,
  useAssignMember, useUnassignMember, useUpdateSchedule,
  useSaveTemplate, useSlotPositions, useUpdateSlotPositions,
  useAllAssignmentsWithSlots, useTemplates,
} from "@/hooks/useSchedules";
import { useMembers } from "@/hooks/useMembers";
import { useExamPeriods, isMemberInExam } from "@/hooks/useExamPeriods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Save, Ban, Trash2, Users, Clock, Plus, Pencil, X, CalendarPlus, CalendarMinus, Lock, CopyPlus, Repeat, GripVertical } from "lucide-react";
import type { Member, FreeTimes, SlotPosition } from "@/lib/types";
import { buildPositionGroups } from "@/lib/scheduleMerge";
import { toast } from "sonner";
import ScheduleExport from "@/components/ScheduleExport";
import { getCurrentRole } from "@/lib/adminAuth";

// ─── Helpers ───
const HOURS = Array.from({ length: 10 }, (_, i) => i + 8);
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

function fmt(h: number, m = 0): string {
  const suffix = h >= 12 ? "pm" : "am";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m > 0 ? `${display}:${String(m).padStart(2, "0")}${suffix}` : `${display}${suffix}`;
}

function parseToMin(t: string): number {
  const m1 = t.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m1) return -1;
  let h = parseInt(m1[1]);
  const mi = m1[2] ? parseInt(m1[2]) : 0;
  const p = m1[3];
  if (p === "pm" && h !== 12) h += 12;
  if (p === "am" && h === 12) h = 0;
  if (!p && h >= 1 && h <= 6) h += 12;
  return h * 60 + mi;
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return fmt(h, m);
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${dayNames[d.getDay()]} (${d.getDate()} ${monthNames[d.getMonth()]})`;
}

function getDayOfWeek(dayLabel: string, slotDate: string | null): keyof FreeTimes | null {
  const dayNames: (keyof FreeTimes)[] = ["Sunday" as any, "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" as any];
  
  // Prefer deriving from actual date
  if (slotDate) {
    const d = new Date(slotDate + "T00:00:00");
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return null; // Weekend - no free_times entry
    return dayNames[dow] as keyof FreeTimes;
  }
  
  // Fallback: parse from label
  const dayMap: Record<string, keyof FreeTimes> = {
    mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday",
    monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday",
  };
  const dayKey = dayLabel.toLowerCase().split(" ")[0].replace(/[^a-z]/g, "");
  return dayMap[dayKey] || dayMap[dayKey.slice(0, 3)] || null;
}

function isMemberFree(
  member: Member, dayLabel: string, slotDate: string | null, timeStart: string, timeEnd: string,
  existingAssignments?: { slot_id: string; member_id: string }[],
  allSlots?: { id?: string; day_label: string; slot_date?: string | null; time_start: string; time_end: string }[],
  crossScheduleAssignments?: { member_id: string; schedule_id: string; day_label: string; slot_date: string | null; time_start: string; time_end: string }[],
  currentScheduleId?: string,
): boolean {
  const ft = member.free_times as FreeTimes;
  if (!ft) return false;

  const mapped = getDayOfWeek(dayLabel, slotDate);
  if (!mapped) return false; // Weekend or unknown day
  
  const dayFree = ft[mapped];
  if (!dayFree || dayFree.length === 0) return false;
  
  const sStart = parseToMin(timeStart), sEnd = parseToMin(timeEnd);
  if (sStart < 0 || sEnd < 0) return false;
  
  // Check if member's free time covers this slot
  let free = false;
  for (const range of dayFree) {
    const [a, b] = range.split("-").map(s => s.trim());
    const fs = parseToMin(a), fe = parseToMin(b);
    if (fs >= 0 && fe >= 0 && fs <= sStart && fe >= sEnd) { free = true; break; }
  }
  if (!free) return false;

  // Check conflict with existing assignments in THIS schedule
  if (existingAssignments && allSlots) {
    for (const a of existingAssignments.filter(x => x.member_id === member.id)) {
      const s = allSlots.find(x => x.id === a.slot_id);
      if (!s) continue;
      // Match by date if available, else by label
      if (slotDate && s.slot_date) {
        if (s.slot_date !== slotDate) continue;
      } else {
        if (s.day_label !== dayLabel) continue;
      }
      const as2 = parseToMin(s.time_start), ae = parseToMin(s.time_end);
      if (sStart < ae && sEnd > as2) return false;
    }
  }

  // Check cross-schedule conflicts (other schedules)
  if (crossScheduleAssignments && currentScheduleId) {
    for (const ca of crossScheduleAssignments) {
      if (ca.member_id !== member.id) continue;
      if (ca.schedule_id === currentScheduleId) continue;
      if (slotDate && ca.slot_date) {
        if (slotDate !== ca.slot_date) continue;
      } else {
        if (ca.day_label !== dayLabel) continue;
      }
      const cs = parseToMin(ca.time_start), ce = parseToMin(ca.time_end);
      if (sStart < ce && sEnd > cs) return false;
    }
  }
  return true;
}

function debugAvailability(
  member: Member,
  dayLabel: string,
  slotDate: string | null,
  timeStart: string,
  timeEnd: string,
  existingAssignments?: { slot_id: string; member_id: string }[],
  allSlots?: { id?: string; day_label: string; slot_date?: string | null; time_start: string; time_end: string }[],
  crossScheduleAssignments?: { member_id: string; schedule_id: string; day_label: string; slot_date: string | null; time_start: string; time_end: string }[],
  currentScheduleId?: string,
) {
  const mapped = getDayOfWeek(dayLabel, slotDate);
  const dayFree = mapped ? (member.free_times as FreeTimes)?.[mapped] : undefined;
  const free = isMemberFree(member, dayLabel, slotDate, timeStart, timeEnd, existingAssignments, allSlots, crossScheduleAssignments, currentScheduleId);
  console.log("[availability-debug]", {
    member: displayName(member),
    dayLabel,
    slotDate,
    timeStart,
    timeEnd,
    mappedDay: mapped,
    freeTimesForDay: dayFree,
    free,
    currentScheduleId,
    sameScheduleConflicts: (existingAssignments || []).filter(a => a.member_id === member.id).length,
    crossScheduleConflicts: (crossScheduleAssignments || []).filter(a => a.member_id === member.id && a.schedule_id !== currentScheduleId),
  });
  return free;
}

// ─── Types ───
interface DayEntry {
  label: string;
  date: string;
}

interface LocalSlot {
  id?: string;
  day_label: string;
  slot_date: string;
  time_start: string;
  time_end: string;
  duty: string;
  note: string;
  is_blocked: boolean;
  max_people: number;
  sort_order: number;
}

// ─── Component ───
export default function AdminScheduleEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: schedule } = useSchedule(id);
  const { data: dbSlots = [], isFetched: slotsFetched } = useTimeSlots(id);
  const { data: assignments = [] } = useAssignments(id);
  const { data: slotPositions = [] } = useSlotPositions(id);
  const { data: members = [] } = useMembers();
  const { data: allCrossAssignments = [] } = useAllAssignmentsWithSlots();
  const { data: examPeriods = [] } = useExamPeriods();
  const { data: templates = [] } = useTemplates();
  const saveSlots = useSaveSlots();
  const assignMember = useAssignMember();
  const unassignMember = useUnassignMember();
  const updateSchedule = useUpdateSchedule();
  const saveTemplate = useSaveTemplate();
  const updateSlotPositions = useUpdateSlotPositions();

  // Public users can only edit schedules they created (created_by_role === 'public').
  // They cannot edit admin-created schedules.
  const role = getCurrentRole();
  const canEdit = role === "admin" || schedule?.created_by_role === "public";

  const backToList = () => {
    const tab = schedule?.schedule_type === "exco" ? "exco" : "all";
    navigate(`/admin/schedules?tab=${tab}`);
  };

  useEffect(() => {
    if (schedule && role === "public" && schedule.created_by_role !== "public") {
      toast.error("You can only view admin-created schedules");
      navigate("/admin/schedules");
    }
  }, [schedule, role, navigate]);

  // Days are managed independently from slots
  const [days, setDays] = useState<DayEntry[]>([]);
  const [localSlots, setLocalSlots] = useState<LocalSlot[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState("");

  // Time picker state
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [pickerDay, setPickerDay] = useState<string>("");
  const [pickerDate, setPickerDate] = useState<string>("");
  const [selecting, setSelecting] = useState(false);
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [dragSelectionMode, setDragSelectionMode] = useState<"add" | "remove" | null>(null);

  // Add day dialog
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDayDate, setNewDayDate] = useState("");

  // Edit slot dialog
  const [editSlotIdx, setEditSlotIdx] = useState<number | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editApplyAll, setEditApplyAll] = useState(false);

  // Delete slot confirmation dialog
  const [deleteSlotIdx, setDeleteSlotIdx] = useState<number | null>(null);
  const [deleteApplyAll, setDeleteApplyAll] = useState(false);

  // "Apply same time slots to every day" — persistent toggle.
  // When ON: editing/deleting a slot affects every day with the same time range,
  // and the time picker fills every day at once.
  const [applyAllMode, setApplyAllMode] = useState(false);

  // Position editing
  const [showPosDialog, setShowPosDialog] = useState(false);
  const [editPosSlotId, setEditPosSlotId] = useState<string | null>(null);
  const [editPosSlotKey, setEditPosSlotKey] = useState<{ day_label: string; slot_date: string | null; time_start: string; time_end: string } | null>(null);
  const [editPositions, setEditPositions] = useState<{ name: string; max_members: number; group_label?: string | null; programmes?: string | null; previous_classroom?: string | null }[]>([]);

  // Default positions
  const [showDefaultPosDialog, setShowDefaultPosDialog] = useState(false);
  const [defaultPositions, setDefaultPositions] = useState<{ name: string; max_members: number; group_label?: string | null; programmes?: string | null; previous_classroom?: string | null }[]>([]);

  // Template
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");

  // Auto-save debounce
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSlotsRef = useRef<string>("");
  // When true, the next localSlots change should trigger an immediate save
  // (used after applying a template so the freshly-built slots persist to DB).
  const forceFirstSaveRef = useRef(false);
  // Per-slot position overrides pending from a template apply.
  // Key = `${day_label}|${slot_date}|${time_start}|${time_end}` → list of positions.
  // Consumed by doAutoSave once slots have DB ids.
  const pendingPositionsByKeyRef = useRef<Record<string, { name: string; max_members: number; group_label?: string | null; programmes?: string | null; previous_classroom?: string | null }[]> | null>(null);

  // Touch drag state (for tablet/mobile where HTML5 DnD doesn't work)
  const touchDragRef = useRef<{
    memberId: string;
    sourceSlotId?: string;
    sourcePositionId?: string | null;
    ghost: HTMLDivElement | null;
  } | null>(null);

  // Generate all days from date range (skip Sat & Sun by default)
  const generateDaysFromRange = useCallback((startDate: string, endDate: string): DayEntry[] => {
    const results: DayEntry[] = [];
    const [sy, sm, sd] = startDate.split("-").map(Number);
    const [ey, em, ed] = endDate.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getDay();
      // Skip Saturday (6) and Sunday (0)
      if (dow !== 0 && dow !== 6) {
        const yyyy = cur.getFullYear();
        const mm = String(cur.getMonth() + 1).padStart(2, "0");
        const dd = String(cur.getDate()).padStart(2, "0");
        const dateStr = `${yyyy}-${mm}-${dd}`;
        results.push({ label: formatDateLabel(dateStr), date: dateStr });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return results;
  }, []);

  // Init: build days list from date range + any extra days from DB slots.
  // If schedule has a template_id and no existing slots, auto-apply the template.
  useEffect(() => {
    if (initialized) return;
    if (!slotsFetched) return; // Wait until slots query has completed
    if (!schedule) return;

    const isWeekly = !!(schedule as any).is_weekly;

    // ── Weekly schedule path: fixed Mon–Fri, no specific dates ──
    if (isWeekly) {
      const weeklyDays: DayEntry[] = WEEKDAYS.map((d) => ({ label: d, date: "" }));
      setDays(weeklyDays);

      // If we have DB slots already (with day_label = weekday name), load them as-is.
      if (dbSlots.length > 0) {
        setLocalSlots(dbSlots.map(s => ({
          id: s.id, day_label: s.day_label, slot_date: "",
          time_start: s.time_start, time_end: s.time_end,
          duty: s.duty || "",
          note: (s as any).note || "",
          is_blocked: s.is_blocked,
          max_people: s.max_people, sort_order: s.sort_order,
        })));
        setInitialized(true);
        return;
      }

      // If a template is attached, build slots from it (using weekday names as labels).
      const wtpl = schedule.template_id ? templates.find(t => t.id === schedule.template_id) : null;
      const wcfg = wtpl?.config as any;
      if (wcfg && Array.isArray(wcfg.time_slots_per_day) && wcfg.time_slots_per_day.length > 0) {
        const newSlots: LocalSlot[] = [];
        let order = 0;
        WEEKDAYS.forEach((label, di) => {
          const list = wcfg.time_slots_per_day[di] || wcfg.time_slots_per_day[di % wcfg.time_slots_per_day.length] || [];
          for (const ts of list) {
            newSlots.push({
              day_label: label,
              slot_date: "",
              time_start: ts.time_start,
              time_end: ts.time_end,
              duty: ts.duty || "",
              note: ts.note || "",
              is_blocked: false,
              max_people: 1,
              sort_order: order++,
            });
          }
        });
        setLocalSlots(newSlots);
        forceFirstSaveRef.current = true;

        if (Array.isArray(wcfg.default_positions) && wcfg.default_positions.length > 0
            && (!schedule.default_positions || schedule.default_positions.length === 0)) {
          setDefaultPositions(wcfg.default_positions);
          updateSchedule.mutate({ id: schedule.id, default_positions: wcfg.default_positions });
        }

        if (wcfg.positions_by_slot_key && typeof wcfg.positions_by_slot_key === "object") {
          pendingPositionsByKeyRef.current = wcfg.positions_by_slot_key;
        }
      }

      setInitialized(true);
      return;
    }

    // ── Template auto-apply path ──
    const tpl = schedule.template_id ? templates.find(t => t.id === schedule.template_id) : null;
    const cfg = tpl?.config as any;
    const hasTemplate = !!cfg && Array.isArray(cfg.days) && cfg.days.length > 0;
    if (hasTemplate && dbSlots.length === 0 && schedule.start_date) {
      const dayCount: number = cfg.days.length;
      // Build N consecutive days starting from start_date (skip weekends)
      const built: DayEntry[] = [];
      const [sy, sm, sd] = schedule.start_date.split("-").map(Number);
      const cur = new Date(sy, sm - 1, sd);
      while (built.length < dayCount) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) {
          const yyyy = cur.getFullYear();
          const mm = String(cur.getMonth() + 1).padStart(2, "0");
          const dd = String(cur.getDate()).padStart(2, "0");
          const dateStr = `${yyyy}-${mm}-${dd}`;
          built.push({ label: formatDateLabel(dateStr), date: dateStr });
        }
        cur.setDate(cur.getDate() + 1);
      }
      setDays(built);

      // Build slots from per-day config (or fallback to shared time_slots for every day)
      const perDay: any[][] = Array.isArray(cfg.time_slots_per_day) && cfg.time_slots_per_day.length === dayCount
        ? cfg.time_slots_per_day
        : built.map(() => cfg.time_slots || []);
      const newSlots: LocalSlot[] = [];
      let order = 0;
      built.forEach((d, di) => {
        for (const ts of perDay[di] || []) {
          newSlots.push({
            day_label: d.label,
            slot_date: d.date,
            time_start: ts.time_start,
            time_end: ts.time_end,
            duty: ts.duty || "",
            note: ts.note || "",
            is_blocked: false,
            max_people: 1,
            sort_order: order++,
          });
        }
      });
      setLocalSlots(newSlots);
      // Mark that this change must be saved (skip the "first-render skip" guard).
      forceFirstSaveRef.current = true;

      // Apply default positions from template (only if schedule has none yet)
      if (Array.isArray(cfg.default_positions) && cfg.default_positions.length > 0
          && (!schedule.default_positions || schedule.default_positions.length === 0)) {
        setDefaultPositions(cfg.default_positions);
        updateSchedule.mutate({ id: schedule.id, default_positions: cfg.default_positions });
      }

      if (cfg.positions_by_slot_key && typeof cfg.positions_by_slot_key === "object") {
        pendingPositionsByKeyRef.current = cfg.positions_by_slot_key;
      }
      const lastDate = built[built.length - 1]?.date;
      if (lastDate && lastDate !== schedule.end_date) {
        updateSchedule.mutate({ id: schedule.id, end_date: lastDate });
      }

      setInitialized(true);
      return;
    }

    // ── Normal path: build days from date range ──
    let rangeDays: DayEntry[] = [];
    if (schedule.start_date && schedule.end_date) {
      rangeDays = generateDaysFromRange(schedule.start_date, schedule.end_date);
    }

    // Add any extra days from DB slots not in the range
    if (dbSlots.length > 0) {
      const existingDates = new Set(rangeDays.map(d => d.date));
      for (const slot of dbSlots) {
        const date = slot.slot_date || "";
        if (date && !existingDates.has(date)) {
          existingDates.add(date);
          rangeDays.push({ label: slot.day_label, date });
        }
      }
      rangeDays.sort((a, b) => a.date.localeCompare(b.date));
    }

    if (rangeDays.length > 0 || dbSlots.length > 0 || slotsFetched) {
      setDays(rangeDays);
      setLocalSlots(dbSlots.map(s => ({
        id: s.id, day_label: s.day_label, slot_date: s.slot_date || "",
        time_start: s.time_start, time_end: s.time_end,
        duty: s.duty || "",
        note: (s as any).note || "",
        is_blocked: s.is_blocked,
        max_people: s.max_people, sort_order: s.sort_order,
      })));
      setInitialized(true);
    }
  }, [dbSlots, schedule, initialized, generateDaysFromRange, slotsFetched, templates, updateSchedule]);

  useEffect(() => {
    if (schedule) {
      setScheduleName(schedule.name);
      setDefaultPositions(schedule.default_positions || []);
    }
  }, [schedule]);

  // ─── Auto-save slots ───
  const doAutoSave = useCallback(async (slots: LocalSlot[]) => {
    if (!id) return;
    const validSlots = slots.filter(s => s.time_start && s.time_end);

    type CapturedPos = { position_name: string; max_members: number; sort_order: number; group_label: string | null; programmes: string | null; previous_classroom: string | null };
    type CapturedAssign = { member_id: string; position_name: string | null };
    const capturedByLocalIdx = new Map<number, { positions: CapturedPos[]; assigns: CapturedAssign[] }>();

    validSlots.forEach((s, i) => {
      if (!s.id) return;
      const positions = slotPositions
        .filter(p => p.slot_id === s.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(p => ({
          position_name: p.position_name,
          max_members: p.max_members,
          sort_order: p.sort_order,
          group_label: (p as any).group_label ?? null,
          programmes: (p as any).programmes ?? null,
          previous_classroom: (p as any).previous_classroom ?? null,
        }));
      const assigns = assignments
        .filter(a => a.slot_id === s.id)
        .map(a => {
          const pos = slotPositions.find(p => p.id === a.position_id);
          return { member_id: a.member_id, position_name: pos?.position_name ?? null };
        });
      if (positions.length > 0 || assigns.length > 0) {
        capturedByLocalIdx.set(i, { positions, assigns });
      }
    });

    try {
      const insertedSlots = await saveSlots.mutateAsync({
        scheduleId: id,
        slots: validSlots.map((s, i) => ({
          schedule_id: id, day_label: s.day_label, slot_date: s.slot_date || null,
          time_start: s.time_start, time_end: s.time_end,
          duty: s.duty || null,
          note: s.note || null,
          is_blocked: s.is_blocked,
          max_people: s.max_people, sort_order: i,
        })) as any,
        defaultPositions,
      });

      if (!insertedSlots) return;

      // Keep local slot ids synced with the newly re-inserted DB rows.
      setLocalSlots(prev => {
        let validIdx = 0;
        return prev.map((slot) => {
          if (!slot.time_start || !slot.time_end) return slot;
          const inserted = insertedSlots[validIdx++];
          return inserted
            ? {
                ...slot,
                id: inserted.id,
                sort_order: inserted.sort_order,
              }
            : slot;
        });
      });

      for (let i = 0; i < insertedSlots.length; i++) {
        const newSlot: any = insertedSlots[i];
        const captured = capturedByLocalIdx.get(i);
        if (!captured) continue;

        const sameAsDefault =
          captured.positions.length === defaultPositions.length &&
          captured.positions.every((p, idx) =>
            p.position_name === defaultPositions[idx]?.name &&
            p.max_members === defaultPositions[idx]?.max_members &&
            (p.group_label || null) === ((defaultPositions[idx] as any)?.group_label || null) &&
            (p.programmes || null) === ((defaultPositions[idx] as any)?.programmes || null) &&
            (p.previous_classroom || null) === ((defaultPositions[idx] as any)?.previous_classroom || null),
          );

        if (!sameAsDefault) {
          await supabase.from("schedule_slot_positions").delete().eq("slot_id", newSlot.id);
          if (captured.positions.length > 0) {
            await supabase.from("schedule_slot_positions").insert(
              captured.positions.map((p, idx) => ({
                slot_id: newSlot.id,
                position_name: p.position_name,
                max_members: p.max_members,
                group_label: p.group_label,
                programmes: p.programmes,
                previous_classroom: p.previous_classroom,
                sort_order: idx,
              })) as any,
            );
          }
        }

        const { data: newPositions } = await supabase
          .from("schedule_slot_positions")
          .select("*")
          .eq("slot_id", newSlot.id);

        for (const sa of captured.assigns) {
          let positionId: string | null = null;
          if (sa.position_name && newPositions) {
            positionId = newPositions.find((p: any) => p.position_name === sa.position_name)?.id ?? null;
          }
          if (!positionId && newPositions && newPositions.length > 0) {
            positionId = newPositions[0].id;
          }
          await supabase.from("schedule_assignments").insert({
            slot_id: newSlot.id,
            member_id: sa.member_id,
            position_id: positionId,
          });
        }
      }

      // Apply pending per-slot position overrides from a template apply.
      const pendingByKey = pendingPositionsByKeyRef.current;
      if (pendingByKey) {
        pendingPositionsByKeyRef.current = null;
        for (let i = 0; i < insertedSlots.length; i++) {
          const ns: any = insertedSlots[i];
          const localSlot = validSlots[i];
          if (!localSlot) continue;
          const dayIdx = days.findIndex(d =>
            (d.date && d.date === localSlot.slot_date) || (!d.date && d.label === localSlot.day_label),
          );
          // Try new dayIdx-based key first, then legacy key for backward compat
          const newKey = `${dayIdx}|${localSlot.time_start}|${localSlot.time_end}`;
          const legacyKey = `${localSlot.day_label}|${localSlot.slot_date || ""}|${localSlot.time_start}|${localSlot.time_end}`;
          const positions = pendingByKey[newKey] || pendingByKey[legacyKey];
          if (!positions || positions.length === 0) continue;
          await supabase.from("schedule_slot_positions").delete().eq("slot_id", ns.id);
          await supabase.from("schedule_slot_positions").insert(
            positions.map((p, idx) => ({
              slot_id: ns.id,
              position_name: p.name,
              max_members: p.max_members,
              group_label: p.group_label || null,
              programmes: p.programmes || null,
              previous_classroom: (p as any).previous_classroom || null,
              sort_order: idx,
            })) as any,
          );
        }
      }

      queryClient.invalidateQueries({ queryKey: ["timeSlots", id] });
      queryClient.invalidateQueries({ queryKey: ["assignments", id] });
      queryClient.invalidateQueries({ queryKey: ["slotPositions", id] });
    } catch {
      // error handled by mutation
    }
  }, [id, saveSlots, defaultPositions, assignments, slotPositions, queryClient, days]);

  useEffect(() => {
    if (!initialized || !id) return;
    const serialized = JSON.stringify(localSlots);
    if (prevSlotsRef.current === serialized) return;
    if (prevSlotsRef.current === "" && !forceFirstSaveRef.current) {
      prevSlotsRef.current = serialized;
      return;
    }
    prevSlotsRef.current = serialized;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    // After a template apply, save immediately so the editor stops showing "Auto-saving...".
    const delay = forceFirstSaveRef.current ? 0 : 1500;
    forceFirstSaveRef.current = false;
    autoSaveTimer.current = setTimeout(() => doAutoSave(localSlots), delay);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [localSlots, initialized, id, doAutoSave]);

  // Auto-save schedule name
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNameRef = useRef("");
  useEffect(() => {
    if (!id || !schedule) return;
    if (prevNameRef.current === "") { prevNameRef.current = scheduleName; return; }
    if (scheduleName === prevNameRef.current) return;
    prevNameRef.current = scheduleName;
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => {
      if (scheduleName !== schedule.name) {
        updateSchedule.mutate({ id, name: scheduleName });
      }
    }, 1000);
    return () => { if (nameTimer.current) clearTimeout(nameTimer.current); };
  }, [scheduleName, id, schedule, updateSchedule]);

  // ─── Day Management ───
  const addDay = (dateStr: string) => {
    if (!dateStr) return;
    if (days.some(d => d.date === dateStr)) {
      toast.error("This date already exists");
      return;
    }
    const label = formatDateLabel(dateStr);
    const newDays = [...days, { label, date: dateStr }].sort((a, b) => a.date.localeCompare(b.date));
    setDays(newDays);

    // Update schedule start/end dates
    if (id) {
      const allDates = newDays.map(d => d.date).sort();
      const newStart = allDates[0];
      const newEnd = allDates[allDates.length - 1];
      const todayStr = new Date().toISOString().split("T")[0];
      const updates: Parameters<typeof updateSchedule.mutate>[0] = { id, start_date: newStart, end_date: newEnd };
      if (newEnd >= todayStr && schedule?.status === "history") {
        updates.status = "active";
      }
      updateSchedule.mutate(updates);
    }
    setShowAddDay(false);
    setNewDayDate("");
    toast.success(`Added ${label}`);
  };

  const deleteDay = async (date: string) => {
    // Remove day and all its slots
    const newDays = days.filter(d => d.date !== date);
    setDays(newDays);
    const removedLabel = days.find(d => d.date === date)?.label;
    setLocalSlots(prev => prev.filter(s => s.slot_date !== date && s.day_label !== removedLabel));

    // Update schedule start/end dates
    if (id && newDays.length > 0) {
      const allDates = newDays.map(d => d.date).sort();
      updateSchedule.mutate({ id, start_date: allDates[0], end_date: allDates[allDates.length - 1] });
    }
    toast.success("Day removed");
  };

  // Filter members by type
  const filteredMembers = useMemo(() => {
    if (!schedule) return members;
    if (schedule.schedule_type === "exco") return members.filter(m => m.position === "SLT" || m.position === "EXCO");
    return members;
  }, [members, schedule]);

  const groupedMembers = useMemo(() => ({
    SLT: filteredMembers.filter(m => m.position === "SLT"),
    EXCO: filteredMembers.filter(m => m.position === "EXCO"),
    Junior: filteredMembers.filter(m => m.position === "Junior"),
  }), [filteredMembers]);

  const selectedDbSlot = useMemo(() => {
    if (!selectedSlotId) return null;
    return dbSlots.find(s => s.id === selectedSlotId) || null;
  }, [selectedSlotId, dbSlots]);

  const getSlotAssignments = useCallback((slotId?: string) => {
    if (!slotId) return [];
    return assignments.filter(a => a.slot_id === slotId);
  }, [assignments]);

  const getSlotPositions = useCallback((slotId?: string): SlotPosition[] => {
    if (!slotId) return [];
    return slotPositions.filter(p => p.slot_id === slotId);
  }, [slotPositions]);

  const applyHourSelection = useCallback((hourIdx: number, mode: "add" | "remove") => {
    setSelectedHours(prev => {
      const next = new Set(prev);
      if (mode === "add") next.add(hourIdx);
      else next.delete(hourIdx);
      return Array.from(next).sort((a, b) => a - b);
    });
  }, []);

  const selectedHoursSummary = useMemo(() => {
    if (selectedHours.length === 0) return "";
    const ranges: Array<{ start: number; end: number }> = [];
    const sorted = [...selectedHours].sort((a, b) => a - b);
    sorted.forEach((hourIdx) => {
      const current = ranges[ranges.length - 1];
      if (!current || hourIdx > current.end + 1) {
        ranges.push({ start: hourIdx, end: hourIdx });
      } else {
        current.end = hourIdx;
      }
    });
    return ranges
      .map((range) => `${fmt(HOURS[range.start])} - ${fmt(HOURS[range.end] + 1)}`)
      .join(", ");
  }, [selectedHours]);

  const isWeekly = !!(schedule as any)?.is_weekly;

  // ─── Time Picker ───
  const openTimePicker = (dayLabel: string, date: string) => {
    // Honor persistent applyAllMode toggle; do NOT reset it here.
    setPickerDay(dayLabel);
    setPickerDate(date);
    setSelectedHours([]);
    setSelecting(false);
    setDragSelectionMode(null);
    setShowTimePicker(true);
  };

  const handleGridMouseDown = (hourIdx: number) => {
    const nextMode = selectedHours.includes(hourIdx) ? "remove" : "add";
    setSelecting(true);
    setDragSelectionMode(nextMode);
    applyHourSelection(hourIdx, nextMode);
  };

  const handleGridMouseEnter = (hourIdx: number) => {
    if (selecting && dragSelectionMode) applyHourSelection(hourIdx, dragSelectionMode);
  };

  const handleGridMouseUp = () => {
    setSelecting(false);
    setDragSelectionMode(null);
  };

  const confirmTimeSelection = () => {
    if (selectedHours.length === 0) return;
    const hourIdxs = [...selectedHours].sort((a, b) => a - b);
    const targetDays: DayEntry[] = applyAllMode
      ? days
      : [{ label: pickerDay, date: pickerDate }];

    setLocalSlots(prev => {
      const next = [...prev];
      let order = next.length;
      for (const day of targetDays) {
        for (const i of hourIdxs) {
          const h = HOURS[i];
          const ts = minToTime(h * 60);
          const te = minToTime((h + 1) * 60);
          const exists = next.some(s =>
            s.day_label === day.label &&
            (day.date ? s.slot_date === day.date : true) &&
            s.time_start === ts && s.time_end === te
          );
          if (exists) continue;
          next.push({
            day_label: day.label,
            slot_date: day.date,
            time_start: ts, time_end: te,
            duty: "", note: "",
            is_blocked: false, max_people: 1,
            sort_order: order++,
          });
        }
      }
      return next;
    });

    setShowTimePicker(false);
    if (applyAllMode) toast.success(`Applied ${hourIdxs.length} time slot${hourIdxs.length > 1 ? "s" : ""} to all ${targetDays.length} days`);
  };

  // ─── Slot Edit ───
  const openEditSlot = (idx: number) => {
    const slot = localSlots[idx];
    setEditSlotIdx(idx);
    setEditApplyAll(applyAllMode);
    const sm = parseToMin(slot.time_start);
    const em = parseToMin(slot.time_end);
    setEditStart(sm >= 0 ? `${String(Math.floor(sm/60)).padStart(2,"0")}:${String(sm%60).padStart(2,"0")}` : "");
    setEditEnd(em >= 0 ? `${String(Math.floor(em/60)).padStart(2,"0")}:${String(em%60).padStart(2,"0")}` : "");
  };

  const saveEditSlot = () => {
    if (editSlotIdx === null) return;
    const sm = parseToMin(editStart);
    const em = parseToMin(editEnd);
    if (sm < 0 || em < 0 || em <= sm) { toast.error("Invalid time range"); return; }
    const target = localSlots[editSlotIdx];
    const newStart = minToTime(sm);
    const newEnd = minToTime(em);
    setLocalSlots(prev => prev.map((s, i) => {
      if (i === editSlotIdx) return { ...s, time_start: newStart, time_end: newEnd };
      if (editApplyAll && s.time_start === target.time_start && s.time_end === target.time_end) {
        return { ...s, time_start: newStart, time_end: newEnd };
      }
      return s;
    }));
    setEditSlotIdx(null);
  };

  const performDeleteSlot = (idx: number, applyAll: boolean) => {
    const target = localSlots[idx];
    setLocalSlots(prev => prev.filter((s, i) => {
      if (i === idx) return false;
      if (applyAll && s.time_start === target.time_start && s.time_end === target.time_end) return false;
      return true;
    }));
    setDeleteSlotIdx(null);
  };


  // ─── Drag & Drop ───
  const performDrop = async (payload: {
    memberId: string;
    sourceSlotId?: string;
    sourcePositionId?: string | null;
  }, slotId: string, positionId?: string) => {
    const { memberId, sourceSlotId, sourcePositionId } = payload;
    if (!memberId || !slotId) return;

    const slotAssigns = getSlotAssignments(slotId);
    const sameSlotMove = sourceSlotId === slotId;

    // Same slot, same position → no-op
    if (sameSlotMove && (sourcePositionId || null) === (positionId || null)) return;

    if (positionId) {
      const pos = slotPositions.find(p => p.id === positionId);
      const posAssigns = slotAssigns.filter(a => a.position_id === positionId);
      // Capacity check excludes the dragged-out source assignment when
      // moving within the same slot.
      const effectiveCount = sameSlotMove
        ? posAssigns.filter(a => !(a.member_id === memberId && a.position_id === sourcePositionId)).length
        : posAssigns.length;
      if (pos && effectiveCount >= pos.max_members) { toast.error("Position is full"); return; }
      // Block the same member appearing twice in the same position.
      if (posAssigns.some(a => a.member_id === memberId && !(sameSlotMove && a.position_id === sourcePositionId))) {
        toast.error("Already in this position");
        return;
      }
    } else {
      // Drop on slot body (no specific position) — block exact duplicate only.
      if (slotAssigns.some(a => a.member_id === memberId && !a.position_id)) {
        toast.error("Already assigned");
        return;
      }
    }

    // Warn-not-block on conflicts (only when bringing in from elsewhere).
    if (!sameSlotMove) {
      const dbSlot = dbSlots.find(s => s.id === slotId);
      const member = members.find(m => m.id === memberId);
      if (dbSlot && member) {
        if (isMemberInExam(memberId, dbSlot.slot_date, examPeriods)) {
          toast.warning(`${displayName(member)} is in exam period — assigned anyway`);
        } else {
          const free = isMemberFree(member, dbSlot.day_label, dbSlot.slot_date || null, dbSlot.time_start, dbSlot.time_end);
          if (!free) {
            toast.warning(`${displayName(member)} is busy at this time — assigned anyway`);
          } else {
            const busyOther = allCrossAssignments.some(ca =>
              ca.member_id === memberId && ca.schedule_id !== id &&
              ((dbSlot.slot_date && ca.slot_date && dbSlot.slot_date === ca.slot_date) ||
               (!dbSlot.slot_date && ca.day_label === dbSlot.day_label)) &&
              parseToMin(dbSlot.time_start) < parseToMin(ca.time_end) &&
              parseToMin(dbSlot.time_end) > parseToMin(ca.time_start)
            );
            if (busyOther) toast.warning(`${displayName(member)} is in another schedule at this time — assigned anyway`);
          }
        }
      }
    }

    if (sameSlotMove) {
      // Move between positions inside the same slot: remove the specific
      // source assignment (matching position), then insert the new one.
      const toRemove = assignments.find(a =>
        a.slot_id === slotId &&
        a.member_id === memberId &&
        (a.position_id || null) === (sourcePositionId || null),
      );
      if (toRemove) {
        await supabase.from("schedule_assignments").delete().eq("id", toRemove.id);
      }
    } else if (sourceSlotId) {
      const srcAssign = assignments.find(a =>
        a.slot_id === sourceSlotId &&
        a.member_id === memberId &&
        (a.position_id || null) === (sourcePositionId || null),
      );
      if (srcAssign) {
        await unassignMember.mutateAsync({ assignmentId: srcAssign.id });
      } else {
        await unassignMember.mutateAsync({ slotId: sourceSlotId, memberId, positionId: sourcePositionId });
      }
    }
    await assignMember.mutateAsync({ slotId, memberId, positionId });
    queryClient.invalidateQueries({ queryKey: ["assignments", id] });
  };

  const handleDrop = async (e: React.DragEvent, slotId: string, positionId?: string) => {
    e.preventDefault();
    await performDrop({
      memberId: e.dataTransfer.getData("memberId"),
      sourceSlotId: e.dataTransfer.getData("sourceSlotId") || undefined,
      sourcePositionId: e.dataTransfer.getData("sourcePositionId") || null,
    }, slotId, positionId);
  };

  // Bulk-assign one member to every position in a group (e.g. all 6 courses in LR 507)
  const performGroupDrop = async (memberId: string, slotId: string, positionIds: string[], sourceSlotId?: string, sourcePositionId?: string | null) => {
    if (!memberId || positionIds.length === 0) return;
    if (sourceSlotId && sourceSlotId !== slotId) {
      const src = assignments.find(a => a.slot_id === sourceSlotId && a.member_id === memberId && (a.position_id || null) === (sourcePositionId || null));
      if (src) await unassignMember.mutateAsync({ assignmentId: src.id });
    }
    let assigned = 0;
    for (const positionId of positionIds) {
      const pos = slotPositions.find(p => p.id === positionId);
      if (!pos) continue;
      const already = assignments.some(a => a.slot_id === slotId && a.member_id === memberId && a.position_id === positionId);
      if (already) continue;
      const count = assignments.filter(a => a.slot_id === slotId && a.position_id === positionId).length;
      if (count >= pos.max_members) continue;
      await assignMember.mutateAsync({ slotId, memberId, positionId });
      assigned++;
    }
    if (assigned > 0) {
      const mem = members.find(m => m.id === memberId);
      toast.success(`Assigned ${displayName(mem)} to ${assigned} position${assigned !== 1 ? "s" : ""}`);
    }
    queryClient.invalidateQueries({ queryKey: ["assignments", id] });
  };

  const handleGroupDrop = async (e: React.DragEvent, slotId: string, positionIds: string[]) => {
    e.preventDefault();
    e.stopPropagation();
    await performGroupDrop(
      e.dataTransfer.getData("memberId"),
      slotId,
      positionIds,
      e.dataTransfer.getData("sourceSlotId") || undefined,
      e.dataTransfer.getData("sourcePositionId") || null,
    );
  };

  // Touch drag helpers
  const createGhost = (text: string, x: number, y: number): HTMLDivElement => {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.position = "fixed";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.zIndex = "9999";
    el.style.pointerEvents = "none";
    el.style.opacity = "0.85";
    el.style.background = "hsl(var(--primary))";
    el.style.color = "hsl(var(--primary-foreground))";
    el.style.padding = "6px 12px";
    el.style.borderRadius = "6px";
    el.style.fontSize = "14px";
    el.style.fontWeight = "500";
    el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
    el.style.transform = "translate(-50%, -50%)";
    document.body.appendChild(el);
    return el;
  };

  const findDropZone = (clientX: number, clientY: number): { slotId: string; positionId?: string; groupPositionIds?: string[] } | null => {
    // Hide ghost momentarily so elementFromPoint sees what's underneath
    const ghost = touchDragRef.current?.ghost;
    if (ghost) ghost.style.display = "none";
    const el = document.elementFromPoint(clientX, clientY);
    if (ghost) ghost.style.display = "";
    if (!el) return null;
    let cur: Element | null = el;
    while (cur) {
      if (cur instanceof HTMLElement && cur.dataset.dropSlotId) {
        const groupIds = cur.dataset.dropGroupPositionIds;
        return {
          slotId: cur.dataset.dropSlotId,
          positionId: cur.dataset.dropPositionId,
          groupPositionIds: groupIds ? groupIds.split(",").filter(Boolean) : undefined,
        };
      }
      cur = cur.parentElement;
    }
    return null;
  };

  const onTouchDragStart = (
    e: React.TouchEvent,
    payload: { memberId: string; sourceSlotId?: string; sourcePositionId?: string | null; label?: string }
  ) => {
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault(); // prevent scroll
    const ghost = createGhost(payload.label || "Member", touch.clientX, touch.clientY);
    touchDragRef.current = { ...payload, ghost };
  };

  const onTouchDragMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch || !touchDragRef.current?.ghost) return;
    e.preventDefault();
    const ghost = touchDragRef.current.ghost!;
    ghost.style.left = `${touch.clientX}px`;
    ghost.style.top = `${touch.clientY}px`;
  };

  const onTouchDragEnd = async (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch || !touchDragRef.current) return;
    const payload = touchDragRef.current;
    if (payload.ghost) {
      payload.ghost.remove();
    }
    touchDragRef.current = null;

    const dropZone = findDropZone(touch.clientX, touch.clientY);
    if (dropZone) {
      if (dropZone.groupPositionIds && dropZone.groupPositionIds.length > 0) {
        await performGroupDrop(payload.memberId, dropZone.slotId, dropZone.groupPositionIds, payload.sourceSlotId, payload.sourcePositionId);
      } else {
        await performDrop(
          { memberId: payload.memberId, sourceSlotId: payload.sourceSlotId, sourcePositionId: payload.sourcePositionId },
          dropZone.slotId,
          dropZone.positionId,
        );
      }
    }
  };

  // ─── Position editing ───
  const openPositionEditor = (slotId: string) => {
    const positions = getSlotPositions(slotId);
    const dbSlot = dbSlots.find(s => s.id === slotId);
    setEditPosSlotId(slotId);
    setEditPosSlotKey(dbSlot ? {
      day_label: dbSlot.day_label,
      slot_date: dbSlot.slot_date || null,
      time_start: dbSlot.time_start,
      time_end: dbSlot.time_end,
    } : null);
    setEditPositions(positions.map(p => ({
      name: p.position_name,
      max_members: p.max_members,
      group_label: (p as any).group_label || "",
      programmes: (p as any).programmes || "",
      previous_classroom: (p as any).previous_classroom || "",
    })));
    setShowPosDialog(true);
  };

  const savePositions = async () => {
    if (!editPosSlotId) return;
    // Resolve to current slot id in case autosave re-created the row with a new id.
    let targetId = editPosSlotId;
    const stillExists = dbSlots.some(s => s.id === targetId);
    if (!stillExists && editPosSlotKey) {
      const match = dbSlots.find(s =>
        s.day_label === editPosSlotKey.day_label &&
        (s.slot_date || null) === editPosSlotKey.slot_date &&
        s.time_start === editPosSlotKey.time_start &&
        s.time_end === editPosSlotKey.time_end,
      );
      if (match) targetId = match.id;
      else {
        toast.error("Slot is still saving — please try again in a moment.");
        return;
      }
    }
    await updateSlotPositions.mutateAsync({ slotId: targetId, positions: editPositions });
    setShowPosDialog(false);
    toast.success("Positions updated");
  };

  const saveDefaultPositions = async () => {
    if (!id) return;
    await updateSchedule.mutateAsync({ id, default_positions: defaultPositions });
    if (dbSlots.length > 0) {
      await Promise.all(
        dbSlots.map((slot) => updateSlotPositions.mutateAsync({ slotId: slot.id, positions: defaultPositions })),
      );
    }
    setShowDefaultPosDialog(false);
    toast.success("Default positions updated");
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return;
    const dayIndex = new Map<string, number>();
    days.forEach((d, i) => dayIndex.set(d.date || d.label, i));
    const timeSlotsPerDay: { time_start: string; time_end: string; duty?: string; note?: string }[][] =
      days.map(() => []);
    const positionsByKey: Record<string, { name: string; max_members: number; group_label?: string | null; programmes?: string | null; previous_classroom?: string | null }[]> = {};
    for (const s of localSlots) {
      if (!s.time_start || !s.time_end) continue;
      const key = s.slot_date || s.day_label;
      const idx = dayIndex.get(key);
      if (idx === undefined) continue;
      timeSlotsPerDay[idx].push({
        time_start: s.time_start,
        time_end: s.time_end,
        duty: s.duty || undefined,
        note: s.note || undefined,
      });
      if (s.id) {
        const positions = slotPositions
          .filter(p => p.slot_id === s.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(p => ({
            name: p.position_name,
            max_members: p.max_members,
            group_label: (p as any).group_label || null,
            programmes: (p as any).programmes || null,
            previous_classroom: (p as any).previous_classroom || null,
          }));
        if (positions.length > 0) {
          // Stable key independent of dates so the template applies to schedules
          // built on any start date: dayIdx|time_start|time_end
          const slotKey = `${idx}|${s.time_start}|${s.time_end}`;
          positionsByKey[slotKey] = positions;
        }
      }
    }
    const config = {
      days: days.map(d => ({ label: d.label })),
      time_slots: localSlots
        .filter(s => s.time_start)
        .map(s => ({ time_start: s.time_start, time_end: s.time_end })),
      time_slots_per_day: timeSlotsPerDay,
      default_positions: defaultPositions,
      positions_by_slot_key: positionsByKey,
      schedule_type: schedule?.schedule_type,
      is_weekly: isWeekly,
      duties: [],
    };
    await saveTemplate.mutateAsync({ name: templateName, config: config as any });
    setShowTemplateDialog(false);
    setTemplateName("");
  };

  if (!schedule) return <div className="p-8">Loading...</div>;

  return (
    <div className="flex flex-col-reverse md:flex-row h-screen overflow-hidden">
      {/* LEFT (desktop) / BOTTOM (phone): Members */}
      <div className="w-full md:w-72 border-t md:border-t-0 md:border-r border-border flex flex-col bg-card shrink-0 max-h-[40vh] md:max-h-none">
        <div className="p-4 border-b border-border">
          <Button variant="ghost" size="sm" className="mb-2 gap-2" onClick={backToList}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <h3 className="font-semibold text-sm">Members</h3>
          {selectedDbSlot && (
            <p className="text-xs text-muted-foreground mt-1">
              Showing availability for {selectedDbSlot.time_start} - {selectedDbSlot.time_end}
            </p>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-4">
            {(["SLT", "EXCO", "Junior"] as const).map(pos => {
              if (schedule.schedule_type === "exco" && pos === "Junior") return null;
              return (
                <div key={pos}>
                  <p className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">{pos}</p>
                  <div className="space-y-1">
                    {groupedMembers[pos].map(m => {
                      const free = selectedDbSlot
                        ? debugAvailability(
                            m,
                            selectedDbSlot.day_label,
                            selectedDbSlot.slot_date || null,
                            selectedDbSlot.time_start,
                            selectedDbSlot.time_end,
                            assignments,
                            dbSlots,
                            allCrossAssignments,
                            id,
                          )
                        : false;
                      const busyInOther = selectedDbSlot && !free && allCrossAssignments.some(ca =>
                        ca.member_id === m.id &&
                        ca.schedule_id !== id &&
                        ((selectedDbSlot.slot_date && ca.slot_date && selectedDbSlot.slot_date === ca.slot_date) ||
                         (!selectedDbSlot.slot_date && ca.day_label === selectedDbSlot.day_label)) &&
                        parseToMin(selectedDbSlot.time_start) < parseToMin(ca.time_end) &&
                        parseToMin(selectedDbSlot.time_end) > parseToMin(ca.time_start)
                      );
                      const inExam = selectedDbSlot ? isMemberInExam(m.id, selectedDbSlot.slot_date, examPeriods) : false;
                      // "No class today" — member's free_times for this weekday covers the full 8am–6pm window
                      const noClassToday = (() => {
                        if (!selectedDbSlot) return false;
                        const mapped = getDayOfWeek(selectedDbSlot.day_label, selectedDbSlot.slot_date || null);
                        if (!mapped) return false;
                        const dayFree = (m.free_times as FreeTimes)?.[mapped];
                        if (!dayFree || dayFree.length === 0) return false;
                        const dayStart = 8 * 60, dayEnd = 18 * 60;
                        return dayFree.some(r => {
                          const [a, b] = r.split("-").map(s => s.trim());
                          const fs = parseToMin(a), fe = parseToMin(b);
                          return fs >= 0 && fe >= 0 && fs <= dayStart && fe >= dayEnd;
                        });
                      })();
                      const count = assignments.filter(a => a.member_id === m.id).length;
                      return (
                        <div
                          key={m.id}
                          draggable
                          onDragStart={e => { e.dataTransfer.setData("memberId", m.id); }}
                          onTouchStart={e => onTouchDragStart(e, { memberId: m.id, label: displayName(m) })}
                          onTouchMove={onTouchDragMove}
                          onTouchEnd={onTouchDragEnd}
                          style={{ touchAction: "none" }}
                          className={`p-2 rounded-md border text-sm transition-all cursor-grab active:cursor-grabbing ${
                            selectedDbSlot
                              ? inExam
                                ? "bg-destructive/10 border-destructive text-destructive font-medium"
                                : free
                                ? noClassToday
                                  ? "bg-yellow-100 dark:bg-yellow-500/20 border-yellow-500 text-yellow-900 dark:text-yellow-200 font-medium"
                                  : "bg-green-100 dark:bg-green-500/20 border-green-600 text-green-900 dark:text-green-200 font-medium"
                                : "bg-muted/50 border-border text-muted-foreground"
                              : "bg-muted/50 border-border text-foreground"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="break-words flex-1 min-w-0">{displayName(m)}</span>
                            {count > 0 && <Badge variant="outline" className="text-xs shrink-0">{count}</Badge>}
                          </div>
                          {selectedDbSlot && (
                            <div className="text-xs mt-1">
                              {inExam ? "✗ Busy (Exam)" : free ? (noClassToday ? "✓ No class today" : "✓ Available") : busyInOther ? "✗ Busy (other schedule)" : "✗ Busy"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* RIGHT: Schedule Grid */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap bg-card">
          <Input value={scheduleName} onChange={e => setScheduleName(e.target.value)} className="w-64 font-semibold" />
          <Badge variant={schedule.schedule_type === "all" ? "default" : "secondary"}>
            {schedule.schedule_type === "all" ? "All" : "EXCO Only"}
          </Badge>
          {saveSlots.isPending && (
            <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>
          )}
          <div className="flex-1" />
          <Button
            variant={applyAllMode ? "default" : "outline"}
            size="sm"
            onClick={() => setApplyAllMode(v => !v)}
            className={`gap-1 ${applyAllMode ? "ring-2 ring-primary/40" : ""}`}
            disabled={days.length === 0}
            title={applyAllMode ? "Apply-to-all-days is ON. Click to turn off." : "Apply-to-all-days is OFF. Click to turn on."}
          >
            <CopyPlus className="h-3 w-3" /> Apply to all days: {applyAllMode ? "ON" : "OFF"}
          </Button>
          {!isWeekly && (
            <Button variant="outline" size="sm" onClick={() => setShowAddDay(true)} className="gap-1">
              <CalendarPlus className="h-3 w-3" /> Add Day
            </Button>
          )}
          {isWeekly && (
            <Badge variant="outline" className="gap-1">
              <Repeat className="h-3 w-3" /> Weekly
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowDefaultPosDialog(true)} className="gap-1">
            <Users className="h-3 w-3" /> Positions
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowTemplateDialog(true)} className="gap-1">
            <Save className="h-3 w-3" /> Template
          </Button>
          <ScheduleExport
            schedule={schedule}
            slots={dbSlots}
            assignments={assignments}
            positions={slotPositions}
            members={members}
          />
        </div>

        {/* Weekly date range editor */}
        {isWeekly && (
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center gap-3">
            <Repeat className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Recurring weekly · repeats Mon–Fri between:</span>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={schedule.start_date || ""}
                max={schedule.end_date || undefined}
                onChange={(e) => {
                  if (!id) return;
                  const newStart = e.target.value;
                  if (schedule.end_date && newStart && newStart > schedule.end_date) {
                    toast.error("Start date cannot be later than end date");
                    return;
                  }
                  updateSchedule.mutate({ id, start_date: newStart });
                }}
                className="h-8 w-40"
              />
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={schedule.end_date || ""}
                min={schedule.start_date || undefined}
                onChange={(e) => {
                  if (!id) return;
                  const newEnd = e.target.value;
                  if (schedule.start_date && newEnd && newEnd < schedule.start_date) {
                    toast.error("End date cannot be earlier than start date");
                    return;
                  }
                  const todayStr = new Date().toISOString().split("T")[0];
                  const updates: Parameters<typeof updateSchedule.mutate>[0] = { id, end_date: newEnd };
                  // If end date is today or in the future and schedule is in history, move it back to active
                  if (newEnd && newEnd >= todayStr && schedule.status === "history") {
                    updates.status = "active";
                  }
                  updateSchedule.mutate(updates);
                }}
                className="h-8 w-40"
              />
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-auto p-4">
          {days.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground space-y-3">
              <p>No days yet. Set start/end dates or add days manually.</p>
              <Button variant="outline" onClick={() => setShowAddDay(true)} className="gap-1">
                <CalendarPlus className="h-4 w-4" /> Add Day
              </Button>
            </div>
          ) : (
            <div className="flex gap-4 min-w-max items-start">
              {days.map((day, dayIdx) => {
                const daySlots = localSlots
                  .filter(s => {
                    if (!s.time_start || !s.time_end) return false;
                    if (isWeekly) return s.day_label === day.label;
                    return day.date ? s.slot_date === day.date : s.day_label === day.label;
                  })
                  .sort((a, b) => parseToMin(a.time_start) - parseToMin(b.time_start));
                return (
                  <div key={day.date || day.label} className="min-w-[220px]">
                    <div className="p-3 rounded-t-lg text-center font-semibold text-sm mb-1 bg-muted relative group">
                      <div>{day.label}</div>
                      {day.date && <div className="text-xs opacity-80">{day.date}</div>}
                      <button
                        onClick={() => deleteDay(day.date)}
                        className="absolute top-1 right-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                        title="Remove this day"
                      >
                        <CalendarMinus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Button
                      variant="outline" size="sm"
                      className="w-full mb-2 gap-1 text-xs"
                      onClick={() => openTimePicker(day.label, day.date)}
                    >
                      <Plus className="h-3 w-3" /> Select Time Slots
                    </Button>
                    <div className="space-y-1">
                      {daySlots.map((slot) => {
                        const gIdx = localSlots.indexOf(slot);
                        const dbSlot = dbSlots.find(ds => {
                          if (ds.day_label !== slot.day_label) return false;
                          if (ds.time_start !== slot.time_start || ds.time_end !== slot.time_end) return false;
                          return isWeekly ? true : (ds.slot_date || "") === (slot.slot_date || "");
                        });
                        const isSelected = dbSlot?.id === selectedSlotId && !!selectedSlotId;
                        const slotAssigns = getSlotAssignments(dbSlot?.id);
                        const positions = getSlotPositions(dbSlot?.id);
                        const generalAssigns = slotAssigns.filter(
                          a => !a.position_id || !positions.some(pos => pos.id === a.position_id),
                        );
                        const sm = parseToMin(slot.time_start), em = parseToMin(slot.time_end);
                        const dur = em > sm ? em - sm : 0;
                        const dh = Math.floor(dur / 60), dm = dur % 60;

                        return (
                          <div
                            key={`${slot.day_label}-${slot.time_start}-${gIdx}`}
                            data-drop-slot-id={dbSlot?.id}
                            className={`p-2 rounded-md border text-xs transition-all cursor-pointer ${
                              slot.is_blocked
                                ? "bg-muted/40 border-muted text-muted-foreground"
                                : isSelected
                                ? "ring-2 ring-primary border-primary bg-primary/5"
                                : "bg-card border-border hover:border-primary/30"
                            }`}
                            onClick={() => dbSlot && setSelectedSlotId(isSelected ? null : dbSlot.id)}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => dbSlot && handleDrop(e, dbSlot.id)}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium">
                                {slot.time_start} - {slot.time_end}
                                {dur > 0 && (
                                  <span className="text-muted-foreground font-normal ml-1">
                                    ({dh > 0 ? `${dh}h` : ""}{dm > 0 ? `${dm}m` : ""})
                                  </span>
                                )}
                              </span>
                              <div className="flex gap-0.5">
                                <button onClick={e => { e.stopPropagation(); openEditSlot(gIdx); }} className="p-0.5 hover:text-primary">
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button onClick={e => { e.stopPropagation(); setLocalSlots(p => p.map((s, i) => i === gIdx ? { ...s, is_blocked: !s.is_blocked } : s)); }} className="p-0.5 hover:text-primary">
                                  <Ban className="h-3 w-3" />
                                </button>
                                <button onClick={e => {
                                  e.stopPropagation();
                                  if (applyAllMode) {
                                    setDeleteApplyAll(true);
                                    setDeleteSlotIdx(gIdx);
                                  } else {
                                    performDeleteSlot(gIdx, false);
                                  }
                                }} className="p-0.5 hover:text-destructive">
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                            {/* Slot title/note - editable */}
                            <input
                              type="text"
                              value={slot.note || ""}
                              onClick={e => e.stopPropagation()}
                              onChange={e => {
                                const v = e.target.value;
                                setLocalSlots(p => p.map((s, i) => i === gIdx ? { ...s, note: v } : s));
                              }}
                              placeholder="+ Add slot title / note"
                              className="w-full text-[11px] italic px-1 py-0.5 mb-1 rounded border border-transparent bg-transparent hover:border-border focus:border-primary focus:outline-none placeholder:text-muted-foreground/50"
                            />

                            {slot.is_blocked ? (
                              <div className="text-center py-2 font-medium opacity-50">BLOCKED</div>
                            ) : dbSlot ? (
                              <div className="space-y-1.5">
                                {(() => {
                                  const memberMap = new Map(members.map(m => [m.id, m]));
                                  const groups = buildPositionGroups(positions, slotAssigns, memberMap);
                                  return groups.map((g, gi) => {
                                    // Ungrouped: render each position with its own drop zone (legacy single-position UI)
                                    if (!g.label) {
                                      return g.positions.map(({ position: pos, members: assigned }) => (
                                        <div key={pos.id}
                                          className="border border-dashed border-border/60 rounded p-1"
                                          data-drop-slot-id={dbSlot.id}
                                          data-drop-position-id={pos.id}
                                          onDragOver={e => e.preventDefault()}
                                          onDrop={e => { e.stopPropagation(); handleDrop(e, dbSlot.id, pos.id); }}
                                        >
                                          <div className="text-[10px] text-muted-foreground font-medium mb-0.5">
                                            {pos.position_name} ({assigned.length}/{pos.max_members})
                                          </div>
                                          {(pos as any).programmes && (
                                            <div className="text-[9px] text-muted-foreground/70 italic mb-0.5 whitespace-pre-wrap">
                                              {(pos as any).programmes}
                                            </div>
                                          )}
                                          {assigned.map(mem => {
                                            const a = slotAssigns.find(x => x.member_id === mem.id && x.position_id === pos.id);
                                            return a ? (
                                              <div key={a.id} draggable className="flex items-center justify-between bg-accent/50 rounded px-1.5 py-0.5 mb-0.5 cursor-grab active:cursor-grabbing"
                                                onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData("memberId", a.member_id); e.dataTransfer.setData("sourceSlotId", dbSlot.id); e.dataTransfer.setData("sourcePositionId", pos.id); }}
                                                onTouchStart={e => onTouchDragStart(e, { memberId: a.member_id, sourceSlotId: dbSlot.id, sourcePositionId: pos.id, label: displayName(mem) })}
                                                onTouchMove={onTouchDragMove}
                                                onTouchEnd={onTouchDragEnd}
                                                style={{ touchAction: "none" }}>
                                                <span className="truncate">{displayName(mem)}</span>
                                                <button onClick={e => { e.stopPropagation(); unassignMember.mutate({ assignmentId: a.id }); }} className="text-destructive ml-1">×</button>
                                              </div>
                                            ) : null;
                                          })}
                                          {assigned.length < pos.max_members && (
                                            <div className="text-muted-foreground/40 text-center text-[10px] py-0.5">
                                              Drop member here
                                            </div>
                                          )}
                                        </div>
                                      ));
                                    }

                                    // Grouped: one drop zone covers ALL positions in the group
                                    const groupPosIds = g.positions.map(p => p.position.id);
                                    return (
                                      <div key={`g-${gi}`} className="border border-primary/30 rounded-md bg-primary/5"
                                        data-drop-slot-id={dbSlot.id}
                                        data-drop-group-position-ids={groupPosIds.join(",")}
                                        onDragOver={e => e.preventDefault()}
                                        onDrop={e => handleGroupDrop(e, dbSlot.id, groupPosIds)}
                                      >
                                        <div className="flex items-center justify-between gap-1 px-1.5 py-0.5 border-b border-primary/20">
                                          <span className="text-[10px] font-bold text-primary uppercase tracking-wider truncate">
                                            {g.label}
                                          </span>
                                          {g.previousClassroom && (
                                            <span className="text-[9px] text-muted-foreground italic shrink-0">prev: {g.previousClassroom}</span>
                                          )}
                                        </div>
                                        <div className="p-1 space-y-0.5">
                                          {g.positions.map(({ position: pos, members: assigned }) => (
                                            <div key={pos.id} className="flex items-start gap-1 text-[10px]">
                                              <div className="flex-1 min-w-0">
                                                <div className="font-medium text-[10px] truncate">{pos.position_name}</div>
                                                {(pos as any).programmes && (
                                                  <div className="text-[9px] text-muted-foreground/70 italic truncate">{(pos as any).programmes}</div>
                                                )}
                                              </div>
                                              <div className="shrink-0 max-w-[55%] text-right">
                                                {assigned.length === 0 ? (
                                                  <span className="text-muted-foreground/40">—</span>
                                                ) : assigned.map(mem => {
                                                  const a = slotAssigns.find(x => x.member_id === mem.id && x.position_id === pos.id);
                                                  return a ? (
                                                    <span key={a.id} draggable
                                                      className="inline-flex items-center bg-accent/60 rounded px-1 py-0 ml-0.5 cursor-grab active:cursor-grabbing"
                                                      onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData("memberId", a.member_id); e.dataTransfer.setData("sourceSlotId", dbSlot.id); e.dataTransfer.setData("sourcePositionId", pos.id); }}
                                                      onTouchStart={e => onTouchDragStart(e, { memberId: a.member_id, sourceSlotId: dbSlot.id, sourcePositionId: pos.id, label: displayName(mem) })}
                                                      onTouchMove={onTouchDragMove}
                                                      onTouchEnd={onTouchDragEnd}
                                                      style={{ touchAction: "none" }}>
                                                      <span className="truncate max-w-[80px]">{displayName(mem)}</span>
                                                      <button onClick={e => { e.stopPropagation(); unassignMember.mutate({ assignmentId: a.id }); }} className="text-destructive ml-0.5">×</button>
                                                    </span>
                                                  ) : null;
                                                })}
                                              </div>
                                            </div>
                                          ))}
                                          <div className="text-primary/60 text-center text-[9px] py-0.5 italic border-t border-primary/15 mt-0.5">
                                            Drop member → assigns to all {g.positions.length}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  });
                                })()}
                                <div
                                  className="border border-dashed border-border/60 rounded p-1"
                                  data-drop-slot-id={dbSlot.id}
                                  onDragOver={e => e.preventDefault()}
                                  onDrop={e => { e.stopPropagation(); handleDrop(e, dbSlot.id); }}
                                >
                                  <div className="text-[10px] text-muted-foreground font-medium mb-0.5">
                                    {positions.length > 0 ? `General (${generalAssigns.length})` : `Members (${generalAssigns.length})`}
                                  </div>
                                  {generalAssigns.map(a => {
                                    const mem = members.find(m => m.id === a.member_id);
                                    return mem ? (
                                      <div key={a.id} draggable className="flex items-center justify-between bg-accent/50 rounded px-1.5 py-0.5 mb-0.5 cursor-grab active:cursor-grabbing"
                                        onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData("memberId", a.member_id); e.dataTransfer.setData("sourceSlotId", dbSlot.id); e.dataTransfer.setData("sourcePositionId", ""); }}
                                        onTouchStart={e => onTouchDragStart(e, { memberId: a.member_id, sourceSlotId: dbSlot.id, sourcePositionId: "", label: displayName(mem) })}
                                        onTouchMove={onTouchDragMove}
                                        onTouchEnd={onTouchDragEnd}
                                        style={{ touchAction: "none" }}>
                                        <span className="truncate">{displayName(mem)}</span>
                                        <button onClick={e => { e.stopPropagation(); unassignMember.mutate({ assignmentId: a.id }); }} className="text-destructive ml-1">×</button>
                                      </div>
                                    ) : null;
                                  })}
                                  <div className="text-muted-foreground/40 text-center text-[10px] py-0.5">
                                    Drop member here
                                  </div>
                                </div>
                                <button
                                  onClick={e => { e.stopPropagation(); openPositionEditor(dbSlot.id); }}
                                  className="w-full text-[10px] text-muted-foreground hover:text-primary text-center"
                                >
                                  Edit positions
                                </button>
                              </div>
                            ) : (
                              <div className="text-muted-foreground/40 text-center py-1 text-[10px]">
                                Auto-saving...
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {/* Inline Add Day button beside last day */}
              {days.length > 0 && (
                <div className="min-w-[160px] flex items-start pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs border-dashed"
                    onClick={() => {
                      const lastDate = days[days.length - 1].date;
                      const [y, m, d] = lastDate.split("-").map(Number);
                      const next = new Date(y, m - 1, d);
                      // Skip to the next weekday (Mon–Fri)
                      do {
                        next.setDate(next.getDate() + 1);
                      } while (next.getDay() === 0 || next.getDay() === 6);
                      const yy = next.getFullYear();
                      const mm = String(next.getMonth() + 1).padStart(2, "0");
                      const dd = String(next.getDate()).padStart(2, "0");
                      addDay(`${yy}-${mm}-${dd}`);
                    }}
                  >
                    <CalendarPlus className="h-3 w-3" /> Add Next Day
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Day Dialog */}
      <Dialog open={showAddDay} onOpenChange={setShowAddDay}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Day</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date</Label>
              <Input type="date" value={newDayDate} onChange={e => setNewDayDate(e.target.value)} />
            </div>
            <Button onClick={() => addDay(newDayDate)} className="w-full" disabled={!newDayDate}>
              Add Day
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Time Picker Dialog */}
      <Dialog open={showTimePicker} onOpenChange={setShowTimePicker}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Select Time Slots - {pickerDay}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            Click or drag to select multiple hours. Drag across selected hours to remove them.
          </p>
          <div className="select-none" onMouseUp={handleGridMouseUp}>
            {HOURS.map((h, idx) => {
              const isSelectedHour = selectedHours.includes(idx);
              const label = `${fmt(h)} - ${fmt(h + 1)}`;
              const alreadyExists = localSlots.some(
                s => s.day_label === pickerDay && s.time_start === minToTime(h * 60) && s.time_end === minToTime((h + 1) * 60)
              );
              return (
                <div
                  key={h}
                  onMouseDown={() => !alreadyExists && handleGridMouseDown(idx)}
                  onMouseEnter={() => handleGridMouseEnter(idx)}
                  className={`px-4 py-2 border-b border-border cursor-pointer text-sm transition-colors ${
                    alreadyExists
                      ? "bg-muted text-muted-foreground line-through cursor-not-allowed"
                      : isSelectedHour
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {label} {alreadyExists && "(added)"}
                </div>
              );
            })}
          </div>
          {selectedHours.length > 0 && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {selectedHoursSummary} ({selectedHours.length} slot{selectedHours.length > 1 ? "s" : ""})
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelectedHours([])}>Clear</Button>
                <Button size="sm" onClick={confirmTimeSelection}>Add Slots</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Slot Time Dialog */}
      <Dialog open={editSlotIdx !== null} onOpenChange={v => !v && setEditSlotIdx(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Slot Time</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Time</Label>
                <Input type="time" value={editStart} onChange={e => setEditStart(e.target.value)} />
              </div>
              <div>
                <Label>End Time</Label>
                <Input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)} />
              </div>
            </div>
            {editStart && editEnd && (() => {
              const sm = parseToMin(editStart), em = parseToMin(editEnd);
              if (sm >= 0 && em > sm) {
                const d = em - sm;
                return <div className="text-sm text-muted-foreground"><Clock className="h-4 w-4 inline mr-1" />Duration: {Math.floor(d/60)}h {d%60 > 0 ? `${d%60}m` : ""}</div>;
              }
              return null;
            })()}
            <div className="flex items-start gap-2 rounded-md border border-border p-3 bg-muted/30">
              <Checkbox
                id="edit-apply-all"
                checked={editApplyAll}
                onCheckedChange={(v) => setEditApplyAll(v === true)}
                className="mt-0.5"
              />
              <div className="space-y-0.5 leading-tight">
                <Label htmlFor="edit-apply-all" className="cursor-pointer">Apply to all days</Label>
                <p className="text-xs text-muted-foreground">
                  When checked, every other day with the same original time range is updated too.
                </p>
              </div>
            </div>
            <Button onClick={saveEditSlot} className="w-full">Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Slot Confirmation Dialog (shown when Apply-to-all-days is ON) */}
      <Dialog open={deleteSlotIdx !== null} onOpenChange={v => !v && setDeleteSlotIdx(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Time Slot</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Apply-to-all-days is ON. Choose how to delete this slot:
          </p>
          <div className="flex items-start gap-2 rounded-md border border-border p-3 bg-muted/30">
            <Checkbox
              id="del-apply-all"
              checked={deleteApplyAll}
              onCheckedChange={(v) => setDeleteApplyAll(v === true)}
              className="mt-0.5"
            />
            <div className="space-y-0.5 leading-tight">
              <Label htmlFor="del-apply-all" className="cursor-pointer">Delete on all days</Label>
              <p className="text-xs text-muted-foreground">
                Removes every slot across all days that shares this time range. Uncheck to delete only this one.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteSlotIdx(null)}>Cancel</Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => deleteSlotIdx !== null && performDeleteSlot(deleteSlotIdx, deleteApplyAll)}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Slot Positions Dialog */}
      <Dialog open={showPosDialog} onOpenChange={setShowPosDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit Slot Positions</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">Drag the handle to reorder. Title groups positions under a section header (e.g. "LR 507"). Notes is optional extra info shown under the position.</p>
          <ScrollArea className="max-h-[55vh] pr-3">
            <div className="space-y-3">
              {editPositions.map((pos, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = parseInt(e.dataTransfer.getData("text/plain"));
                    if (isNaN(from) || from === i) return;
                    setEditPositions(p => {
                      const next = [...p];
                      const [moved] = next.splice(from, 1);
                      next.splice(i, 0, moved);
                      return next;
                    });
                  }}
                  className="flex gap-2 items-start border border-border rounded-md p-2"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 mt-2" />
                  <div className="flex-1 space-y-1.5">
                    <div className="flex gap-2">
                      <Input value={pos.group_label || ""} onChange={e => setEditPositions(p => p.map((x, j) => j === i ? { ...x, group_label: e.target.value } : x))} placeholder="Venue / Group (e.g. LR 507)" className="flex-1" />
                      <Input value={pos.name} onChange={e => setEditPositions(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Course / Position" className="flex-1" />
                      <Input type="number" min={1} value={pos.max_members} onChange={e => setEditPositions(p => p.map((x, j) => j === i ? { ...x, max_members: parseInt(e.target.value) || 1 } : x))} className="w-16" />
                    </div>
                    <div className="flex gap-2">
                      <Textarea value={pos.programmes || ""} onChange={e => setEditPositions(p => p.map((x, j) => j === i ? { ...x, programmes: e.target.value } : x))} placeholder="Programme / Notes (e.g. Certificate in Information Technology)" rows={2} className="text-xs resize-none flex-1" />
                      <Input value={(pos as any).previous_classroom || ""} onChange={e => setEditPositions(p => p.map((x, j) => j === i ? { ...x, previous_classroom: e.target.value } : x))} placeholder="Previous Classroom (e.g. LT)" className="w-40 self-start" />
                    </div>
                  </div>
                  <button onClick={() => setEditPositions(p => p.filter((_, j) => j !== i))} className="text-destructive mt-2"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="space-y-2 pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => setEditPositions(p => [...p, { name: "Member", max_members: 1, group_label: "", programmes: "", previous_classroom: "" }])} className="gap-1">
              <Plus className="h-3 w-3" /> Add Position
            </Button>
            <Button onClick={savePositions} className="w-full">Save Positions</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Default Positions Dialog */}
      <Dialog open={showDefaultPosDialog} onOpenChange={setShowDefaultPosDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Default Positions for All Slots</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">Applied to all new slots. Use Title to add a section header (e.g. "LR 507"). Drag the handle to reorder.</p>
          <ScrollArea className="max-h-[55vh] pr-3">
            <div className="space-y-3">
              {defaultPositions.map((pos, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = parseInt(e.dataTransfer.getData("text/plain"));
                    if (isNaN(from) || from === i) return;
                    setDefaultPositions(p => {
                      const next = [...p];
                      const [moved] = next.splice(from, 1);
                      next.splice(i, 0, moved);
                      return next;
                    });
                  }}
                  className="flex gap-2 items-start border border-border rounded-md p-2"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 mt-2" />
                  <div className="flex-1 space-y-1.5">
                    <div className="flex gap-2">
                      <Input value={pos.group_label || ""} onChange={e => setDefaultPositions(p => p.map((x, j) => j === i ? { ...x, group_label: e.target.value } : x))} placeholder="Venue / Group (e.g. LR 507)" className="flex-1" />
                      <Input value={pos.name} onChange={e => setDefaultPositions(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Course / Position" className="flex-1" />
                      <Input type="number" min={1} value={pos.max_members} onChange={e => setDefaultPositions(p => p.map((x, j) => j === i ? { ...x, max_members: parseInt(e.target.value) || 1 } : x))} className="w-16" />
                    </div>
                    <div className="flex gap-2">
                      <Textarea value={pos.programmes || ""} onChange={e => setDefaultPositions(p => p.map((x, j) => j === i ? { ...x, programmes: e.target.value } : x))} placeholder="Programme / Notes" rows={2} className="text-xs resize-none flex-1" />
                      <Input value={(pos as any).previous_classroom || ""} onChange={e => setDefaultPositions(p => p.map((x, j) => j === i ? { ...x, previous_classroom: e.target.value } : x))} placeholder="Previous Classroom" className="w-40 self-start" />
                    </div>
                  </div>
                  <button onClick={() => setDefaultPositions(p => p.filter((_, j) => j !== i))} className="text-destructive mt-2"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="space-y-2 pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => setDefaultPositions(p => [...p, { name: "Member", max_members: 1, group_label: "", programmes: "", previous_classroom: "" }])} className="gap-1">
              <Plus className="h-3 w-3" /> Add Position
            </Button>
            <Button onClick={saveDefaultPositions} className="w-full">Save Default Positions</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Save Template Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save as Template</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Template Name</Label>
              <Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Standard Event" />
            </div>
            <Button onClick={handleSaveTemplate} className="w-full">Save Template</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

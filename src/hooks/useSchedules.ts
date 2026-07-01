import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Schedule, TimeSlot, ScheduleAssignment, Template, TemplateConfig, SlotPosition } from "@/lib/types";
import { toast } from "sonner";

type QueryRefreshOptions = {
  refetchInterval?: number | false;
  refetchOnWindowFocus?: boolean;
};

export function useSchedules(
  type?: "all" | "exco",
  status?: "active" | "history",
  options: QueryRefreshOptions = {},
) {
  return useQuery({
    queryKey: ["schedules", type, status],
    queryFn: async () => {
      let q = supabase.from("schedules").select("*").order("start_date", { ascending: true, nullsFirst: false });
      if (type) q = q.eq("schedule_type", type);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Schedule[];
    },
    refetchInterval: options.refetchInterval,
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? false,
    refetchIntervalInBackground: true,
  });
}

export function useSchedule(id: string | undefined) {
  return useQuery({
    queryKey: ["schedule", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase.from("schedules").select("*").eq("id", id).single();
      if (error) throw error;
      return data as unknown as Schedule;
    },
    enabled: !!id,
  });
}

export function useTimeSlots(scheduleId: string | undefined, options: QueryRefreshOptions = {}) {
  return useQuery({
    queryKey: ["timeSlots", scheduleId],
    queryFn: async () => {
      if (!scheduleId) return [];
      const { data, error } = await supabase
        .from("schedule_time_slots")
        .select("*")
        .eq("schedule_id", scheduleId)
        .order("sort_order")
        .order("time_start");
      if (error) throw error;
      return data as unknown as TimeSlot[];
    },
    enabled: !!scheduleId,
    refetchInterval: options.refetchInterval,
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? false,
    refetchIntervalInBackground: true,
  });
}

export function useSlotPositions(scheduleId: string | undefined, options: QueryRefreshOptions = {}) {
  return useQuery({
    queryKey: ["slotPositions", scheduleId],
    queryFn: async () => {
      if (!scheduleId) return [];
      // Get all positions for slots in this schedule
      const { data: slots } = await supabase
        .from("schedule_time_slots")
        .select("id")
        .eq("schedule_id", scheduleId);
      if (!slots || slots.length === 0) return [];
      const slotIds = slots.map(s => s.id);
      const { data, error } = await supabase
        .from("schedule_slot_positions")
        .select("*")
        .in("slot_id", slotIds)
        .order("sort_order");
      if (error) throw error;
      return data as unknown as SlotPosition[];
    },
    enabled: !!scheduleId,
    refetchInterval: options.refetchInterval,
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? false,
    refetchIntervalInBackground: true,
  });
}

export function useAssignments(scheduleId: string | undefined, options: QueryRefreshOptions = {}) {
  return useQuery({
    queryKey: ["assignments", scheduleId],
    queryFn: async () => {
      if (!scheduleId) return [];
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("*, schedule_time_slots!inner(schedule_id)")
        .eq("schedule_time_slots.schedule_id", scheduleId);
      if (error) throw error;
      return (data || []).map((d: Record<string, unknown>) => ({
        id: d.id as string,
        slot_id: d.slot_id as string,
        member_id: d.member_id as string,
        position_id: d.position_id as string | null,
        created_at: d.created_at as string,
      })) as ScheduleAssignment[];
    },
    enabled: !!scheduleId,
    refetchInterval: options.refetchInterval,
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? false,
    refetchIntervalInBackground: true,
  });
}

// Fetch ALL assignments across ALL schedules (for cross-schedule busy detection)
export function useAllAssignmentsWithSlots() {
  return useQuery({
    queryKey: ["allAssignmentsWithSlots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("id, slot_id, member_id, position_id, schedule_time_slots!inner(id, schedule_id, day_label, slot_date, time_start, time_end)");
      if (error) throw error;
      return (data || []).map((d: any) => ({
        id: d.id as string,
        slot_id: d.slot_id as string,
        member_id: d.member_id as string,
        position_id: d.position_id as string | null,
        schedule_id: d.schedule_time_slots?.schedule_id as string,
        day_label: d.schedule_time_slots?.day_label as string,
        slot_date: d.schedule_time_slots?.slot_date as string | null,
        time_start: d.schedule_time_slots?.time_start as string,
        time_end: d.schedule_time_slots?.time_end as string,
      }));
    },
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (schedule: {
      name: string;
      schedule_type: "all" | "exco";
      start_date?: string;
      end_date?: string;
      template_id?: string;
      default_positions?: { name: string; max_members: number }[];
      created_by_role?: "admin" | "public";
      pin_hash?: string | null;
      is_weekly?: boolean;
    }) => {
      const insertPayload: Record<string, unknown> = {
        name: schedule.name,
        schedule_type: schedule.schedule_type,
        start_date: schedule.start_date || null,
        end_date: schedule.end_date || null,
        template_id: schedule.template_id || null,
        default_positions: (schedule.default_positions || []) as any,
      };
      if (schedule.created_by_role) insertPayload.created_by_role = schedule.created_by_role;
      if (schedule.pin_hash !== undefined) insertPayload.pin_hash = schedule.pin_hash;
      if (schedule.is_weekly !== undefined) insertPayload.is_weekly = schedule.is_weekly;
      const { data, error } = await supabase
        .from("schedules")
        .insert(insertPayload as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Schedule;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      toast.success("Schedule created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Schedule> & { id: string }) => {
      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.is_hidden !== undefined) payload.is_hidden = updates.is_hidden;
      if ((updates as any).is_weekly !== undefined) payload.is_weekly = (updates as any).is_weekly;
      if (updates.default_positions !== undefined) payload.default_positions = updates.default_positions;
      if (updates.start_date !== undefined) payload.start_date = updates.start_date;
      if (updates.end_date !== undefined) payload.end_date = updates.end_date;
      if ((updates as any).pin_hash !== undefined) payload.pin_hash = (updates as any).pin_hash;
      const { error } = await supabase.from("schedules").update(payload as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["schedule"] });
      toast.success("Schedule updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("schedules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      toast.success("Schedule deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSaveSlots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      scheduleId,
      slots,
      defaultPositions,
    }: {
      scheduleId: string;
      slots: Omit<TimeSlot, "id" | "created_at">[];
      defaultPositions: { name: string; max_members: number; group_label?: string | null; programmes?: string | null; previous_classroom?: string | null }[];
    }) => {
      await supabase.from("schedule_time_slots").delete().eq("schedule_id", scheduleId);
      if (slots.length === 0) return;

      const { data: insertedSlots, error } = await supabase.from("schedule_time_slots").insert(
        slots.map((s, i) => ({
          schedule_id: scheduleId,
          day_label: s.day_label,
          slot_date: s.slot_date || null,
          time_start: s.time_start,
          time_end: s.time_end,
          duty: s.duty || null,
          note: (s as any).note || null,
          is_blocked: s.is_blocked,
          max_people: s.max_people,
          sort_order: i,
        })) as any,
      ).select();
      if (error) throw error;

      if (insertedSlots && defaultPositions.length > 0) {
        const positionsToInsert = insertedSlots.flatMap(slot =>
          defaultPositions.map((pos: any, idx) => ({
            slot_id: slot.id,
            position_name: pos.name,
            max_members: pos.max_members,
            group_label: pos.group_label || null,
            programmes: pos.programmes || null,
            previous_classroom: pos.previous_classroom || null,
            sort_order: idx,
          }))
        );
        const { error: posError } = await supabase.from("schedule_slot_positions").insert(positionsToInsert as any);
        if (posError) throw posError;
      }

      return insertedSlots;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["timeSlots", vars.scheduleId] });
      qc.invalidateQueries({ queryKey: ["slotPositions", vars.scheduleId] });
      qc.invalidateQueries({ queryKey: ["assignments", vars.scheduleId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpsertTimeSlots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      scheduleId,
      slots,
    }: {
      scheduleId: string;
      slots: Omit<TimeSlot, "id" | "created_at">[];
    }) => {
      await supabase.from("schedule_time_slots").delete().eq("schedule_id", scheduleId);
      if (slots.length > 0) {
        const { error } = await supabase.from("schedule_time_slots").insert(
          slots.map((s) => ({
            schedule_id: scheduleId,
            day_label: s.day_label,
            slot_date: s.slot_date || null,
            time_start: s.time_start,
            time_end: s.time_end,
            duty: s.duty || null,
            is_blocked: s.is_blocked,
            max_people: s.max_people,
            sort_order: s.sort_order,
          }))
        );
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["timeSlots", vars.scheduleId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAssignMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slotId, memberId, positionId }: { slotId: string; memberId: string; positionId?: string }) => {
      const { error } = await supabase
        .from("schedule_assignments")
        .insert({ slot_id: slotId, member_id: memberId, position_id: positionId || null });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUnassignMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      args:
        | { assignmentId: string }
        | { slotId: string; memberId: string; positionId?: string | null },
    ) => {
      if ("assignmentId" in args) {
        const { error } = await supabase
          .from("schedule_assignments")
          .delete()
          .eq("id", args.assignmentId);
        if (error) throw error;
        return;
      }
      let q = supabase
        .from("schedule_assignments")
        .delete()
        .eq("slot_id", args.slotId)
        .eq("member_id", args.memberId);
      if (args.positionId !== undefined) {
        q = args.positionId === null ? q.is("position_id", null) : q.eq("position_id", args.positionId);
      }
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateSlotPositions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slotId, positions }: { slotId: string; positions: { name: string; max_members: number; group_label?: string | null; programmes?: string | null; previous_classroom?: string | null }[] }) => {
      // Delete existing positions for this slot
      await supabase.from("schedule_slot_positions").delete().eq("slot_id", slotId);
      if (positions.length > 0) {
        const { error } = await supabase.from("schedule_slot_positions").insert(
          positions.map((p, i) => ({
            slot_id: slotId,
            position_name: p.name,
            max_members: p.max_members,
            group_label: p.group_label || null,
            programmes: p.programmes || null,
            previous_classroom: p.previous_classroom || null,
            sort_order: i,
          })) as any
        );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["slotPositions"] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Templates
export function useTemplates() {
  return useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("templates").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Template[];
    },
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, config }: { name: string; config: TemplateConfig }) => {
      const insertData = {
        name,
        config: config as unknown as Record<string, unknown>,
      };
      const { error } = await supabase.from("templates").insert(insertData as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, config }: { id: string; name?: string; config?: TemplateConfig }) => {
      const payload: Record<string, unknown> = {};
      if (name !== undefined) payload.name = name;
      if (config !== undefined) payload.config = config as unknown as Record<string, unknown>;
      const { error } = await supabase.from("templates").update(payload as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

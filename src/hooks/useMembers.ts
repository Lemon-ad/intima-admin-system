import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Member, FreeTimes } from "@/lib/types";
import { toast } from "sonner";

export function useMembers() {
  return useQuery({
    queryKey: ["members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("*")
        .order("position")
        .order("name");
      if (error) throw error;
      return data as unknown as Member[];
    },
  });
}

export function useMember(id: string | undefined) {
  return useQuery({
    queryKey: ["member", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("members")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as Member;
    },
    enabled: !!id,
  });
}

export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (member: {
      name: string;
      display_name?: string | null;
      student_id: string;
      course: string;
      position: string;
      schedule_raw?: string;
      free_times?: FreeTimes;
      birthday?: string | null;
    }) => {
      const insertData = {
        name: member.name,
        display_name: member.display_name ?? null,
        student_id: member.student_id,
        course: member.course,
        position: member.position as "SLT" | "EXCO" | "Junior",
        schedule_raw: member.schedule_raw || null,
        free_times: (member.free_times || {}) as unknown as Record<string, unknown>,
        birthday: member.birthday || null,
      };
      const { data, error } = await supabase
        .from("members")
        .insert(insertData as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success("Member registered successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      display_name?: string | null;
      student_id?: string;
      course?: string;
      position?: string;
      schedule_raw?: string | null;
      free_times?: FreeTimes;
      birthday?: string | null;
    }) => {
      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.display_name !== undefined) payload.display_name = updates.display_name;
      if (updates.student_id !== undefined) payload.student_id = updates.student_id;
      if (updates.course !== undefined) payload.course = updates.course;
      if (updates.position !== undefined) payload.position = updates.position;
      if (updates.schedule_raw !== undefined) payload.schedule_raw = updates.schedule_raw;
      if (updates.free_times !== undefined) payload.free_times = updates.free_times as unknown as Record<string, unknown>;
      if (updates.birthday !== undefined) payload.birthday = updates.birthday;

      const { data, error } = await supabase
        .from("members")
        .update(payload as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success("Member updated successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success("Member deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useParseSchedule() {
  return useMutation({
    mutationFn: async ({ scheduleText, images }: { scheduleText?: string; images?: { data: string; mime_type: string }[] }): Promise<FreeTimes> => {
      const { data, error } = await supabase.functions.invoke("parse-schedule", {
        body: { schedule_text: scheduleText || "", images: images || [] },
      });
      if (error) throw error;
      return data.free_times as FreeTimes;
    },
    onError: (e: Error) => toast.error("Failed to parse schedule: " + e.message),
  });
}

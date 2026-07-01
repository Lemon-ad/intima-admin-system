import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ExamPeriod } from "@/lib/types";
import { toast } from "sonner";

export function useExamPeriods() {
  return useQuery({
    queryKey: ["examPeriods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_periods" as any)
        .select("*")
        .order("start_date", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ExamPeriod[];
    },
  });
}

export function useCreateExamPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      member_id: string;
      start_date: string;
      end_date: string;
      note?: string;
    }) => {
      const { error } = await supabase.from("exam_periods" as any).insert(input as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["examPeriods"] });
      toast.success("Exam period added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateExamPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ExamPeriod> & { id: string }) => {
      const { error } = await supabase
        .from("exam_periods" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["examPeriods"] });
      toast.success("Exam period updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteExamPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("exam_periods" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["examPeriods"] });
      toast.success("Exam period removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Helper: check if a member is in exam during a given date
export function isMemberInExam(
  memberId: string,
  date: string | null,
  examPeriods: ExamPeriod[],
): boolean {
  if (!date) return false;
  return examPeriods.some(
    (ep) => ep.member_id === memberId && ep.start_date <= date && ep.end_date >= date,
  );
}

import { useState, useMemo } from "react";
import { useMembers } from "@/hooks/useMembers";
import { useSchedules } from "@/hooks/useSchedules";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Calendar, BarChart3, Search } from "lucide-react";
import type { Member } from "@/lib/types";
import FreeTimeTable from "@/components/FreeTimeTable";
import UpcomingBirthdays from "@/components/UpcomingBirthdays";

export default function AdminDashboard() {
  const { data: members = [] } = useMembers();
  const { data: schedules = [] } = useSchedules();

  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [courseFilter, setCourseFilter] = useState<string>("all");

  const currentYear = new Date().getFullYear();
  const { data: assignmentCounts = {} } = useQuery({
    queryKey: ["assignmentCounts", currentYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_assignments")
        .select("member_id, schedule_time_slots!inner(slot_date, schedules!inner(start_date, end_date))");
      if (error) throw error;
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear}-12-31`;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        const slotDate: string | null = row.schedule_time_slots?.slot_date;
        const sched = row.schedule_time_slots?.schedules;
        let inYear = false;
        if (slotDate) {
          inYear = slotDate >= yearStart && slotDate <= yearEnd;
        } else if (sched?.start_date || sched?.end_date) {
          const start = sched.start_date || yearStart;
          const end = sched.end_date || yearEnd;
          inYear = start <= yearEnd && end >= yearStart;
        } else {
          inYear = true;
        }
        if (inYear) counts[row.member_id] = (counts[row.member_id] || 0) + 1;
      });
      return counts;
    },
  });

  const courses = useMemo(() => {
    const set = new Set(members.map((m) => m.course).filter(Boolean));
    return Array.from(set).sort();
  }, [members]);

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (positionFilter !== "all" && m.position !== positionFilter) return false;
      if (courseFilter !== "all" && m.course !== courseFilter) return false;
      return true;
    });
  }, [members, search, positionFilter, courseFilter]);

  const sltCount = members.filter((m) => m.position === "SLT").length;
  const excoCount = members.filter((m) => m.position === "EXCO").length;
  const juniorCount = members.filter((m) => m.position === "Junior").length;
  const activeSchedules = schedules.filter((s) => s.status === "active" && !s.is_hidden).length;

  const stats = [
    { label: "Total Members", value: members.length, icon: Users, color: "text-primary" },
    { label: "SLT", value: sltCount, icon: Users, color: "text-tag-slt" },
    { label: "EXCO", value: excoCount, icon: Users, color: "text-tag-exco" },
    { label: "Juniors", value: juniorCount, icon: Users, color: "text-tag-members" },
    { label: "Active Schedules", value: activeSchedules, icon: Calendar, color: "text-primary" },
    { label: "Total Schedules", value: schedules.length, icon: BarChart3, color: "text-muted-foreground" },
  ];

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {stats.map((s) => (
          <Card key={s.label} className="animate-fade-in">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-8">
        <UpcomingBirthdays />
      </div>

      <h3 className="text-lg font-semibold mb-4">Member Overview</h3>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={positionFilter} onValueChange={setPositionFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Position" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Positions</SelectItem>
            <SelectItem value="SLT">SLT</SelectItem>
            <SelectItem value="EXCO">EXCO</SelectItem>
            <SelectItem value="Junior">Junior</SelectItem>
          </SelectContent>
        </Select>
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Course" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Courses</SelectItem>
            {courses.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        {filteredMembers.length === 0 && (
          <p className="text-muted-foreground text-sm">No members found.</p>
        )}
        {filteredMembers.map((m) => (
          <div
            key={m.id}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg bg-card border border-border"
          >
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-wrap">
              <span
                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium border ${
                  m.position === "SLT"
                    ? "bg-tag-slt-bg text-tag-slt border-tag-slt/30"
                    : m.position === "EXCO"
                    ? "bg-tag-exco-bg text-tag-exco border-tag-exco/30"
                    : "bg-tag-members-bg text-tag-members border-tag-members/30"
                }`}
              >
                {m.position}
              </span>
              <span className="font-medium break-words">{m.name}</span>
              <span className="text-sm text-muted-foreground">{m.student_id}</span>
            </div>
            <div className="flex items-center justify-between sm:justify-end gap-3 sm:shrink-0 pl-0 sm:pl-3">
              <span className="text-sm font-medium text-primary whitespace-nowrap">
                {assignmentCounts[m.id] || 0} slots
              </span>
              <span className="text-sm text-muted-foreground whitespace-nowrap">{m.course}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <FreeTimeTable />
      </div>
    </div>
  );
}

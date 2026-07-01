import { useMemo } from "react";
import { displayName } from "@/lib/utils";
import { useAssignments, useSlotPositions, useTimeSlots } from "@/hooks/useSchedules";
import { useMembers } from "@/hooks/useMembers";
import { Badge } from "@/components/ui/badge";
import type { Schedule } from "@/lib/types";

interface MergedScheduleViewProps {
  scheduleIds: string[];
  schedules: Schedule[];
  searchTerm: string;
  autoRefreshMs?: number;
  dateRange?: { start: string; end: string } | null;
}

function useScheduleData(scheduleId: string, autoRefreshMs: number) {
  const refreshOptions = {
    refetchInterval: autoRefreshMs > 0 ? autoRefreshMs : (false as const),
    refetchOnWindowFocus: false,
  };
  const { data: slots = [] } = useTimeSlots(scheduleId, refreshOptions);
  const { data: assignments = [] } = useAssignments(scheduleId, refreshOptions);
  const { data: positions = [] } = useSlotPositions(scheduleId, refreshOptions);
  return { slots, assignments, positions };
}

function MergedScheduleContent({
  scheduleIds,
  schedules,
  searchTerm,
  autoRefreshMs = 5000,
  dateRange = null,
}: MergedScheduleViewProps) {
  const { data: members = [] } = useMembers();
  const normalizedSearch = searchTerm.trim().toLowerCase();

  // Load data for up to 10 schedules
  const s0 = useScheduleData(scheduleIds[0] || "", autoRefreshMs);
  const s1 = useScheduleData(scheduleIds[1] || "", autoRefreshMs);
  const s2 = useScheduleData(scheduleIds[2] || "", autoRefreshMs);
  const s3 = useScheduleData(scheduleIds[3] || "", autoRefreshMs);
  const s4 = useScheduleData(scheduleIds[4] || "", autoRefreshMs);
  const s5 = useScheduleData(scheduleIds[5] || "", autoRefreshMs);
  const s6 = useScheduleData(scheduleIds[6] || "", autoRefreshMs);
  const s7 = useScheduleData(scheduleIds[7] || "", autoRefreshMs);
  const s8 = useScheduleData(scheduleIds[8] || "", autoRefreshMs);
  const s9 = useScheduleData(scheduleIds[9] || "", autoRefreshMs);

  const allData = [s0, s1, s2, s3, s4, s5, s6, s7, s8, s9];

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  // Helpers for weekly expansion (local date parsing - no UTC)
  const parseLocal = (iso: string): Date => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const toIso = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const dayNameToIdx: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  };

  // Group matching slots by day, similar to per-event view layout but cross-schedule
  const dayGroups = useMemo(() => {
    type SlotEntry = {
      key: string;
      scheduleName: string;
      timeStart: string;
      timeEnd: string;
      positionName: string;
      memberName: string;
      memberPosition: string;
      note: string | null;
      duty: string | null;
    };
    type DayGroup = { dayLabel: string; date: string; slots: SlotEntry[] };

    const map = new Map<string, DayGroup>();

    for (let i = 0; i < scheduleIds.length; i++) {
      const scheduleId = scheduleIds[i];
      if (!scheduleId) continue;
      const schedule = schedules.find((s) => s.id === scheduleId);
      const { slots, assignments, positions } = allData[i];

      for (const slot of slots) {
        const slotAssignments = assignments.filter((a) => a.slot_id === slot.id);
        const matching = slotAssignments.filter((a) => {
          const member = memberMap.get(a.member_id);
          return member && (member.name.toLowerCase().includes(normalizedSearch) || (member.display_name||'').toLowerCase().includes(normalizedSearch));
        });
        if (matching.length === 0) continue;

        const slotPositions = positions.filter((p) => p.slot_id === slot.id);

        // Build occurrences: weekly schedules expand across the date range
        const occurrences: { date: string; dayLabel: string }[] = [];
        if (schedule?.is_weekly && schedule.start_date && schedule.end_date) {
          const targetIdx = dayNameToIdx[slot.day_label.trim().toLowerCase()];
          if (targetIdx !== undefined) {
            const start = parseLocal(schedule.start_date);
            const end = parseLocal(schedule.end_date);
            const cur = new Date(start);
            while (cur <= end) {
              if (cur.getDay() === targetIdx) {
                occurrences.push({ date: toIso(cur), dayLabel: slot.day_label });
              }
              cur.setDate(cur.getDate() + 1);
            }
          }
          if (occurrences.length === 0) {
            occurrences.push({ date: slot.slot_date || "", dayLabel: slot.day_label });
          }
        } else {
          occurrences.push({ date: slot.slot_date || "", dayLabel: slot.day_label });
        }

        for (const occ of occurrences) {
          if (dateRange && occ.date) {
            if (occ.date < dateRange.start || occ.date > dateRange.end) continue;
          }
          const dayKey = `${occ.date}|${occ.dayLabel}`;
          if (!map.has(dayKey)) {
            map.set(dayKey, { dayLabel: occ.dayLabel, date: occ.date, slots: [] });
          }
          const group = map.get(dayKey)!;

          for (const assignment of matching) {
            const member = memberMap.get(assignment.member_id);
            if (!member) continue;
            const pos = slotPositions.find((p) => p.id === assignment.position_id);
            group.slots.push({
              key: `${assignment.id}-${occ.date}`,
              scheduleName: schedule?.name || "Unknown",
              timeStart: slot.time_start,
              timeEnd: slot.time_end,
              positionName: pos?.position_name || "General",
              memberName: displayName(member),
              memberPosition: member.position,
              note: (slot as any).note || null,
              duty: slot.duty || null,
            });
          }
        }
      }
    }

    const groups = Array.from(map.values());
    // Sort days ascending
    groups.sort((a, b) => a.date.localeCompare(b.date));
    // Sort slots within each day by start time
    for (const g of groups) {
      g.slots.sort((a, b) => a.timeStart.localeCompare(b.timeStart));
    }
    return groups;
  }, [scheduleIds, schedules, allData, memberMap, normalizedSearch, dateRange]);

  const totalSlots = dayGroups.reduce((acc, g) => acc + g.slots.length, 0);

  if (totalSlots === 0) {
    return (
      <p className="text-muted-foreground text-center py-8">
        No matching slots found for "{searchTerm}"
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">All Slots for "{searchTerm}"</h3>
        <Badge variant="outline">
          {totalSlots} slot{totalSlots !== 1 ? "s" : ""} total
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-4 min-w-max">
          {dayGroups.map((group) => (
            <div key={`${group.date}-${group.dayLabel}`} className="min-w-[260px]">
              <div className="p-3 rounded-t-lg text-center font-semibold text-sm mb-1 intima-gradient text-primary-foreground">
                <div>{group.dayLabel}</div>
                {group.date && <div className="text-xs opacity-80">{group.date}</div>}
              </div>
              <div className="space-y-1">
                {group.slots.map((slot) => (
                  <div
                    key={slot.key}
                    className="p-2 rounded-md border bg-card border-border text-xs"
                  >
                    <div className="font-medium mb-1">
                      {slot.timeStart} - {slot.timeEnd}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      {slot.scheduleName}
                    </div>
                    {slot.note && (
                      <div className="text-foreground/90 text-[12px] font-medium mb-1">
                        {slot.note}
                      </div>
                    )}
                    {slot.duty && (
                      <div className="text-[11px] italic text-muted-foreground mb-1">
                        {slot.duty}
                      </div>
                    )}
                    <div className="rounded border border-border/70 bg-muted/30 p-1">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {slot.positionName}
                      </div>
                      <div className="rounded px-1.5 py-0.5 bg-primary/10 text-primary">
                        {slot.memberName}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MergedScheduleView(props: MergedScheduleViewProps) {
  return <MergedScheduleContent {...props} />;
}

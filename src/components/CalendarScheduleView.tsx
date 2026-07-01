import { useMemo, useState } from "react";
import { displayName } from "@/lib/utils";
import { useAssignments, useSlotPositions, useTimeSlots } from "@/hooks/useSchedules";
import { useMembers } from "@/hooks/useMembers";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Schedule } from "@/lib/types";

interface CalendarScheduleViewProps {
  scheduleIds: string[];
  schedules: Schedule[];
  searchTerm: string;
  autoRefreshMs?: number;
}

type SlotEntry = {
  key: string;
  scheduleName: string;
  timeStart: string;
  timeEnd: string;
  positionName: string;
  memberName: string;
  note: string | null;
  duty: string | null;
};

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

export default function CalendarScheduleView({
  scheduleIds,
  schedules,
  searchTerm,
  autoRefreshMs = 5000,
}: CalendarScheduleViewProps) {
  const { data: members = [] } = useMembers();
  const normalizedSearch = searchTerm.trim().toLowerCase();

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

  // Build map: ISO date -> SlotEntry[]
  const slotsByDate = useMemo(() => {
    const map = new Map<string, SlotEntry[]>();
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

        const dates: string[] = [];
        if (schedule?.is_weekly && schedule.start_date && schedule.end_date) {
          const targetIdx = dayNameToIdx[slot.day_label.trim().toLowerCase()];
          if (targetIdx !== undefined) {
            const start = parseLocal(schedule.start_date);
            const end = parseLocal(schedule.end_date);
            const cur = new Date(start);
            while (cur <= end) {
              if (cur.getDay() === targetIdx) dates.push(toIso(cur));
              cur.setDate(cur.getDate() + 1);
            }
          }
          if (dates.length === 0 && slot.slot_date) dates.push(slot.slot_date);
        } else if (slot.slot_date) {
          dates.push(slot.slot_date);
        }

        for (const date of dates) {
          for (const a of matching) {
            const member = memberMap.get(a.member_id);
            if (!member) continue;
            const pos = slotPositions.find((p) => p.id === a.position_id);
            const entry: SlotEntry = {
              key: `${a.id}-${date}`,
              scheduleName: schedule?.name || "Unknown",
              timeStart: slot.time_start,
              timeEnd: slot.time_end,
              positionName: pos?.position_name || "General",
              memberName: displayName(member),
              note: (slot as any).note || null,
              duty: slot.duty || null,
            };
            if (!map.has(date)) map.set(date, []);
            map.get(date)!.push(entry);
          }
        }
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.timeStart.localeCompare(b.timeStart));
    }
    return map;
  }, [scheduleIds, schedules, allData, memberMap, normalizedSearch]);

  // Default month: earliest duty date or today
  const defaultMonth = useMemo(() => {
    const dates = Array.from(slotsByDate.keys()).sort();
    if (dates.length > 0) {
      const d = parseLocal(dates[0]);
      return new Date(d.getFullYear(), d.getMonth(), 1);
    }
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  }, [slotsByDate]);

  const [viewMonth, setViewMonth] = useState<Date>(defaultMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Calendar grid (6 weeks starting Sunday)
  const grid = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const start = new Date(first);
    start.setDate(start.getDate() - first.getDay());
    const cells: { date: Date; iso: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push({
        date: d,
        iso: toIso(d),
        inMonth: d.getMonth() === viewMonth.getMonth(),
      });
    }
    return cells;
  }, [viewMonth]);

  const totalSlots = Array.from(slotsByDate.values()).reduce((a, b) => a + b.length, 0);
  const todayIso = toIso(new Date());

  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const selectedSlots = selectedDate ? slotsByDate.get(selectedDate) || [] : [];

  // Group selected slots by unique slot (time + scheduleName + note + duty)
  // so multiple positions in the same slot appear under one card
  const groupedSelectedSlots = useMemo(() => {
    const map = new Map<
      string,
      {
        scheduleName: string;
        timeStart: string;
        timeEnd: string;
        note: string | null;
        duty: string | null;
        positions: { positionName: string; memberName: string }[];
      }
    >();
    for (const s of selectedSlots) {
      const key = `${s.scheduleName}|${s.timeStart}|${s.timeEnd}|${s.note || ""}|${s.duty || ""}`;
      if (!map.has(key)) {
        map.set(key, {
          scheduleName: s.scheduleName,
          timeStart: s.timeStart,
          timeEnd: s.timeEnd,
          note: s.note,
          duty: s.duty,
          positions: [],
        });
      }
      map.get(key)!.positions.push({
        positionName: s.positionName,
        memberName: s.memberName,
      });
    }
    return Array.from(map.values());
  }, [selectedSlots]);

  if (totalSlots === 0) {
    return (
      <p className="text-muted-foreground text-center py-8">
        No matching duties found for "{searchTerm}"
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-lg font-semibold">Calendar for "{searchTerm}"</h3>
        <Badge variant="outline">
          {totalSlots} {totalSlots === 1 ? "duty" : "duties"} total
        </Badge>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
          <button
            onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
            className="p-1 rounded hover:bg-muted"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="font-semibold">{monthLabel}</div>
          <button
            onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
            className="p-1 rounded hover:bg-muted"
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-border bg-muted/20">
          {weekDays.map((d) => (
            <div key={d} className="p-2 text-center text-xs font-semibold text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {grid.map((cell) => {
            const entries = slotsByDate.get(cell.iso) || [];
            const hasDuty = entries.length > 0;
            const isToday = cell.iso === todayIso;
            return (
              <button
                key={cell.iso}
                onClick={() => hasDuty && setSelectedDate(cell.iso)}
                disabled={!hasDuty}
                className={`min-h-[72px] sm:min-h-[88px] p-1.5 border-t border-l border-border text-left transition-colors flex flex-col gap-1 ${
                  cell.inMonth ? "bg-card" : "bg-muted/20 text-muted-foreground"
                } ${hasDuty ? "hover:bg-primary/10 cursor-pointer" : "cursor-default"} ${
                  isToday ? "ring-2 ring-primary ring-inset" : ""
                }`}
              >
                <div className="text-xs font-medium">{cell.date.getDate()}</div>
                {hasDuty && (
                  <div className="flex flex-col gap-0.5 mt-auto">
                    <div className="rounded px-1 py-0.5 bg-primary text-primary-foreground text-[10px] font-medium truncate">
                      {entries.length} dut{entries.length === 1 ? "y" : "ies"}
                    </div>
                    <div className="text-[9px] text-primary truncate hidden sm:block">
                      {entries[0].timeStart}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={!!selectedDate} onOpenChange={(o) => !o && setSelectedDate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedDate &&
                parseLocal(selectedDate).toLocaleDateString(undefined, {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {groupedSelectedSlots.map((slot, idx) => (
              <div
                key={`${slot.scheduleName}-${slot.timeStart}-${idx}`}
                className="p-3 rounded-md border border-border bg-card"
              >
                <div className="font-semibold text-sm mb-1">
                  {slot.timeStart} - {slot.timeEnd}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  {slot.scheduleName}
                </div>
                {slot.note && (
                  <div className="text-sm font-medium mb-1">{slot.note}</div>
                )}
                {slot.duty && (
                  <div className="text-xs italic text-muted-foreground mb-2">
                    {slot.duty}
                  </div>
                )}
                <div className="space-y-1.5">
                  {slot.positions.map((p, i) => (
                    <div key={i} className="rounded border border-border/70 bg-muted/30 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        {p.positionName}
                      </div>
                      <div className="rounded px-2 py-0.5 bg-primary/10 text-primary text-sm inline-block">
                        {p.memberName}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

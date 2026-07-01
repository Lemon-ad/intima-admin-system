import { useMemo } from "react";
import { displayName } from "@/lib/utils";
import { useAssignments, useSchedule, useSlotPositions, useTimeSlots } from "@/hooks/useSchedules";
import { useMembers } from "@/hooks/useMembers";
import { buildPositionGroups } from "@/lib/scheduleMerge";

interface PublicScheduleViewProps {
  scheduleId: string;
  searchTerm?: string;
  autoRefreshMs?: number;
  dateRange?: { start: string; end: string } | null;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtDateLabel(d: Date): string {
  return `${DAY_SHORT[d.getDay()]} (${d.getDate()} ${MONTH_SHORT[d.getMonth()]})`;
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function PublicScheduleView({
  scheduleId,
  searchTerm = "",
  autoRefreshMs = 5000,
  dateRange = null,
}: PublicScheduleViewProps) {
  const refetchInterval: number | false = autoRefreshMs > 0 ? autoRefreshMs : false;
  const refreshOptions = {
    refetchInterval,
    refetchOnWindowFocus: false,
  };

  const { data: schedule } = useSchedule(scheduleId);
  const { data: slots = [] } = useTimeSlots(scheduleId, refreshOptions);
  const { data: assignments = [] } = useAssignments(scheduleId, refreshOptions);
  const { data: positions = [] } = useSlotPositions(scheduleId, refreshOptions);
  const { data: members = [] } = useMembers();
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const hasSearch = normalizedSearch.length > 0;
  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  const isWeekly = !!(schedule as any)?.is_weekly;

  // Build the days list. For weekly schedules, expand Mon–Fri across every
  // week between start_date and end_date so each occurrence shows its real date.
  type DayCol = { key: string; label: string; date: string; weekdayLabel: string };
  const days = useMemo<DayCol[]>(() => {
    if (isWeekly && schedule?.start_date && schedule?.end_date) {
      const out: DayCol[] = [];
      const start = parseLocalDate(schedule.start_date);
      const end = parseLocalDate(schedule.end_date);
      const cur = new Date(start);
      while (cur <= end) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) {
          const iso = toIso(cur);
          out.push({
            key: iso,
            label: fmtDateLabel(cur),
            date: iso,
            weekdayLabel: DAY_NAMES[dow],
          });
        }
        cur.setDate(cur.getDate() + 1);
      }
      return out;
    }
    // Non-weekly: unique day_label as before
    const seen = new Set<string>();
    const out: DayCol[] = [];
    for (const s of slots) {
      if (seen.has(s.day_label)) continue;
      seen.add(s.day_label);
      out.push({
        key: s.day_label,
        label: s.day_label,
        date: s.slot_date || "",
        weekdayLabel: s.day_label,
      });
    }
    return out;
  }, [isWeekly, schedule?.start_date, schedule?.end_date, slots]);

  const positionColors: Record<string, string> = {
    SLT: "bg-tag-slt-bg text-tag-slt",
    EXCO: "bg-tag-exco-bg text-tag-exco",
    Junior: "bg-tag-members-bg text-tag-members",
  };

  // Slots that belong to a given column.
  // Weekly: match by weekday name in slot.day_label.
  // Non-weekly: match by exact day_label.
  const slotsForDay = (day: DayCol) => {
    if (isWeekly) return slots.filter((s) => s.day_label === day.weekdayLabel);
    return slots.filter((s) => s.day_label === day.label);
  };

  const slotHasAssignment = (slotId: string) =>
    assignments.some((a) => a.slot_id === slotId);

  const todayIso = toIso(new Date());
  const visibleDays = days.filter((day) => {
    if (day.date && day.date < todayIso) return false;
    if (dateRange && day.date) {
      if (day.date < dateRange.start || day.date > dateRange.end) return false;
    }
    const daySlots = slotsForDay(day);
    if (!hasSearch) {
      return daySlots.some((s) => slotHasAssignment(s.id));
    }
    return daySlots.some((slot) =>
      assignments.some((assignment) => {
        if (assignment.slot_id !== slot.id) return false;
        const member = memberMap.get(assignment.member_id);
        return member ? (member.name.toLowerCase().includes(normalizedSearch) || (member.display_name||'').toLowerCase().includes(normalizedSearch)) : false;
      }),
    );
  });

  return (
    <div className="overflow-x-auto mt-4">
      {visibleDays.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          {hasSearch ? "No matching member found in this schedule" : "No assigned slots yet"}
        </p>
      ) : (
        <div className="flex gap-4 min-w-max">
          {visibleDays.map((day) => {
            const daySlots = slotsForDay(day).filter((slot) => {
              if (!hasSearch) return slotHasAssignment(slot.id);
              return assignments.some((assignment) => {
                if (assignment.slot_id !== slot.id) return false;
                const member = memberMap.get(assignment.member_id);
                return member ? (member.name.toLowerCase().includes(normalizedSearch) || (member.display_name||'').toLowerCase().includes(normalizedSearch)) : false;
              });
            });

            return (
              <div key={day.key} className="min-w-[220px]">
                <div className="p-3 rounded-t-lg text-center font-semibold text-sm mb-1 intima-gradient text-primary-foreground">
                  <div>{day.label}</div>
                  {day.date && day.label !== day.date && (
                    <div className="text-xs opacity-80">{day.date}</div>
                  )}
                </div>
                <div className="space-y-1">
                  {daySlots.map((slot) => {
                    const slotAssignments = assignments.filter((a) => a.slot_id === slot.id);
                    const visibleAssignments = hasSearch
                      ? slotAssignments.filter((assignment) => {
                          const member = memberMap.get(assignment.member_id);
                          return member ? (member.name.toLowerCase().includes(normalizedSearch) || (member.display_name||'').toLowerCase().includes(normalizedSearch)) : false;
                        })
                      : slotAssignments;

                    const slotPositionsList = positions.filter((position) => position.slot_id === slot.id);
                    const visiblePositions = slotPositionsList
                      .map((position) => ({
                        ...position,
                        assignments: visibleAssignments.filter((assignment) => assignment.position_id === position.id),
                      }))
                      .filter((position) => !hasSearch || position.assignments.length > 0);

                    const unpositionedAssignments = visibleAssignments.filter(
                      (assignment) => !assignment.position_id || !slotPositionsList.some((position) => position.id === assignment.position_id),
                    );

                    return (
                      <div
                        key={`${day.key}-${slot.id}`}
                        className={`p-2 rounded-md border text-xs ${
                          slot.is_blocked
                            ? "bg-blocked/40 border-blocked text-muted-foreground"
                            : "bg-card border-border"
                        }`}
                      >
                        <div className="font-medium mb-1">
                          {slot.time_start} - {slot.time_end}
                        </div>
                        {(slot as any).note && (
                          <div className="text-foreground/80 mb-1 font-medium">{(slot as any).note}</div>
                        )}
                        {slot.duty && (
                          <div className="text-muted-foreground mb-1 italic">{slot.duty}</div>
                        )}
                        {slot.is_blocked ? (
                          <div className="text-center py-1 opacity-50">BLOCKED</div>
                        ) : (
                          <div className="space-y-1">
                            {(() => {
                              // Build groups using same logic as editor; filter by search if active
                              const searchedAssignments = hasSearch ? visibleAssignments : slotAssignments;
                              const groups = buildPositionGroups(
                                visiblePositions as any,
                                searchedAssignments,
                                memberMap,
                              );
                              return groups.map((g, gi) => {
                                // Ungrouped → render each position individually
                                if (!g.label) {
                                  return g.positions.map(({ position, members: ms }) => {
                                    const programmes = (position as any).programmes as string | null | undefined;
                                    return (
                                      <div key={position.id} className="rounded border border-border/70 bg-muted/30 p-1">
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                          {position.position_name}
                                        </div>
                                        {programmes && (
                                          <div className="mb-1 text-[10px] text-muted-foreground whitespace-pre-wrap italic">{programmes}</div>
                                        )}
                                        <div className="space-y-0.5">
                                          {ms.length === 0 ? (
                                            <div className="text-muted-foreground/50 text-center py-1">—</div>
                                          ) : ms.map(member => (
                                            <div key={member.id} className={`rounded px-1.5 py-0.5 ${positionColors[member.position] || ""}`}>
                                              {displayName(member)}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  });
                                }

                                // Grouped → one card per group; merged member name displayed once when all same
                                return (
                                  <div key={`g-${gi}`} className="rounded border border-primary/40 bg-primary/5 overflow-hidden">
                                    <div className="flex items-center justify-between gap-2 px-2 py-1 bg-primary/10 border-b border-primary/20">
                                      <span className="text-[10px] font-bold uppercase tracking-wide text-primary">{g.label}</span>
                                      {g.previousClassroom && (
                                        <span className="text-[9px] text-muted-foreground italic">Previous: {g.previousClassroom}</span>
                                      )}
                                    </div>
                                    {g.mergedMemberIds && g.mergedMemberIds.length > 0 ? (
                                      // Merged: courses on left, single member chip on right
                                      <div className="flex items-stretch">
                                        <div className="flex-1 divide-y divide-border/30">
                                          {g.positions.map(({ position }) => {
                                            const programmes = (position as any).programmes as string | null | undefined;
                                            return (
                                              <div key={position.id} className="px-2 py-1">
                                                <div className="text-[10px] font-semibold">{position.position_name}</div>
                                                {programmes && <div className="text-[9px] text-muted-foreground italic">{programmes}</div>}
                                              </div>
                                            );
                                          })}
                                        </div>
                                        <div className="flex flex-col justify-center items-center border-l border-primary/30 bg-primary/10 px-2 min-w-[80px]">
                                          {g.mergedMemberIds.map(mid => {
                                            const m = memberMap.get(mid);
                                            return m ? (
                                              <div key={mid} className={`rounded px-1.5 py-0.5 text-center ${positionColors[m.position] || ""}`}>
                                                {displayName(m)}
                                              </div>
                                            ) : null;
                                          })}
                                        </div>
                                      </div>
                                    ) : (
                                      // Not merged: per-row member list
                                      <div className="divide-y divide-border/30">
                                        {g.positions.map(({ position, members: ms }) => {
                                          const programmes = (position as any).programmes as string | null | undefined;
                                          return (
                                            <div key={position.id} className="flex items-start gap-2 px-2 py-1">
                                              <div className="flex-1 min-w-0">
                                                <div className="text-[10px] font-semibold">{position.position_name}</div>
                                                {programmes && <div className="text-[9px] text-muted-foreground italic">{programmes}</div>}
                                              </div>
                                              <div className="shrink-0 text-right">
                                                {ms.length === 0 ? (
                                                  <span className="text-muted-foreground/50">—</span>
                                                ) : ms.map(member => (
                                                  <div key={member.id} className={`rounded px-1.5 py-0.5 inline-block ml-1 ${positionColors[member.position] || ""}`}>
                                                    {displayName(member)}
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              });
                            })()}

                            {(slotPositionsList.length === 0 || unpositionedAssignments.length > 0) && (
                              <div className="rounded border border-border/70 bg-muted/20 p-1">
                                {slotPositionsList.length > 0 && (
                                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    General
                                  </div>
                                )}
                                <div className="space-y-0.5">
                                  {unpositionedAssignments.length === 0 ? (
                                    <div className="text-muted-foreground/50 text-center py-1">—</div>
                                  ) : (
                                    unpositionedAssignments.map((assignment) => {
                                      const member = memberMap.get(assignment.member_id);
                                      return member ? (
                                        <div key={assignment.id} className={`rounded px-1.5 py-0.5 ${positionColors[member.position] || ""}`}>
                                          {displayName(member)}
                                        </div>
                                      ) : null;
                                    })
                                  )}
                                </div>
                              </div>
                            )}

                            {visibleAssignments.length === 0 && slotPositionsList.length > 0 && (
                              <div className="text-muted-foreground/50 text-center py-1">—</div>
                            )}
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
      )}
    </div>
  );
}

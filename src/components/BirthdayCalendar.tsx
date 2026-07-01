import { useMemo } from "react";
import { useMembers } from "@/hooks/useMembers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";
import type { Member } from "@/lib/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseLocal(d: string): { y: number; m: number; day: number } | null {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], day: +m[3] };
}

export default function BirthdayCalendar() {
  const { data: members = [] } = useMembers();
  const today = new Date();

  const byMonthDay = useMemo(() => {
    const map = new Map<string, Member[]>();
    members.forEach((m) => {
      if (!m.birthday) return;
      const p = parseLocal(m.birthday);
      if (!p) return;
      const key = `${p.m}-${p.day}`;
      const arr = map.get(key) || [];
      arr.push(m);
      map.set(key, arr);
    });
    return map;
  }, [members]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" /> Birthday Calendar
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MONTHS.map((monthName, monthIdx) => {
            const month = monthIdx + 1;
            const daysInMonth = new Date(today.getFullYear(), month, 0).getDate();
            const firstDow = new Date(today.getFullYear(), monthIdx, 1).getDay();
            const cells: (number | null)[] = [];
            for (let i = 0; i < firstDow; i++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(d);

            return (
              <div key={monthName} className="border border-border rounded-lg p-3 bg-card">
                <p className="text-sm font-semibold mb-2 text-center">{monthName}</p>
                <div className="grid grid-cols-7 gap-1 text-[10px] text-center text-muted-foreground mb-1">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i}>{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((d, i) => {
                    if (d === null) return <div key={i} className="h-7" />;
                    const list = byMonthDay.get(`${month}-${d}`) || [];
                    const isToday = d === today.getDate() && monthIdx === today.getMonth();
                    const hasBday = list.length > 0;
                    return (
                      <div
                        key={i}
                        className={`h-7 flex items-center justify-center text-[11px] rounded-md ${
                          hasBday
                            ? "bg-primary/10 text-primary font-semibold border border-primary/30"
                            : isToday
                            ? "bg-accent font-semibold"
                            : ""
                        }`}
                        title={hasBday ? list.map((m) => `🎂 ${m.name}`).join("\n") : undefined}
                      >
                        {d}
                      </div>
                    );
                  })}
                </div>
                {(() => {
                  const monthBdays: { day: number; member: Member }[] = [];
                  for (let d = 1; d <= daysInMonth; d++) {
                    (byMonthDay.get(`${month}-${d}`) || []).forEach((m) => monthBdays.push({ day: d, member: m }));
                  }
                  monthBdays.sort((a, b) => a.day - b.day);
                  if (monthBdays.length === 0) return null;
                  return (
                    <div className="mt-2 pt-2 border-t border-border space-y-0.5">
                      {monthBdays.map(({ day, member }) => (
                        <p key={member.id} className="text-[10px] text-muted-foreground truncate">
                          <span className="font-semibold text-foreground">{day}</span> · {member.name}
                        </p>
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

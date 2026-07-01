import { useMemo } from "react";
import { useMembers } from "@/hooks/useMembers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cake } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseLocal(d: string): { y: number; m: number; day: number } | null {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], day: +m[3] };
}

export default function UpcomingBirthdays() {
  const { data: members = [] } = useMembers();
  const { upcoming, rangeLabel } = useMemo(() => {
    const today = new Date();
    const ty = today.getFullYear();
    const tm = today.getMonth();
    const td = today.getDate();
    // End: last day of NEXT month
    const endDate = new Date(ty, tm + 2, 0);
    const startMs = new Date(ty, tm, td).getTime();
    const endMs = endDate.getTime();

    const list = members
      .filter((m) => m.birthday)
      .map((m) => {
        const p = parseLocal(m.birthday!)!;
        // Try this year first; if already passed (before today), try next year
        let next = new Date(ty, p.m - 1, p.day);
        if (next.getTime() < startMs) next = new Date(ty + 1, p.m - 1, p.day);
        const days = Math.round((next.getTime() - startMs) / 86400000);
        return { member: m, p, days, next };
      })
      .filter((x) => x.next.getTime() >= startMs && x.next.getTime() <= endMs)
      .sort((a, b) => a.days - b.days);

    const fmt = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    return { upcoming: list, rangeLabel: `${fmt(today)} – ${fmt(endDate)}` };
  }, [members]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Cake className="h-5 w-5 text-primary" /> Upcoming Birthdays
          <span className="text-xs font-normal text-muted-foreground ml-1">(today → end of next month)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No birthdays in this range.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {upcoming.map(({ member, p, days }) => (
              <div key={member.id} className="flex items-center gap-2 p-2 rounded border border-border bg-card">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                  {p.day}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{member.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {MONTHS[p.m - 1]} {p.day} · {days === 0 ? "Today 🎉" : days === 1 ? "Tomorrow" : `in ${days}d`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

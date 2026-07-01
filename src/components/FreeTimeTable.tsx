import { useMemo, useState } from "react";
import { displayName } from "@/lib/utils";
import { useMembers } from "@/hooks/useMembers";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, ChevronDown, ChevronUp } from "lucide-react";
import type { FreeTimes, Member, MemberPosition } from "@/lib/types";

const DAYS: (keyof FreeTimes)[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const HOURS = Array.from({ length: 10 }, (_, i) => i + 8); // 8am to 5pm (last slot is 5pm-6pm)

type GroupKey = "slt" | "exco" | "junior";

const GROUPS: { key: GroupKey; label: string; positions: MemberPosition[]; tagClass: string; bgClass: string; expandTagClass: string }[] = [
  // SLT only — purple
  {
    key: "slt",
    label: "SLT",
    positions: ["SLT"],
    tagClass: "bg-tag-slt-bg text-tag-slt border-tag-slt/30",
    expandTagClass: "bg-tag-slt-bg text-tag-slt border-tag-slt/30",
    bgClass: "bg-tag-slt",
  },
  // EXCO only — red
  {
    key: "exco",
    label: "EXCO",
    positions: ["EXCO"],
    tagClass: "bg-tag-exco-bg text-tag-exco border-tag-exco/30",
    expandTagClass: "bg-tag-exco-bg text-tag-exco border-tag-exco/30",
    bgClass: "bg-tag-exco",
  },
  // Junior — blue
  {
    key: "junior",
    label: "Junior",
    positions: ["Junior"],
    tagClass: "bg-tag-members-bg text-tag-members border-tag-members/30",
    expandTagClass: "bg-tag-members-bg text-tag-members border-tag-members/30",
    bgClass: "bg-tag-members",
  },
];

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

function isFreeAt(member: Member, day: keyof FreeTimes, hourStart: number): boolean {
  const ft = member.free_times as FreeTimes;
  if (!ft) return false;
  const dayFree = ft[day];
  if (!dayFree || dayFree.length === 0) return false;

  const slotStart = hourStart * 60;
  const slotEnd = (hourStart + 1) * 60;

  for (const range of dayFree) {
    const [a, b] = range.split("-").map((s) => s.trim());
    const fs = parseToMin(a);
    const fe = parseToMin(b);
    if (fs >= 0 && fe >= 0 && fs <= slotStart && fe >= slotEnd) return true;
  }
  return false;
}

function formatHour(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display}${suffix}`;
}

export default function FreeTimeTable() {
  const { data: members = [] } = useMembers();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  const filteredMembers = useMemo(() => {
    return members.filter((m) =>
      search ? (m.name.toLowerCase().includes(search.toLowerCase()) || (m.display_name||'').toLowerCase().includes(search.toLowerCase())) : true,
    );
  }, [members, search]);

  // For the EXPANDED full-name view, show each position in its own tag color
  // SLT members → purple, EXCO members → red, Junior members → blue
  const positionTagClass = (pos: MemberPosition): string => {
    if (pos === "SLT") return "bg-tag-slt-bg text-tag-slt border-tag-slt/30";
    if (pos === "EXCO") return "bg-tag-exco-bg text-tag-exco border-tag-exco/30";
    return "bg-tag-members-bg text-tag-members border-tag-members/30";
  };

  // Per group: per day per hour → { available: [{name,position}], busy: [{name,position}] }
  type Person = { name: string; position: MemberPosition };
  type Cell = { available: Person[]; busy: Person[] };
  type GroupGrid = Record<GroupKey, Record<string, Record<number, Cell>>>;

  const grid = useMemo<GroupGrid>(() => {
    const result = {} as GroupGrid;
    for (const grp of GROUPS) {
      const grpMembers = filteredMembers.filter((m) => grp.positions.includes(m.position));
      const dayMap: Record<string, Record<number, Cell>> = {};
      for (const day of DAYS) {
        dayMap[day] = {};
        for (const hour of HOURS) {
          const available: Person[] = [];
          const busy: Person[] = [];
          for (const m of grpMembers) {
            const p: Person = { name: displayName(m), position: m.position };
            if (isFreeAt(m, day, hour)) available.push(p);
            else busy.push(p);
          }
          dayMap[day][hour] = { available, busy };
        }
      }
      result[grp.key] = dayMap;
    }
    return result;
  }, [filteredMembers]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold">Member Free Time Availability</h3>
          <p className="text-sm text-muted-foreground">8AM – 6PM, Monday to Friday</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded((e) => !e)}
          className="gap-1"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Collapse
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Expand full names
            </>
          )}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {/* Legend */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {GROUPS.map((g) => (
            <span
              key={g.key}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${g.tagClass}`}
            >
              <span className={`h-2 w-2 rounded-full ${g.bgClass}`} />
              {g.label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="border border-border px-2 py-2 text-left font-medium text-muted-foreground w-24">
                Time
              </th>
              {DAYS.map((day) => (
                <th
                  key={day}
                  className="border border-border px-2 py-2 text-center font-medium text-muted-foreground"
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => (
              <tr key={hour} className="hover:bg-muted/20">
                <td className="border border-border px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">
                  {formatHour(hour)} – {formatHour(hour + 1)}
                </td>
                {DAYS.map((day) => {
                  const cells = GROUPS.map((g) => ({ grp: g, cell: grid[g.key][day][hour] }));
                  // If every group has zero available members → fully busy → grey background
                  const totalAvailable = cells.reduce((acc, c) => acc + c.cell.available.length, 0);
                  const totalMembers = cells.reduce(
                    (acc, c) => acc + c.cell.available.length + c.cell.busy.length,
                    0,
                  );
                  const fullyBusy = totalMembers > 0 && totalAvailable === 0;

                  return (
                    <td
                      key={day}
                      className={`border border-border px-2 py-1.5 align-top ${
                        fullyBusy ? "bg-tag-busy-bg" : "bg-card"
                      }`}
                    >
                      {expanded ? (
                        // Expanded: show full name pills colored by EACH MEMBER's actual position
                        // (SLT=purple, EXCO=red, Junior=blue) regardless of which group column.
                        // Note: EXCO group includes SLT in filter, so SLT names will appear
                        // both under SLT and EXCO sections — but always with their own color.
                        <div className="space-y-1">
                          {cells.map(({ grp, cell }) =>
                            cell.available.length > 0 ? (
                              <div key={grp.key} className="flex flex-wrap gap-0.5">
                                {cell.available.map((p) => (
                                  <span
                                    key={`${grp.key}-${p.name}`}
                                    className={`inline-block rounded border px-1 py-0.5 text-[10px] ${positionTagClass(p.position)}`}
                                  >
                                    {p.name}
                                  </span>
                                ))}
                              </div>
                            ) : null,
                          )}
                          {totalAvailable === 0 && (
                            <span className="text-muted-foreground/50 text-[10px]">— busy —</span>
                          )}
                        </div>
                      ) : (
                        // Default: 3 colored count tags with hover popover
                        <div className="flex flex-wrap gap-1">
                          {cells.map(({ grp, cell }) => (
                            <Popover key={grp.key}>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-opacity ${grp.tagClass} ${
                                    cell.available.length === 0 ? "opacity-40" : ""
                                  }`}
                                >
                                  {grp.label} {cell.available.length}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-64 text-xs p-3" side="top">
                                <div className="space-y-2">
                                  <div>
                                    <p className={`font-semibold mb-1 ${grp.tagClass.split(" ").find((c) => c.startsWith("text-"))}`}>
                                      {grp.label} — Available ({cell.available.length})
                                    </p>
                                    {cell.available.length > 0 ? (
                                      <ul className="text-foreground space-y-0.5">
                                        {cell.available.map((p) => (
                                          <li key={p.name}>{p.name}</li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="text-foreground">—</p>
                                    )}
                                  </div>
                                  <div>
                                    <p className="font-semibold mb-1 text-muted-foreground">
                                      Busy ({cell.busy.length})
                                    </p>
                                    {cell.busy.length > 0 ? (
                                      <ul className="text-muted-foreground space-y-0.5">
                                        {cell.busy.map((p) => (
                                          <li key={p.name}>{p.name}</li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="text-muted-foreground">—</p>
                                    )}
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filteredMembers.length} member{filteredMembers.length !== 1 ? "s" : ""}. Hover a
        tag to see who's available or busy. Grey cells = nobody available.
      </p>
    </div>
  );
}

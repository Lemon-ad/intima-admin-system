import { useEffect, useMemo, useState } from "react";
import { displayName } from "@/lib/utils";
import { useAllAssignmentsWithSlots, useSchedules } from "@/hooks/useSchedules";
import { useMembers } from "@/hooks/useMembers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import PublicScheduleView from "@/components/PublicScheduleView";
import BirthdayCalendar from "@/components/BirthdayCalendar";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";
import MergedScheduleView from "@/components/MergedScheduleView";
import CalendarScheduleView from "@/components/CalendarScheduleView";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import intimaLogo from "@/assets/intima-logo.png";
import ThemeToggle from "@/components/ThemeToggle";
import type { Schedule } from "@/lib/types";
import { setManifestForRoute } from "@/lib/pwaInstall";

interface PublicScheduleBrowserProps {
  scheduleType: "all" | "exco";
  label: string;
}

// Sort schedules: upcoming/active first (closest to today first), then past last
function sortByUpcoming(schedules: Schedule[]): Schedule[] {
  const today = new Date().toISOString().split("T")[0];
  return [...schedules].sort((a, b) => {
    const aEnd = a.end_date || a.start_date || "";
    const bEnd = b.end_date || b.start_date || "";
    const aPast = aEnd && aEnd < today;
    const bPast = bEnd && bEnd < today;
    if (aPast !== bPast) return aPast ? 1 : -1;
    const aStart = a.start_date || a.end_date || "";
    const bStart = b.start_date || b.end_date || "";
    if (!aPast) return aStart.localeCompare(bStart);
    return bStart.localeCompare(aStart);
  });
}

export default function PublicScheduleBrowser({ scheduleType, label }: PublicScheduleBrowserProps) {
  const { data: primarySchedules = [] } = useSchedules(scheduleType, "active", {
    refetchInterval: 5000,
    refetchOnWindowFocus: false,
  });
  const { data: allSchedules = [] } = useSchedules(
    scheduleType === "exco" ? "all" : undefined,
    "active",
    { refetchInterval: 5000, refetchOnWindowFocus: false },
  );
  const { data: members = [] } = useMembers();
  const { data: allAssignments = [] } = useAllAssignmentsWithSlots();
  const [activeTab, setActiveTab] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"merged" | "per-event" | "calendar">("merged");
  const [rangeFilter, setRangeFilter] = useState<"all" | "this-week" | "two-weeks">("all");
  const [showBirthdays, setShowBirthdays] = useState(false);

  useEffect(() => {
    const route = scheduleType === "exco" ? "/exco" : "/member";
    localStorage.setItem("intima:lastPublicRoute", route);
    setManifestForRoute(route);
  }, [scheduleType]);

  // Compute the active date window (Mon-Sun this week, optionally +1 week)
  const filterRange = useMemo(() => {
    if (rangeFilter === "all") return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = today.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMon);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + (rangeFilter === "this-week" ? 6 : 13));
    const toIso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    return { start: toIso(monday), end: toIso(sunday) };
  }, [rangeFilter]);

  const combinedSchedules = useMemo(() => {
    if (scheduleType === "exco") {
      const map = new Map<string, Schedule>();
      for (const s of primarySchedules) map.set(s.id, s);
      for (const s of allSchedules) map.set(s.id, s);
      return Array.from(map.values());
    }
    return primarySchedules;
  }, [primarySchedules, allSchedules, scheduleType]);

  const visibleSchedules = useMemo(() => {
    return sortByUpcoming(combinedSchedules.filter((schedule) => !schedule.is_hidden));
  }, [combinedSchedules]);

  const searchableMembers = useMemo(() => {
    if (scheduleType === "exco") {
      return members.filter((member) => member.position === "SLT" || member.position === "EXCO");
    }
    return members;
  }, [members, scheduleType]);

  const suggestions = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return [];
    return searchableMembers
      .filter((member) => member.name.toLowerCase().includes(normalized) || (member.display_name||'').toLowerCase().includes(normalized))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(normalized) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(normalized) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name);
      })
      .slice(0, 5);
  }, [searchTerm, searchableMembers]);

  const hasSearch = searchTerm.trim().length > 0;
  const normalizedSearch = searchTerm.trim().toLowerCase();

  // When searching in per-event mode, only show schedule tabs whose
  // assignments include the searched member.
  const matchingMemberIds = useMemo(() => {
    if (!hasSearch) return new Set<string>();
    return new Set(
      members
        .filter((m) => m.name.toLowerCase().includes(normalizedSearch) || (m.display_name||'').toLowerCase().includes(normalizedSearch))
        .map((m) => m.id),
    );
  }, [hasSearch, normalizedSearch, members]);

  const filteredScheduleTabs = useMemo(() => {
    if (!hasSearch) return visibleSchedules;
    const ids = new Set<string>();
    for (const a of allAssignments) {
      if (matchingMemberIds.has(a.member_id)) ids.add(a.schedule_id);
    }
    return visibleSchedules.filter((s) => ids.has(s.id));
  }, [hasSearch, visibleSchedules, allAssignments, matchingMemberIds]);

  useEffect(() => {
    const list = hasSearch && viewMode === "per-event" ? filteredScheduleTabs : visibleSchedules;
    if (list.length === 0) {
      setActiveTab("");
      return;
    }
    if (!list.some((schedule) => schedule.id === activeTab)) {
      setActiveTab(list[0].id);
    }
  }, [activeTab, visibleSchedules, filteredScheduleTabs, hasSearch, viewMode]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3">
          <img src={intimaLogo} alt="INTIMA" className="h-8 sm:h-10 shrink-0" />
          <Badge variant="outline" className="text-xs whitespace-nowrap">{label}</Badge>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="mb-4 sm:mb-6 max-w-xl space-y-3">
          <div className="flex items-stretch gap-2">
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search your name"
              className="flex-1"
            />
            {hasSearch && visibleSchedules.length > 0 && (
              <button
                onClick={() => setViewMode(viewMode === "calendar" ? "merged" : "calendar")}
                className={`shrink-0 rounded-md px-3 py-1 text-sm border transition-colors whitespace-nowrap ${
                  viewMode === "calendar"
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border bg-card text-foreground hover:border-primary"
                }`}
              >
                📅 Calendar
              </button>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSearchTerm(displayName(member))}
                  className="rounded-full border border-border bg-card px-3 py-1 text-sm text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {displayName(member)}
                </button>
              ))}
            </div>
          )}

          {(() => {
            const exact = searchableMembers.find(
              (m) => m.name.toLowerCase() === normalizedSearch || (m.display_name||'').toLowerCase() === normalizedSearch,
            );
            const single = !exact && suggestions.length === 1 ? suggestions[0] : null;
            const target = exact || single;
            return target ? (
              <EnableNotificationsButton memberId={target.id} memberName={displayName(target)} />
            ) : null;
          })()}

          {viewMode !== "calendar" && (
            <div className="flex items-center gap-2 flex-wrap">
              {hasSearch && (
                <>
                  <span className="text-sm text-muted-foreground">View:</span>
                  {(["merged", "per-event"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                        viewMode === mode
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border bg-card text-foreground hover:border-primary"
                      }`}
                    >
                      {mode === "merged" ? "Merged" : "Per Event"}
                    </button>
                  ))}
                </>
              )}
              <Select value={rangeFilter} onValueChange={(v) => setRangeFilter(v as typeof rangeFilter)}>
                <SelectTrigger className="w-[180px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">View all duties</SelectItem>
                  <SelectItem value="this-week">This week only</SelectItem>
                  <SelectItem value="two-weeks">This & next week</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {visibleSchedules.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">No schedules available</p>
        ) : hasSearch && viewMode === "merged" ? (
          <MergedScheduleView
            scheduleIds={visibleSchedules.map((s) => s.id)}
            schedules={visibleSchedules}
            searchTerm={searchTerm}
            autoRefreshMs={5000}
            dateRange={filterRange}
          />
        ) : hasSearch && viewMode === "calendar" ? (
          <CalendarScheduleView
            scheduleIds={visibleSchedules.map((s) => s.id)}
            schedules={visibleSchedules}
            searchTerm={searchTerm}
            autoRefreshMs={5000}
          />
        ) : hasSearch && viewMode === "per-event" && filteredScheduleTabs.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            No schedules contain a member matching "{searchTerm}"
          </p>
        ) : (
          (() => {
            const tabs = hasSearch && viewMode === "per-event" ? filteredScheduleTabs : visibleSchedules;
            return (
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-transparent p-0 text-foreground">
                  {tabs.map((schedule) => (
                    <TabsTrigger
                      key={schedule.id}
                      value={schedule.id}
                      className="border border-border bg-card data-[state=active]:border-primary data-[state=active]:text-primary"
                    >
                      {schedule.name}
                      {schedule.schedule_type === "all" && scheduleType === "exco" && (
                        <Badge variant="outline" className="ml-1 text-[10px]">Member</Badge>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {tabs.map((schedule) => (
                  <TabsContent key={schedule.id} value={schedule.id}>
                    <PublicScheduleView
                      scheduleId={schedule.id}
                      searchTerm={searchTerm}
                      autoRefreshMs={5000}
                      dateRange={filterRange}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            );
          })()
        )}

        <div className="mt-8">
          <button
            onClick={() => setShowBirthdays((v) => !v)}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:border-primary hover:text-primary transition-colors"
          >
            🎂 {showBirthdays ? "Hide" : "Show"} Birthday Calendar
          </button>
          {showBirthdays && (
            <div className="mt-4">
              <BirthdayCalendar />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useSchedules,
  useUpdateSchedule,
  useDeleteSchedule,
  useCreateSchedule,
  useTemplates,
  useUpdateTemplate,
  useDeleteTemplate,
} from "@/hooks/useSchedules";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Archive, Trash2, ExternalLink, Eye, EyeOff, FileText, Lock, KeyRound, Repeat, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getCurrentRole,
  hashPin,
  verifyPin,
  isScheduleUnlocked,
  unlockSchedule,
} from "@/lib/adminAuth";
import type { Schedule, Template } from "@/lib/types";

export default function AdminScheduleList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = getCurrentRole();
  const isAdmin = role === "admin";

  const tabParam = searchParams.get("tab");
  const mainTab = tabParam === "exco" || tabParam === "templates" ? tabParam : "all";
  const setMainTab = (v: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", v);
    setSearchParams(next, { replace: true });
  };

  const { data: schedules = [] } = useSchedules();
  const { data: templates = [] } = useTemplates();
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"all" | "exco">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("none");
  const [newPin, setNewPin] = useState("");
  const [newIsWeekly, setNewIsWeekly] = useState(false);

  // Template editing — full editor (name + per-day time slots + positions)
  type TplPos = { name: string; max_members: number; group_label?: string | null; programmes?: string | null };
  const [editTpl, setEditTpl] = useState<Template | null>(null);
  const [editTplName, setEditTplName] = useState("");
  type TplSlot = { time_start: string; time_end: string; duty?: string; note?: string };
  const [editTplDays, setEditTplDays] = useState<{ label: string }[]>([]);
  const [editTplSlotsPerDay, setEditTplSlotsPerDay] = useState<TplSlot[][]>([]);
  const [editTplPositions, setEditTplPositions] = useState<TplPos[]>([]);
  // Per-slot position overrides keyed by `${dayIdx}|${time_start}|${time_end}`
  const [editTplPositionsByKey, setEditTplPositionsByKey] = useState<Record<string, TplPos[]>>({});

  const openEditTemplate = (t: Template) => {
    const cfg = (t.config || {}) as any;
    setEditTpl(t);
    setEditTplName(t.name);
    const days: { label: string }[] = Array.isArray(cfg.days) && cfg.days.length > 0
      ? cfg.days.map((d: any) => ({ label: d.label || "Day" }))
      : [];
    setEditTplDays(days);
    const perDay: TplSlot[][] = Array.isArray(cfg.time_slots_per_day) && cfg.time_slots_per_day.length === days.length
      ? cfg.time_slots_per_day.map((row: any[]) =>
          (row || []).map((s) => ({
            time_start: s.time_start || "",
            time_end: s.time_end || "",
            duty: s.duty || "",
            note: s.note || "",
          })),
        )
      : days.map(() =>
          Array.isArray(cfg.time_slots)
            ? cfg.time_slots.map((s: any) => ({
                time_start: s.time_start || "",
                time_end: s.time_end || "",
                duty: "",
                note: "",
              }))
            : [],
        );
    setEditTplSlotsPerDay(perDay);
    setEditTplPositions(
      Array.isArray(cfg.default_positions)
        ? cfg.default_positions.map((p: any) => ({
            name: p.name || "Member",
            max_members: p.max_members || 1,
            group_label: p.group_label ?? null,
            programmes: p.programmes ?? null,
          }))
        : [],
    );
    // Migrate any legacy keys (`day_label|date|start|end`) to new (`dayIdx|start|end`)
    const rawByKey: Record<string, any[]> = (cfg.positions_by_slot_key && typeof cfg.positions_by_slot_key === "object")
      ? cfg.positions_by_slot_key
      : {};
    const normalized: Record<string, TplPos[]> = {};
    for (const [k, v] of Object.entries(rawByKey)) {
      if (!Array.isArray(v) || v.length === 0) continue;
      const positions = v.map((p: any) => ({
        name: p.name || "Member",
        max_members: p.max_members || 1,
        group_label: p.group_label ?? null,
        programmes: p.programmes ?? null,
      }));
      const parts = k.split("|");
      let newKey = k;
      if (parts.length === 4) {
        // legacy: dayLabel|date|start|end → find dayIdx by label
        const dayIdx = days.findIndex((d) => d.label === parts[0]);
        if (dayIdx >= 0) newKey = `${dayIdx}|${parts[2]}|${parts[3]}`;
      }
      normalized[newKey] = positions;
    }
    setEditTplPositionsByKey(normalized);
  };

  const closeEditTemplate = () => {
    setEditTpl(null);
    setEditTplDays([]);
    setEditTplSlotsPerDay([]);
    setEditTplPositions([]);
    setEditTplPositionsByKey({});
  };

  const saveEditTemplate = async () => {
    if (!editTpl || !editTplName.trim()) return;
    const cfg = (editTpl.config || {}) as any;
    // Build cleaned positions_by_slot_key matching only currently-defined slots
    const cleanedByKey: Record<string, TplPos[]> = {};
    editTplSlotsPerDay.forEach((row, di) => {
      row.forEach((s) => {
        if (!s.time_start || !s.time_end) return;
        const k = `${di}|${s.time_start}|${s.time_end}`;
        const positions = editTplPositionsByKey[k];
        if (positions && positions.length > 0) {
          cleanedByKey[k] = positions.map((p) => ({
            name: p.name,
            max_members: p.max_members,
            group_label: p.group_label || null,
            programmes: p.programmes || null,
          }));
        }
      });
    });
    const newConfig = {
      ...cfg,
      days: editTplDays.map((d) => ({ label: d.label })),
      time_slots_per_day: editTplSlotsPerDay.map((row) =>
        row
          .filter((s) => s.time_start && s.time_end)
          .map((s) => ({
            time_start: s.time_start,
            time_end: s.time_end,
            duty: s.duty || undefined,
            note: s.note || undefined,
          })),
      ),
      default_positions: editTplPositions.map((p) => ({
        name: p.name,
        max_members: p.max_members,
        group_label: p.group_label || null,
        programmes: p.programmes || null,
      })),
      positions_by_slot_key: cleanedByKey,
      // Keep flat time_slots in sync (use first day's slots as the legacy fallback)
      time_slots: (editTplSlotsPerDay[0] || [])
        .filter((s) => s.time_start && s.time_end)
        .map((s) => ({ time_start: s.time_start, time_end: s.time_end })),
    };
    await updateTemplate.mutateAsync({ id: editTpl.id, name: editTplName.trim(), config: newConfig });
    closeEditTemplate();
  };

  // PIN unlock dialog
  const [pinDialog, setPinDialog] = useState<{ schedule: Schedule | null; pin: string }>({
    schedule: null,
    pin: "",
  });

  // Reset PIN dialog (admin)
  const [resetDialog, setResetDialog] = useState<{ schedule: Schedule | null; pin: string }>({
    schedule: null,
    pin: "",
  });

  // Auto-move past schedules to history
  const today = new Date().toISOString().split("T")[0];
  const activeSchedules = schedules.filter((s) => s.status === "active");
  const historySchedules = schedules.filter((s) => s.status === "history");

  const movedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    activeSchedules.forEach((s) => {
      if (s.end_date && s.end_date < today && !movedRef.current.has(s.id)) {
        movedRef.current.add(s.id);
        updateSchedule.mutate({ id: s.id, status: "history" });
      }
    });
  }, [schedules]);

  const allActive = activeSchedules.filter((s) => s.schedule_type === "all");
  const excoActive = activeSchedules.filter((s) => s.schedule_type === "exco");
  const allHistory = historySchedules.filter((s) => s.schedule_type === "all");
  const excoHistory = historySchedules.filter((s) => s.schedule_type === "exco");

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error("Please enter a name");
      return;
    }

    let pin_hash: string | null = null;
    if (!isAdmin) {
      // Public users MUST set a 4-digit PIN
      if (!/^\d{4}$/.test(newPin)) {
        toast.error("Please enter a 4-digit PIN for this schedule");
        return;
      }
      pin_hash = await hashPin(newPin);
    }

    // If a template is selected, derive type & weekly flag from it (override form values).
    let effectiveType: "all" | "exco" = newType;
    let effectiveEnd: string | undefined = endDate || undefined;
    let effectiveIsWeekly = newIsWeekly;
    if (selectedTemplateId !== "none") {
      const tpl = templates.find((t) => t.id === selectedTemplateId);
      const cfg = tpl?.config as any;
      if (cfg?.schedule_type === "all" || cfg?.schedule_type === "exco") {
        effectiveType = cfg.schedule_type;
      }
      if (typeof cfg?.is_weekly === "boolean") {
        effectiveIsWeekly = cfg.is_weekly;
      }
      // End date is auto-computed by the editor from start_date + template day count, so don't pass it.
      effectiveEnd = undefined;
    }

    if (startDate && effectiveEnd && effectiveEnd < startDate) {
      toast.error("End date cannot be earlier than start date");
      return;
    }

    const result = await createSchedule.mutateAsync({
      name: newName,
      schedule_type: effectiveType,
      start_date: startDate || undefined,
      end_date: effectiveEnd,
      template_id: selectedTemplateId !== "none" ? selectedTemplateId : undefined,
      created_by_role: isAdmin ? "admin" : "public",
      pin_hash,
      is_weekly: effectiveIsWeekly,
    });
    if (!isAdmin && result.id) {
      unlockSchedule(result.id);
    }
    setShowNew(false);
    setNewName("");
    setNewPin("");
    setSelectedTemplateId("none");
    setNewIsWeekly(false);
    navigate(`/admin/schedules/${result.id}`);
  };

  const toggleHidden = (id: string, currentHidden: boolean) => {
    if (!isAdmin) {
      toast.error("View-only access");
      return;
    }
    const willUnhide = currentHidden; // currently hidden -> becoming visible
    updateSchedule.mutate({ id, is_hidden: !currentHidden } as any, {
      onSuccess: () => {
        if (willUnhide) {
          supabase.functions
            .invoke("push-send", { body: { unhide_schedule_id: id } })
            .then(({ data, error }) => {
              if (error) {
                toast.error("Schedule shown, but notification failed");
              } else if ((data as any)?.sent > 0) {
                toast.success(`Notified ${(data as any).members} member(s)`);
              }
            });
        }
      },
    });
  };

  const tryOpenSchedule = (s: Schedule) => {
    // Admin: always allowed
    // Public: allowed if owns or already unlocked
    if (isAdmin || isScheduleUnlocked(s.id) || !s.pin_hash) {
      navigate(`/admin/schedules/${s.id}`);
      return;
    }
    setPinDialog({ schedule: s, pin: "" });
  };

  const submitPin = async () => {
    if (!pinDialog.schedule) return;
    const ok = await verifyPin(pinDialog.pin, pinDialog.schedule.pin_hash);
    if (!ok) {
      toast.error("Incorrect PIN");
      return;
    }
    unlockSchedule(pinDialog.schedule.id);
    const id = pinDialog.schedule.id;
    setPinDialog({ schedule: null, pin: "" });
    navigate(`/admin/schedules/${id}`);
  };

  const submitReset = async () => {
    if (!resetDialog.schedule) return;
    if (!/^\d{4}$/.test(resetDialog.pin)) {
      toast.error("PIN must be 4 digits");
      return;
    }
    const newHash = await hashPin(resetDialog.pin);
    await updateSchedule.mutateAsync({ id: resetDialog.schedule.id, pin_hash: newHash } as any);
    toast.success("PIN updated");
    setResetDialog({ schedule: null, pin: "" });
  };

  const ScheduleCard = ({ s }: { s: Schedule }) => {
    const ownByPublic = s.created_by_role === "public" || !!s.pin_hash;
    const canPublicEdit = isAdmin || s.created_by_role === "public";
    return (
      <Card className={`hover:shadow-md transition-shadow ${(s as any).is_hidden ? "opacity-50" : ""}`}>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-semibold break-words">{s.name}</span>
              {(s as any).is_hidden && (
                <Badge variant="outline" className="text-xs text-muted-foreground">Hidden</Badge>
              )}
              {ownByPublic && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Lock className="h-3 w-3" /> PIN
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {s.start_date && `${s.start_date}`} {s.end_date && `→ ${s.end_date}`}
            </p>
          </div>
          <div className="flex gap-1 flex-wrap sm:flex-nowrap shrink-0">
            {isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                title={(s as any).is_hidden ? "Show on public page" : "Hide from public page"}
                onClick={() => toggleHidden(s.id, (s as any).is_hidden)}
              >
                {(s as any).is_hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            )}
            {isAdmin && ownByPublic && (
              <Button
                variant="ghost"
                size="icon"
                title="Reset PIN"
                onClick={() => setResetDialog({ schedule: s, pin: "" })}
              >
                <KeyRound className="h-4 w-4" />
              </Button>
            )}
            {canPublicEdit && (
              <Button variant="ghost" size="icon" title={s.status === "active" ? "Edit" : "View"} onClick={() => tryOpenSchedule(s)}>
                <Edit className="h-4 w-4" />
              </Button>
            )}
            {s.status === "active" && isAdmin && (
              <Button variant="ghost" size="icon" title="Move to history" onClick={() => updateSchedule.mutate({ id: s.id, status: "history" })}>
                <Archive className="h-4 w-4" />
              </Button>
            )}
            {s.status === "history" && isAdmin && (
              <Button variant="ghost" size="icon" title="Move to active" onClick={() => updateSchedule.mutate({ id: s.id, status: "active" })}>
                <Repeat className="h-4 w-4" />
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                title="Delete schedule"
                onClick={() => {
                  if (confirm(`Delete schedule "${s.name}"? This will permanently remove all its time slots and assignments. This cannot be undone.`)) {
                    deleteSchedule.mutate(s.id);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const ScheduleSection = ({ active, history, viewPath, sectionKey }: { active: Schedule[]; history: Schedule[]; viewPath: string; sectionKey: string }) => {
    const subParamKey = `subtab_${sectionKey}`;
    const subTabParam = searchParams.get(subParamKey);
    const subTab = subTabParam === "history" ? "history" : "active";
    const setSubTab = (v: string) => {
      const next = new URLSearchParams(searchParams);
      next.set(subParamKey, v);
      setSearchParams(next, { replace: true });
    };
    return (
      <div>
        <div className="flex justify-end mb-4">
          <Button variant="outline" size="sm" onClick={() => navigate(viewPath)} className="gap-2">
            <ExternalLink className="h-3 w-3" /> View {viewPath}
          </Button>
        </div>
        <Tabs value={subTab} onValueChange={setSubTab}>
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="history">History ({history.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="space-y-3 mt-4">
            {active.length === 0 && <p className="text-muted-foreground text-sm">No active schedules</p>}
            {active.map((s) => <ScheduleCard key={s.id} s={s} />)}
          </TabsContent>
          <TabsContent value="history" className="space-y-3 mt-4">
            {history.length === 0 && <p className="text-muted-foreground text-sm">No history</p>}
            {history.map((s) => <ScheduleCard key={s.id} s={s} />)}
          </TabsContent>
        </Tabs>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
        <h2 className="text-2xl font-bold">Schedules</h2>
        <Dialog open={showNew} onOpenChange={(open) => {
          setShowNew(open);
          if (open) {
            // Default the type to match the currently-viewed tab
            setNewType(mainTab === "exco" ? "exco" : "all");
          }
        }}>
          <DialogTrigger asChild>
            <Button className="intima-gradient text-primary-foreground gap-2">
              <Plus className="h-4 w-4" /> New Schedule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Schedule</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Schedule Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Orientation Week" />
              </div>
              {/* Type — hidden when a template is chosen (template defines the type) */}
              {selectedTemplateId === "none" && (
                <>
                  <div>
                    <Label>Type</Label>
                    <Select value={newType} onValueChange={(v) => setNewType(v as "all" | "exco")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">For All</SelectItem>
                        <SelectItem value="exco">For EXCO Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-start gap-2 rounded-md border border-border p-3">
                    <Checkbox
                      id="weekly-toggle"
                      checked={newIsWeekly}
                      onCheckedChange={(v) => setNewIsWeekly(v === true)}
                      className="mt-0.5"
                    />
                    <div className="space-y-1 leading-none">
                      <Label htmlFor="weekly-toggle" className="flex items-center gap-1 cursor-pointer">
                        <Repeat className="h-3 w-3" /> Weekly schedule
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Edit Mon–Fri once; the same time slots and assignments repeat every week
                        between the start and end dates.
                      </p>
                    </div>
                  </div>
                </>
              )}
              {/* Dates — when a template is chosen, only ask for Start Date (end is auto-calculated) */}
              {selectedTemplateId !== "none" ? (
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  <p className="text-xs text-muted-foreground mt-1">
                    End date will be set automatically from the template length. You can edit it later.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Start Date</Label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>End Date</Label>
                    <Input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                </div>
              )}
              {!isAdmin && (
                <div>
                  <Label className="flex items-center gap-1">
                    <Lock className="h-3 w-3" /> 4-digit PIN
                  </Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="••••"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Required to re-open this schedule. Admins can reset it.
                  </p>
                </div>
              )}
              {/* Template selector — last */}
              {templates.length > 0 && (
                <div>
                  <Label className="flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Use Template (optional)
                  </Label>
                  <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                    <SelectTrigger><SelectValue placeholder="No template" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No template</SelectItem>
                      {templates.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTemplateId !== "none" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Days, time slots, positions and type will be loaded from the template.
                    </p>
                  )}
                </div>
              )}
              <Button onClick={handleCreate} className="w-full intima-gradient text-primary-foreground">
                Create & Edit Schedule
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="all">Members ({allActive.length + allHistory.length})</TabsTrigger>
          <TabsTrigger value="exco">EXCO ({excoActive.length + excoHistory.length})</TabsTrigger>
          <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <ScheduleSection active={allActive} history={allHistory} viewPath="/member" sectionKey="all" />
        </TabsContent>
        <TabsContent value="exco">
          <ScheduleSection active={excoActive} history={excoHistory} viewPath="/exco" sectionKey="exco" />
        </TabsContent>
        <TabsContent value="templates" className="space-y-3">
          {templates.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No templates yet. Save one from the schedule editor to reuse later.
            </p>
          )}
          {templates.map((t) => {
            const cfg = (t.config || {}) as any;
            const dayCount = Array.isArray(cfg.days) ? cfg.days.length : 0;
            const slotCount = Array.isArray(cfg.time_slots_per_day)
              ? cfg.time_slots_per_day.reduce((acc: number, d: unknown[]) => acc + (Array.isArray(d) ? d.length : 0), 0)
              : Array.isArray(cfg.time_slots) ? cfg.time_slots.length : 0;
            return (
              <Card key={t.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{t.name}</span>
                      {cfg.is_weekly && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Repeat className="h-3 w-3" /> Weekly
                        </Badge>
                      )}
                      {cfg.schedule_type && (
                        <Badge variant="secondary" className="text-xs">
                          {cfg.schedule_type === "exco" ? "EXCO Only" : "All"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {dayCount} day{dayCount === 1 ? "" : "s"} · {slotCount} slot{slotCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit template"
                        onClick={() => openEditTemplate(t)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        title="Delete template"
                        onClick={() => {
                          if (confirm(`Delete template "${t.name}"? This cannot be undone.`)) {
                            deleteTemplate.mutate(t.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      {/* Edit Template Dialog (full editor) */}
      <Dialog open={!!editTpl} onOpenChange={(o) => !o && closeEditTemplate()}>
        <DialogContent className="max-w-2xl max-h-[85vh] !grid-rows-[auto_minmax(0,1fr)_auto] !gap-3">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
          </DialogHeader>
          <ScrollArea className="min-h-0 pr-3 max-h-[60vh]">
            <div className="space-y-4">
              <div>
                <Label>Template Name</Label>
                <Input value={editTplName} onChange={(e) => setEditTplName(e.target.value)} autoFocus />
              </div>

              <div>
                <Label className="mb-1 block">Default Positions</Label>
                <div className="space-y-2">
                  {editTplPositions.map((pos, i) => (
                    <div key={i} className="rounded border border-border p-2 space-y-2">
                      <div className="flex gap-2 items-center">
                        <Input
                          value={pos.group_label || ""}
                          onChange={(e) =>
                            setEditTplPositions((p) => p.map((x, j) => (j === i ? { ...x, group_label: e.target.value || null } : x)))
                          }
                          placeholder="Group / Room (optional)"
                          className="w-40"
                        />
                        <Input
                          value={pos.name}
                          onChange={(e) =>
                            setEditTplPositions((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                          }
                          placeholder="Position"
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          min={1}
                          value={pos.max_members}
                          onChange={(e) =>
                            setEditTplPositions((p) =>
                              p.map((x, j) => (j === i ? { ...x, max_members: parseInt(e.target.value) || 1 } : x)),
                            )
                          }
                          className="w-20"
                        />
                        <button
                          onClick={() => setEditTplPositions((p) => p.filter((_, j) => j !== i))}
                          className="text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <Textarea
                        value={pos.programmes || ""}
                        onChange={(e) =>
                          setEditTplPositions((p) => p.map((x, j) => (j === i ? { ...x, programmes: e.target.value || null } : x)))
                        }
                        placeholder="Programmes (one per line, optional)"
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditTplPositions((p) => [...p, { name: "Member", max_members: 1 }])}
                    className="gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add Position
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Time Slots per Day</Label>
                {editTplDays.length === 0 && (
                  <p className="text-xs text-muted-foreground">This template has no days configured.</p>
                )}
                {editTplDays.map((day, di) => (
                  <div key={di} className="rounded border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={day.label}
                        onChange={(e) =>
                          setEditTplDays((p) => p.map((x, j) => (j === di ? { label: e.target.value } : x)))
                        }
                        className="font-semibold"
                      />
                    </div>
                    {(editTplSlotsPerDay[di] || []).map((slot, si) => {
                      const slotKey = `${di}|${slot.time_start}|${slot.time_end}`;
                      const slotPositions = editTplPositionsByKey[slotKey] || [];
                      const updatePositions = (updater: (p: TplPos[]) => TplPos[]) => {
                        setEditTplPositionsByKey((prev) => {
                          const next = { ...prev };
                          const cur = next[slotKey] || [];
                          const updated = updater(cur);
                          if (updated.length === 0) delete next[slotKey];
                          else next[slotKey] = updated;
                          return next;
                        });
                      };
                      return (
                        <div key={si} className="rounded border border-border/60 p-2 space-y-2 bg-muted/20">
                          <div className="flex gap-2 items-center">
                            <Input
                              type="time"
                              value={slot.time_start}
                              onChange={(e) => {
                                const oldKey = `${di}|${slot.time_start}|${slot.time_end}`;
                                const newStart = e.target.value;
                                setEditTplSlotsPerDay((p) =>
                                  p.map((row, rj) =>
                                    rj === di ? row.map((s, sj) => (sj === si ? { ...s, time_start: newStart } : s)) : row,
                                  ),
                                );
                                // Re-key positions to the new slot key
                                setEditTplPositionsByKey((prev) => {
                                  if (!prev[oldKey]) return prev;
                                  const next = { ...prev };
                                  next[`${di}|${newStart}|${slot.time_end}`] = next[oldKey];
                                  delete next[oldKey];
                                  return next;
                                });
                              }}
                              className="w-28"
                            />
                            <span className="text-xs text-muted-foreground">to</span>
                            <Input
                              type="time"
                              value={slot.time_end}
                              onChange={(e) => {
                                const oldKey = `${di}|${slot.time_start}|${slot.time_end}`;
                                const newEnd = e.target.value;
                                setEditTplSlotsPerDay((p) =>
                                  p.map((row, rj) =>
                                    rj === di ? row.map((s, sj) => (sj === si ? { ...s, time_end: newEnd } : s)) : row,
                                  ),
                                );
                                setEditTplPositionsByKey((prev) => {
                                  if (!prev[oldKey]) return prev;
                                  const next = { ...prev };
                                  next[`${di}|${slot.time_start}|${newEnd}`] = next[oldKey];
                                  delete next[oldKey];
                                  return next;
                                });
                              }}
                              className="w-28"
                            />
                            <Input
                              value={slot.note || ""}
                              onChange={(e) =>
                                setEditTplSlotsPerDay((p) =>
                                  p.map((row, rj) =>
                                    rj === di ? row.map((s, sj) => (sj === si ? { ...s, note: e.target.value } : s)) : row,
                                  ),
                                )
                              }
                              placeholder="Slot title (optional)"
                              className="flex-1"
                            />
                            <button
                              onClick={() => {
                                setEditTplSlotsPerDay((p) =>
                                  p.map((row, rj) => (rj === di ? row.filter((_, sj) => sj !== si) : row)),
                                );
                                setEditTplPositionsByKey((prev) => {
                                  if (!prev[slotKey]) return prev;
                                  const next = { ...prev };
                                  delete next[slotKey];
                                  return next;
                                });
                              }}
                              className="text-destructive"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="pl-2 border-l-2 border-border/60 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              Positions for this slot {slotPositions.length === 0 && "(uses default positions)"}
                            </p>
                            {slotPositions.map((pos, pi) => (
                              <div key={pi} className="space-y-1">
                                <div className="flex gap-1 items-center">
                                  <Input
                                    value={pos.group_label || ""}
                                    onChange={(e) =>
                                      updatePositions((arr) => arr.map((x, j) => (j === pi ? { ...x, group_label: e.target.value || null } : x)))
                                    }
                                    placeholder="Group"
                                    className="w-32 h-8 text-xs"
                                  />
                                  <Input
                                    value={pos.name}
                                    onChange={(e) =>
                                      updatePositions((arr) => arr.map((x, j) => (j === pi ? { ...x, name: e.target.value } : x)))
                                    }
                                    placeholder="Position"
                                    className="flex-1 h-8 text-xs"
                                  />
                                  <Input
                                    type="number"
                                    min={1}
                                    value={pos.max_members}
                                    onChange={(e) =>
                                      updatePositions((arr) => arr.map((x, j) => (j === pi ? { ...x, max_members: parseInt(e.target.value) || 1 } : x)))
                                    }
                                    className="w-16 h-8 text-xs"
                                  />
                                  <button
                                    onClick={() => updatePositions((arr) => arr.filter((_, j) => j !== pi))}
                                    className="text-destructive"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                                <Textarea
                                  value={pos.programmes || ""}
                                  onChange={(e) =>
                                    updatePositions((arr) => arr.map((x, j) => (j === pi ? { ...x, programmes: e.target.value || null } : x)))
                                  }
                                  placeholder="Programmes (one per line, optional)"
                                  rows={2}
                                  className="text-xs"
                                />
                              </div>
                            ))}
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 h-7 text-xs"
                              onClick={() =>
                                updatePositions((arr) => [
                                  ...arr,
                                  { name: "Member", max_members: 1, group_label: null, programmes: null },
                                ])
                              }
                            >
                              <Plus className="h-3 w-3" /> Add Position to Slot
                            </Button>
                            {slotPositions.length === 0 && editTplPositions.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 h-7 text-xs"
                                onClick={() =>
                                  updatePositions(() =>
                                    editTplPositions.map((p) => ({
                                      name: p.name,
                                      max_members: p.max_members,
                                      group_label: p.group_label || null,
                                      programmes: p.programmes || null,
                                    })),
                                  )
                                }
                              >
                                Copy from defaults
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() =>
                        setEditTplSlotsPerDay((p) =>
                          p.map((row, rj) =>
                            rj === di
                              ? [...row, { time_start: "09:00", time_end: "10:00", duty: "", note: "" }]
                              : row,
                          ),
                        )
                      }
                    >
                      <Plus className="h-3 w-3" /> Add Time Slot
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
          <Button onClick={saveEditTemplate} className="w-full mt-3">Save Template</Button>
        </DialogContent>
      </Dialog>

      {/* PIN dialog (public users) */}
      <Dialog open={!!pinDialog.schedule} onOpenChange={(o) => !o && setPinDialog({ schedule: null, pin: "" })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> Enter PIN
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            Enter the 4-digit PIN to open <span className="font-semibold">{pinDialog.schedule?.name}</span>.
          </p>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoFocus
            value={pinDialog.pin}
            onChange={(e) =>
              setPinDialog((p) => ({ ...p, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))
            }
            onKeyDown={(e) => e.key === "Enter" && submitPin()}
          />
          <Button onClick={submitPin} className="w-full mt-2">Unlock</Button>
        </DialogContent>
      </Dialog>

      {/* Reset PIN dialog (admin) */}
      <Dialog open={!!resetDialog.schedule} onOpenChange={(o) => !o && setResetDialog({ schedule: null, pin: "" })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Reset PIN
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            Set a new 4-digit PIN for <span className="font-semibold">{resetDialog.schedule?.name}</span>.
          </p>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoFocus
            value={resetDialog.pin}
            onChange={(e) =>
              setResetDialog((p) => ({ ...p, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))
            }
          />
          <Button onClick={submitReset} className="w-full mt-2">Save PIN</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

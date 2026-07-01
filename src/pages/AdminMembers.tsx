import { useState, useRef, useMemo } from "react";
import { useMembers, useCreateMember, useUpdateMember, useDeleteMember, useParseSchedule } from "@/hooks/useMembers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Pencil, Trash2, Loader2, Brain, Upload, FileText, X, Search, Calendar as CalendarIcon, FileSpreadsheet } from "lucide-react";
import type { Member, MemberPosition, FreeTimes } from "@/lib/types";
import { toast } from "sonner";
import { getCurrentRole } from "@/lib/adminAuth";
import { displayName } from "@/lib/utils";
import BulkMemberImport from "@/components/BulkMemberImport";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const HOUR_SLOTS = Array.from({ length: 10 }, (_, i) => i + 8); // 8..17 (each = 1hr block ending +1)

function fmtHour(h: number): string {
  if (h === 12) return "12pm";
  if (h === 24 || h === 0) return "12am";
  return h > 12 ? `${h - 12}pm` : `${h}am`;
}

function busyHoursToFreeTimes(busy: Record<string, Set<number>>): FreeTimes {
  const result: FreeTimes = {};
  for (const day of WEEKDAYS) {
    const busySet = busy[day] || new Set<number>();
    const freeHours = HOUR_SLOTS.filter((h) => !busySet.has(h));
    if (freeHours.length === 0) {
      result[day] = [];
      continue;
    }
    const ranges: string[] = [];
    let start = freeHours[0];
    let prev = freeHours[0];
    for (let i = 1; i < freeHours.length; i++) {
      const cur = freeHours[i];
      if (cur === prev + 1) { prev = cur; continue; }
      ranges.push(`${fmtHour(start)}-${fmtHour(prev + 1)}`);
      start = cur;
      prev = cur;
    }
    ranges.push(`${fmtHour(start)}-${fmtHour(prev + 1)}`);
    result[day] = ranges;
  }
  return result;
}

function MemberForm({
  member,
  onSave,
  onCancel,
  existingCourses,
}: {
  member?: Member;
  onSave: (data: { name: string; display_name: string | null; student_id: string; course: string; position: MemberPosition; schedule_raw?: string; free_times?: FreeTimes; birthday?: string | null }) => void;
  onCancel: () => void;
  existingCourses: string[];
}) {
  const [name, setName] = useState(member?.name || "");
  const [displayNameInput, setDisplayNameInput] = useState(member?.display_name || "");
  const [studentId, setStudentId] = useState(member?.student_id || "");
  const [course, setCourse] = useState(member?.course || "");
  const [birthday, setBirthday] = useState(member?.birthday || "");
  const [showCourseSuggestions, setShowCourseSuggestions] = useState(false);
  const filteredCourses = useMemo(() => {
    if (!course.trim()) return existingCourses;
    return existingCourses.filter((c) => c.toLowerCase().includes(course.toLowerCase()));
  }, [course, existingCourses]);
  const [position, setPosition] = useState<MemberPosition>(member?.position || "Junior");
  const [scheduleFiles, setScheduleFiles] = useState<File[]>([]);
  const [scheduleRaw, setScheduleRaw] = useState(member?.schedule_raw || "");
  const [freeTimes, setFreeTimes] = useState<FreeTimes>(member?.free_times || {});
  const [manualMode, setManualMode] = useState(false);
  const [busyHours, setBusyHours] = useState<Record<string, Set<number>>>(() => {
    const init: Record<string, Set<number>> = {};
    WEEKDAYS.forEach((d) => (init[d] = new Set()));
    return init;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<"add" | "remove">("add");
  const parseSchedule = useParseSchedule();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleBusyCell = (day: string, hour: number, forceMode?: "add" | "remove") => {
    setBusyHours((prev) => {
      const next = { ...prev };
      const set = new Set(next[day]);
      const mode = forceMode ?? (set.has(hour) ? "remove" : "add");
      if (mode === "add") set.add(hour);
      else set.delete(hour);
      next[day] = set;
      return next;
    });
  };

  const handleGetFreeTime = () => {
    const computed = busyHoursToFreeTimes(busyHours);
    setFreeTimes(computed);
    toast.success("Free times computed from your class schedule!");
  };

  const clearManual = () => {
    const cleared: Record<string, Set<number>> = {};
    WEEKDAYS.forEach((d) => (cleared[d] = new Set()));
    setBusyHours(cleared);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]); // strip data:...;base64,
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  };

  const isImageFile = (file: File) => file.type.startsWith("image/");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setScheduleFiles((prev) => [...prev, ...files]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setScheduleFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveAll = () => {
    setScheduleFiles([]);
    setScheduleRaw("");
  };

  const handleParseSchedule = async () => {
    if (scheduleFiles.length === 0 && !scheduleRaw.trim()) {
      toast.error("Please upload schedule file(s) first");
      return;
    }

    let textParts: string[] = [];
    const images: { data: string; mime_type: string }[] = [];

    for (const file of scheduleFiles) {
      if (isImageFile(file)) {
        const base64 = await fileToBase64(file);
        images.push({ data: base64, mime_type: file.type });
      } else {
        // Read as text
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsText(file);
        });
        textParts.push(text);
      }
    }

    const combinedText = textParts.join("\n\n--- Next Schedule ---\n\n");
    if (combinedText) setScheduleRaw(combinedText);

    const result = await parseSchedule.mutateAsync({
      scheduleText: combinedText || undefined,
      images: images.length > 0 ? images : undefined,
    });
    setFreeTimes(result);
    toast.success("Schedule parsed! Free times detected.");
  };

  const [confirmNoFreeTime, setConfirmNoFreeTime] = useState(false);

  const hasFreeTimes = Object.values(freeTimes).some((arr) => Array.isArray(arr) && arr.length > 0);

  const doSave = () => {
    onSave({ name, display_name: displayNameInput.trim() || null, student_id: studentId, course, position, schedule_raw: scheduleRaw, free_times: freeTimes, birthday: birthday || null });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !studentId.trim() || !course.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (!hasFreeTimes) {
      setConfirmNoFreeTime(true);
      return;
    }
    doSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Full Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </div>
        <div>
          <Label>Display Name</Label>
          <Input value={displayNameInput} onChange={(e) => setDisplayNameInput(e.target.value)} placeholder="Shown on schedules & exports (optional)" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Student ID *</Label>
          <Input value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="e.g. INT12345" />
        </div>
        <div>
          <Label>Position *</Label>
          <Select value={position} onValueChange={(v) => setPosition(v as MemberPosition)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SLT">SLT</SelectItem>
              <SelectItem value="EXCO">EXCO</SelectItem>
              <SelectItem value="Junior">Junior</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="relative">
          <Label>Course *</Label>
          <Input
            value={course}
            onChange={(e) => { setCourse(e.target.value); setShowCourseSuggestions(true); }}
            onFocus={() => setShowCourseSuggestions(true)}
            onBlur={() => setTimeout(() => setShowCourseSuggestions(false), 150)}
            placeholder="e.g. Computer Science"
          />
          {showCourseSuggestions && filteredCourses.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-32 overflow-y-auto">
              {filteredCourses.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setCourse(c); setShowCourseSuggestions(false); }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <Label>Birthday (optional)</Label>
          <Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Schedule (upload file)</Label>
        <div className="mt-1 space-y-2">
          {scheduleFiles.length > 0 && (
            <div className="space-y-1">
              {scheduleFiles.map((file, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-accent/20">
                  {isImageFile(file) ? (
                    <img src={URL.createObjectURL(file)} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                  ) : (
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                  )}
                  <span className="text-sm truncate flex-1">{file.name}</span>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveFile(i)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Plus className="h-3 w-3 mr-1" /> Add more
                </Button>
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={handleRemoveAll}>
                  Remove all
                </Button>
              </div>
            </div>
          )}
          {scheduleFiles.length === 0 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/20 transition-colors cursor-pointer"
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Click to browse schedule files</span>
              <span className="text-xs text-muted-foreground">(Images, PDF, TXT, CSV — multiple allowed)</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xlsx,.xls"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleParseSchedule}
            disabled={parseSchedule.isPending || (scheduleFiles.length === 0 && !scheduleRaw)}
          >
            {parseSchedule.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
            AI Detect Free Time
          </Button>
          <Button
            type="button"
            variant={manualMode ? "default" : "outline"}
            size="sm"
            className="gap-2"
            onClick={() => setManualMode((m) => !m)}
          >
            <CalendarIcon className="h-3 w-3" />
            {manualMode ? "Hide manual picker" : "Set class times manually"}
          </Button>
        </div>

        {manualMode && (
          <Card className="mt-3 bg-accent/20">
            <CardContent className="p-3 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-medium">Mark your class hours (Mon–Fri, 8am–6pm)</p>
                  <p className="text-xs text-muted-foreground">Click or drag to toggle. Unselected hours = free time.</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={clearManual}>Clear</Button>
                  <Button
                    type="button"
                    size="sm"
                    className="intima-gradient text-primary-foreground"
                    onClick={handleGetFreeTime}
                  >
                    Get Free Time
                  </Button>
                </div>
              </div>
              <div
                className="overflow-x-auto select-none"
                onMouseUp={() => setIsDragging(false)}
                onMouseLeave={() => setIsDragging(false)}
              >
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="border border-border bg-muted/50 px-1 py-1 font-medium text-muted-foreground w-16">Day</th>
                      {HOUR_SLOTS.map((h) => (
                        <th key={h} className="border border-border bg-muted/50 px-1 py-1 font-medium text-muted-foreground text-[10px]">
                          {fmtHour(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {WEEKDAYS.map((day) => (
                      <tr key={day}>
                        <td className="border border-border bg-muted/30 px-1 py-1 font-medium text-[11px]">{day.slice(0, 3)}</td>
                        {HOUR_SLOTS.map((h) => {
                          const isBusy = busyHours[day]?.has(h);
                          return (
                            <td
                              key={h}
                              className={`border border-border h-8 cursor-pointer transition-colors ${
                                isBusy ? "bg-destructive/70 hover:bg-destructive" : "bg-card hover:bg-accent"
                              }`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                const mode = isBusy ? "remove" : "add";
                                setDragMode(mode);
                                setIsDragging(true);
                                toggleBusyCell(day, h, mode);
                              }}
                              onMouseEnter={() => {
                                if (isDragging) toggleBusyCell(day, h, dragMode);
                              }}
                              title={`${day} ${fmtHour(h)}-${fmtHour(h + 1)}`}
                            />
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-border bg-destructive/70" /> Class</span>
                <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-border bg-card" /> Free</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {Object.keys(freeTimes).length > 0 && (
        <Card className="bg-accent/30">
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-2">Detected Free Times (editable):</p>
            {(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const).map((day) => {
              const times = freeTimes[day] || [];
              return (
                <div key={day} className="flex items-start gap-2 mb-2">
                  <span className="text-sm font-medium w-24 pt-1 shrink-0">{day}:</span>
                  <div className="flex-1 space-y-1">
                    {times.map((slot, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input
                          value={slot}
                          className="h-7 text-xs"
                          onChange={(e) => {
                            const updated = { ...freeTimes };
                            updated[day] = [...times];
                            updated[day]![i] = e.target.value;
                            setFreeTimes(updated);
                          }}
                        />
                        <Button
                          type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                          onClick={() => {
                            const updated = { ...freeTimes };
                            updated[day] = times.filter((_, j) => j !== i);
                            setFreeTimes(updated);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button" variant="ghost" size="sm" className="h-6 text-xs"
                      onClick={() => {
                        const updated = { ...freeTimes };
                        updated[day] = [...times, ""];
                        setFreeTimes(updated);
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add slot
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" className="intima-gradient text-primary-foreground">
          {member ? "Update" : "Register"} Member
        </Button>
      </div>

      <AlertDialog open={confirmNoFreeTime} onOpenChange={setConfirmNoFreeTime}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save without free time?</AlertDialogTitle>
            <AlertDialogDescription>
              No free time has been set for this member. They won't be assignable to schedule slots based on availability. Do you want to save anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmNoFreeTime(false); doSave(); }}>
              Yes, save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

export default function AdminMembers() {
  const { data: members = [], isLoading } = useMembers();
  const createMember = useCreateMember();
  const updateMember = useUpdateMember();
  const deleteMember = useDeleteMember();
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const isAdmin = getCurrentRole() === "admin";

  const existingCourses = useMemo(() => {
    const courses = new Set(members.map((m) => m.course).filter(Boolean));
    return Array.from(courses).sort();
  }, [members]);

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (search) {
        const q = search.toLowerCase();
        if (!m.name.toLowerCase().includes(q) && !(m.display_name || "").toLowerCase().includes(q)) return false;
      }
      if (courseFilter !== "all" && m.course !== courseFilter) return false;
      return true;
    });
  }, [members, search, courseFilter]);

  const grouped = {
    SLT: filteredMembers.filter((m) => m.position === "SLT"),
    EXCO: filteredMembers.filter((m) => m.position === "EXCO"),
    Junior: filteredMembers.filter((m) => m.position === "Junior"),
  };

  const handleCreate = async (data: any) => {
    await createMember.mutateAsync(data);
    setShowForm(false);
  };

  const handleUpdate = async (data: any) => {
    if (!editingMember) return;
    await updateMember.mutateAsync({ id: editingMember.id, ...data });
    setEditingMember(null);
  };

  const positionColors: Record<string, string> = {
    SLT: "bg-tag-slt-bg text-tag-slt border-tag-slt/30",
    EXCO: "bg-tag-exco-bg text-tag-exco border-tag-exco/30",
    Junior: "bg-tag-members-bg text-tag-members border-tag-members/30",
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Members</h2>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Dialog open={showBulk} onOpenChange={setShowBulk}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <FileSpreadsheet className="h-4 w-4" /> Bulk Import
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Bulk Import</DialogTitle>
                </DialogHeader>
                <BulkMemberImport onClose={() => setShowBulk(false)} />
              </DialogContent>
            </Dialog>
            <Dialog open={showForm} onOpenChange={setShowForm}>
              <DialogTrigger asChild>
                <Button className="intima-gradient text-primary-foreground gap-2">
                  <Plus className="h-4 w-4" /> Register Member
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Register New Member</DialogTitle>
                </DialogHeader>
                <MemberForm onSave={handleCreate} onCancel={() => setShowForm(false)} existingCourses={existingCourses} />
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Course" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Courses</SelectItem>
            {existingCourses.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingMember} onOpenChange={(open) => !open && setEditingMember(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Member</DialogTitle>
          </DialogHeader>
          {editingMember && (
            <MemberForm
              member={editingMember}
              onSave={handleUpdate}
              onCancel={() => setEditingMember(null)}
              existingCourses={existingCourses}
            />
          )}
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {(["SLT", "EXCO", "Junior"] as const).map((pos) => (
            <div key={pos}>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${positionColors[pos]}`}>{pos}</span>
                <span className="text-muted-foreground text-sm">({grouped[pos].length})</span>
              </h3>
              {grouped[pos].length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">No {pos} members</p>
              ) : (
                <div className="grid gap-2">
                  {grouped[pos].map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-card border border-border hover:shadow-sm transition-shadow"
                    >
                      <div>
                        <span className="font-medium">{m.name}</span>
                        {m.display_name && <span className="text-sm text-muted-foreground ml-2">({m.display_name})</span>}
                        <span className="text-sm text-muted-foreground ml-3">{m.student_id}</span>
                        <span className="text-sm text-muted-foreground ml-3">{m.course}</span>
                        {m.birthday && <span className="text-sm text-muted-foreground ml-3">🎂 {m.birthday}</span>}
                      </div>
                      <div className="flex gap-1">
                        {isAdmin && (
                          <>
                            <Button variant="ghost" size="icon" onClick={() => setEditingMember(m)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete {m.name}?</AlertDialogTitle>
                                  <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteMember.mutate(m.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

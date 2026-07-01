import { useState, useRef, useMemo, useCallback, useEffect, Fragment } from "react";
import { displayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Loader2, Upload, X, Brain, FileText, CheckCircle2, AlertCircle, Calendar as CalendarIcon, ChevronDown, ChevronRight, UserPlus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import type { MemberPosition, FreeTimes, Member } from "@/lib/types";
import { useCreateMember, useUpdateMember, useParseSchedule, useMembers, useDeleteMember } from "@/hooks/useMembers";

const HEADERS = ["Name", "Display Name", "Student ID", "Course", "Position", "Birthday"] as const;
const POSITIONS: MemberPosition[] = ["SLT", "EXCO", "Junior"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const HOURS = Array.from({ length: 10 }, (_, i) => i + 8);

type Row = { name: string; display_name: string; student_id: string; course: string; position: string; birthday: string };

function emptyRows(n: number): Row[] {
  return Array.from({ length: n }, () => ({ name: "", display_name: "", student_id: "", course: "", position: "", birthday: "" }));
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeDate(s: string): string {
  if (!s) return "";
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  // dd/mm/yyyy or dd-mm-yyyy
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [_, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y) > 50 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const d = new Date(t);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return t;
}

function fmtHour(h: number): string {
  if (h === 12) return "12PM";
  if (h === 0 || h === 24) return "12AM";
  return h > 12 ? `${h - 12}PM` : `${h}AM`;
}

function isFreeAt(ft: FreeTimes, day: keyof FreeTimes, hour: number): boolean {
  const ranges = ft[day];
  if (!ranges || ranges.length === 0) return false;
  const slotStart = hour * 60;
  const slotEnd = (hour + 1) * 60;
  for (const range of ranges) {
    const [a, b] = range.split("-").map((s) => s.trim().toLowerCase());
    const parse = (t: string): number => {
      const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
      if (!m) return -1;
      let h = parseInt(m[1]);
      const mi = m[2] ? parseInt(m[2]) : 0;
      const p = m[3];
      if (p === "pm" && h !== 12) h += 12;
      if (p === "am" && h === 12) h = 0;
      if (!p && h >= 1 && h <= 6) h += 12;
      return h * 60 + mi;
    };
    const fs = parse(a);
    const fe = parse(b);
    if (fs >= 0 && fe >= 0 && fs <= slotStart && fe >= slotEnd) return true;
  }
  return false;
}

function freeTimesToBusyHours(ft: FreeTimes): Record<string, Set<number>> {
  const out: Record<string, Set<number>> = {};
  for (const day of WEEKDAYS) {
    const set = new Set<number>();
    for (const h of HOURS) {
      if (!isFreeAt(ft, day, h)) set.add(h);
    }
    out[day] = set;
  }
  return out;
}

function busyHoursToFreeTimes(busy: Record<string, Set<number>>): FreeTimes {
  const result: FreeTimes = {};
  for (const day of WEEKDAYS) {
    const busySet = busy[day] || new Set<number>();
    const freeHours = HOURS.filter((h) => !busySet.has(h));
    if (freeHours.length === 0) { result[day] = []; continue; }
    const ranges: string[] = [];
    let start = freeHours[0];
    let prev = freeHours[0];
    const fmt = (h: number) => h === 12 ? "12pm" : h === 0 || h === 24 ? "12am" : h > 12 ? `${h - 12}pm` : `${h}am`;
    for (let i = 1; i < freeHours.length; i++) {
      const cur = freeHours[i];
      if (cur === prev + 1) { prev = cur; continue; }
      ranges.push(`${fmt(start)}-${fmt(prev + 1)}`);
      start = cur; prev = cur;
    }
    ranges.push(`${fmt(start)}-${fmt(prev + 1)}`);
    result[day] = ranges;
  }
  return result;
}

// ===== Members grid =====
function MembersGrid({ onClose }: { onClose: () => void }) {
  const createMember = useCreateMember();
  const deleteMember = useDeleteMember();
  const [rows, setRows] = useState<Row[]>(() => emptyRows(5));
  const [submitting, setSubmitting] = useState(false);
  const [lastImportedIds, setLastImportedIds] = useState<string[]>([]);
  const [undoing, setUndoing] = useState(false);
  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // Stack of row-snapshots taken right before a paste, used for Ctrl+Z undo.
  const pasteHistoryRef = useRef<Row[][]>([]);

  const undoLastImport = useCallback(async () => {
    if (lastImportedIds.length === 0) {
      toast.info("Nothing to undo");
      return;
    }
    setUndoing(true);
    const ids = [...lastImportedIds];
    let removed = 0;
    for (const mid of ids) {
      try {
        await deleteMember.mutateAsync(mid);
        removed++;
      } catch { /* ignore */ }
    }
    setUndoing(false);
    setLastImportedIds([]);
    toast.success(`Undid import — removed ${removed} member(s)`);
  }, [lastImportedIds, deleteMember]);

  const undoLastPaste = useCallback(() => {
    const prev = pasteHistoryRef.current.pop();
    if (!prev) return false;
    setRows(prev);
    toast.success("Undid paste");
    return true;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        // Prefer undoing the last multi-cell paste (native undo can't reverse it).
        if (pasteHistoryRef.current.length > 0) {
          e.preventDefault();
          undoLastPaste();
          return;
        }
        const tag = (e.target as HTMLElement | null)?.tagName;
        // Allow native undo inside text inputs for single-field edits
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (lastImportedIds.length > 0) {
          e.preventDefault();
          undoLastImport();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lastImportedIds, undoLastImport, undoLastPaste]);



  const focusCell = (r: number, c: number) => {
    const el = cellRefs.current.get(`${r}-${c}`);
    if (el) {
      el.focus();
      el.select?.();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const input = e.currentTarget;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (r > 0) focusCell(r - 1, c);
    } else if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault();
      if (r < rows.length - 1) focusCell(r + 1, c);
    } else if (e.key === "ArrowLeft" && atStart) {
      e.preventDefault();
      if (c > 0) focusCell(r, c - 1);
    } else if (e.key === "ArrowRight" && atEnd) {
      e.preventDefault();
      if (c < 5) focusCell(r, c + 1);
    }
  };

  const setCellRef = (r: number, c: number) => (el: HTMLInputElement | null) => {
    const key = `${r}-${c}`;
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  };

  const updateCell = (rowIdx: number, key: keyof Row, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [key]: value };
      return next;
    });
  };

  const addRows = (n: number) => setRows((prev) => [...prev, ...emptyRows(n)]);
  const deleteRow = (idx: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  // Paste handler — fills cells from spreadsheet/tab-delimited or single column
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
      const text = e.clipboardData.getData("text");
      if (!text) return;
      // Detect tabular: contains tabs or multiple lines
      if (text.includes("\t") || text.includes("\n")) {
        e.preventDefault();
        const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
        const parsed = lines.map((line) => line.split("\t"));
        setRows((prev) => {
          // Snapshot for Ctrl+Z undo (cap stack to 20)
          pasteHistoryRef.current.push(prev);
          if (pasteHistoryRef.current.length > 20) pasteHistoryRef.current.shift();
          const next = [...prev];
          // ensure capacity
          const needed = rowIdx + parsed.length;
          while (next.length < needed) next.push({ name: "", display_name: "", student_id: "", course: "", position: "", birthday: "" });
          parsed.forEach((cells, i) => {
            const r = { ...next[rowIdx + i] };
            cells.forEach((cell, j) => {
              const targetCol = colIdx + j;
              const val = cell.trim();
              if (targetCol === 0) r.name = val;
              else if (targetCol === 1) r.display_name = val;
              else if (targetCol === 2) r.student_id = val;
              else if (targetCol === 3) r.course = val;
              else if (targetCol === 4) {
                const matched = POSITIONS.find((p) => p.toLowerCase() === val.toLowerCase());
                r.position = matched || val;
              }
              else if (targetCol === 5) r.birthday = normalizeDate(val);
            });
            next[rowIdx + i] = r;
          });
          return next;
        });
      }
    },
    [],
  );

  const handleSubmit = async () => {
    const valid = rows.filter((r) => r.name.trim() && r.student_id.trim() && r.course.trim() && r.position);
    const invalid = rows.filter(
      (r) =>
        (r.name.trim() || r.student_id.trim() || r.course.trim() || r.position) &&
        !(r.name.trim() && r.student_id.trim() && r.course.trim() && r.position),
    );
    if (valid.length === 0) {
      toast.error("Add at least one complete row");
      return;
    }
    if (invalid.length > 0) {
      toast.error(`${invalid.length} row(s) are incomplete — fill all 4 fields or clear the row`);
      return;
    }
    for (const r of valid) {
      if (!POSITIONS.includes(r.position as MemberPosition)) {
        toast.error(`Invalid position "${r.position}" — must be SLT, EXCO, or Junior`);
        return;
      }
    }
    setSubmitting(true);
    let success = 0;
    let failed = 0;
    const insertedIds: string[] = [];
    for (const r of valid) {
      try {
        const created = await createMember.mutateAsync({
          name: r.name.trim(),
          display_name: r.display_name.trim() || null,
          student_id: r.student_id.trim(),
          course: r.course.trim(),
          position: r.position as MemberPosition,
          birthday: r.birthday ? normalizeDate(r.birthday) : null,
        });
        if (created && (created as any).id) insertedIds.push((created as any).id);
        success++;
      } catch {
        failed++;
      }
    }
    setSubmitting(false);
    setLastImportedIds(insertedIds);
    if (success > 0) toast.success(`Imported ${success} member(s)${failed > 0 ? `, ${failed} failed` : ""} — press Ctrl+Z to undo`);
    // Keep dialog open if there's an undo opportunity, so the user can press Ctrl+Z
    if (failed === 0 && insertedIds.length === 0) onClose();
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Paste from a spreadsheet (Name → Display Name → Student ID → Course → Position → Birthday). Display Name is optional.
      </p>
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="border border-border px-2 py-2 text-xs font-semibold text-muted-foreground w-10">#</th>
                {HEADERS.map((h) => (
                  <th key={h} className="border border-border px-2 py-2 text-left text-xs font-semibold">
                    {h}
                  </th>
                ))}
                <th className="border border-border px-2 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-muted/30">
                  <td className="border border-border px-2 py-1 text-center text-xs text-muted-foreground bg-muted/30">
                    {rIdx + 1}
                  </td>
                  <td className="border border-border p-0">
                    <input
                      ref={setCellRef(rIdx, 0)}
                      value={row.name}
                      onChange={(e) => updateCell(rIdx, "name", e.target.value)}
                      onPaste={(e) => handlePaste(e, rIdx, 0)}
                      onKeyDown={(e) => handleKeyDown(e, rIdx, 0)}
                      className="w-full px-2 py-1.5 bg-transparent outline-none focus:bg-accent/30 text-sm"
                    />
                  </td>
                  <td className="border border-border p-0">
                    <input
                      ref={setCellRef(rIdx, 1)}
                      value={row.display_name}
                      onChange={(e) => updateCell(rIdx, "display_name", e.target.value)}
                      onPaste={(e) => handlePaste(e, rIdx, 1)}
                      onKeyDown={(e) => handleKeyDown(e, rIdx, 1)}
                      placeholder="(optional)"
                      className="w-full px-2 py-1.5 bg-transparent outline-none focus:bg-accent/30 text-sm placeholder:text-muted-foreground/40"
                    />
                  </td>
                  <td className="border border-border p-0">
                    <input
                      ref={setCellRef(rIdx, 2)}
                      value={row.student_id}
                      onChange={(e) => updateCell(rIdx, "student_id", e.target.value)}
                      onPaste={(e) => handlePaste(e, rIdx, 2)}
                      onKeyDown={(e) => handleKeyDown(e, rIdx, 2)}
                      className="w-full px-2 py-1.5 bg-transparent outline-none focus:bg-accent/30 text-sm"
                    />
                  </td>
                  <td className="border border-border p-0">
                    <input
                      ref={setCellRef(rIdx, 3)}
                      value={row.course}
                      onChange={(e) => updateCell(rIdx, "course", e.target.value)}
                      onPaste={(e) => handlePaste(e, rIdx, 3)}
                      onKeyDown={(e) => handleKeyDown(e, rIdx, 3)}
                      className="w-full px-2 py-1.5 bg-transparent outline-none focus:bg-accent/30 text-sm"
                    />
                  </td>
                  <td className="border border-border p-0">
                    <Select value={row.position} onValueChange={(v) => updateCell(rIdx, "position", v)}>
                      <SelectTrigger className="border-0 h-9 rounded-none focus:ring-0 focus:ring-offset-0">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {POSITIONS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border border-border p-0">
                    <input
                      ref={setCellRef(rIdx, 5)}
                      type="date"
                      value={row.birthday}
                      onChange={(e) => updateCell(rIdx, "birthday", e.target.value)}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (text && !text.includes("\t") && !text.includes("\n")) {
                          e.preventDefault();
                          updateCell(rIdx, "birthday", normalizeDate(text));
                        } else {
                          handlePaste(e, rIdx, 5);
                        }
                      }}
                      onKeyDown={(e) => handleKeyDown(e, rIdx, 5)}
                      className="w-full px-2 py-1.5 bg-transparent outline-none focus:bg-accent/30 text-sm"
                    />
                  </td>
                  <td className="border border-border p-1 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => deleteRow(rIdx)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => addRows(1)}>
            <Plus className="h-3 w-3 mr-1" /> Add 1 row
          </Button>
          <Button variant="outline" size="sm" onClick={() => addRows(5)}>
            <Plus className="h-3 w-3 mr-1" /> Add 5 rows
          </Button>
          <Button variant="outline" size="sm" onClick={() => addRows(10)}>
            <Plus className="h-3 w-3 mr-1" /> Add 10 rows
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {lastImportedIds.length > 0 && (
            <Button variant="outline" onClick={undoLastImport} disabled={undoing}>
              {undoing && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              Undo last import ({lastImportedIds.length}) — Ctrl+Z
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            className="intima-gradient text-primary-foreground"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            Import Members
          </Button>
        </div>
      </div>
    </div>
  );
}

// ===== Schedules import =====
type FileEntry = {
  file: File | null;
  matchedMemberId: string | null;
  freeTimes: FreeTimes | null;
  status: "pending" | "parsing" | "done" | "error";
  error?: string;
  manual?: boolean;
  busyHours?: Record<string, Set<number>>;
};

function SchedulesImport({ onClose }: { onClose: () => void }) {
  const { data: members = [] } = useMembers();
  const updateMember = useUpdateMember();
  const parseSchedule = useParseSchedule();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dragMode, setDragMode] = useState<"add" | "remove">("add");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleExpanded = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const memberByNorm = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) { map.set(normalizeName(m.name), m); if (m.display_name) map.set(normalizeName(m.display_name), m); }
    return map;
  }, [members]);

  const matchFile = useCallback(
    (file: File): string | null => {
      const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[_\-\s]*schedule.*/i, "");
      const norm = normalizeName(baseName);
      // exact match
      if (memberByNorm.has(norm)) return memberByNorm.get(norm)!.id;
      // partial match: file contains member name, or member name contains file
      for (const [memberNorm, m] of memberByNorm.entries()) {
        if (memberNorm.length >= 4 && (norm.includes(memberNorm) || memberNorm.includes(norm))) {
          return m.id;
        }
      }
      return null;
    },
    [memberByNorm],
  );

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const newEntries: FileEntry[] = arr.map((f) => ({
      file: f,
      matchedMemberId: matchFile(f),
      freeTimes: null,
      status: "pending",
    }));
    setEntries((prev) => [...prev, ...newEntries]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addManualEntry = () => {
    const init: Record<string, Set<number>> = {};
    WEEKDAYS.forEach((d) => (init[d] = new Set()));
    const newIdx = entries.length;
    setEntries((prev) => [
      ...prev,
      { file: null, matchedMemberId: null, freeTimes: null, status: "pending", manual: true, busyHours: init },
    ]);
    setExpanded((prev) => new Set(prev).add(newIdx));
  };

  const updateEntryFreeTimes = (idx: number, ft: FreeTimes) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, freeTimes: ft, status: "done" } : e)));
  };

  const toggleManualCell = (idx: number, day: string, hour: number, mode: "add" | "remove") => {
    setEntries((prev) =>
      prev.map((e, i) => {
        if (i !== idx || !e.busyHours) return e;
        const next = { ...e.busyHours };
        const set = new Set(next[day]);
        if (mode === "add") set.add(hour); else set.delete(hour);
        next[day] = set;
        const ft = busyHoursToFreeTimes(next);
        return { ...e, busyHours: next, freeTimes: ft, status: "done" };
      }),
    );
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(new Error("Failed to read"));
      reader.readAsDataURL(file);
    });

  const handleAiDetect = async () => {
    const targets = entries.filter((e) => e.matchedMemberId && e.file && e.status !== "done");
    if (targets.length === 0) {
      toast.error("No matched files to parse");
      return;
    }
    setParsing(true);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.matchedMemberId || !entry.file || entry.status === "done") continue;
      setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, status: "parsing" } : e)));
      try {
        const isImage = entry.file.type.startsWith("image/");
        const isPdf = entry.file.type === "application/pdf" || /\.pdf$/i.test(entry.file.name);
        let scheduleText: string | undefined;
        const images: { data: string; mime_type: string }[] = [];
        if (isImage || isPdf) {
          const b64 = await fileToBase64(entry.file);
          images.push({ data: b64, mime_type: isPdf ? "application/pdf" : entry.file.type });
        } else {
          scheduleText = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = () => reject(new Error("Failed"));
            reader.readAsText(entry.file as File);
          });
        }
        const ft = await parseSchedule.mutateAsync({ scheduleText, images: images.length ? images : undefined });
        setEntries((prev) =>
          prev.map((e, idx) => (idx === i ? { ...e, freeTimes: ft, status: "done" } : e)),
        );
      } catch (err) {
        setEntries((prev) =>
          prev.map((e, idx) =>
            idx === i ? { ...e, status: "error", error: err instanceof Error ? err.message : "Failed" } : e,
          ),
        );
      }
    }
    setParsing(false);
    toast.success("AI detection complete");
  };

  const handleSave = async () => {
    const toSave = entries.filter((e) => e.matchedMemberId && e.freeTimes);
    if (toSave.length === 0) {
      toast.error("Nothing to save — run AI detect first");
      return;
    }
    setSaving(true);
    let ok = 0;
    for (const e of toSave) {
      try {
        await updateMember.mutateAsync({ id: e.matchedMemberId!, free_times: e.freeTimes! });
        ok++;
      } catch {}
    }
    setSaving(false);
    toast.success(`Saved free times for ${ok} member(s)`);
    if (ok === toSave.length) onClose();
  };

  const matched = entries.filter((e) => e.matchedMemberId);
  const unmatched = entries.filter((e) => !e.matchedMemberId);
  const completed = entries.filter((e) => e.status === "done");

  // Summary grid (attachment 2 style)
  const summaryMembers = useMemo(
    () =>
      completed
        .map((e) => ({
          entryIdx: entries.indexOf(e),
          member: members.find((m) => m.id === e.matchedMemberId),
          freeTimes: e.freeTimes!,
        }))
        .filter((x) => x.member),
    [completed, entries, members],
  );

  const toggleSummaryCell = (entryIdx: number, day: string, hour: number) => {
    setEntries((prev) =>
      prev.map((e, i) => {
        if (i !== entryIdx) return e;
        const currentBusy = e.busyHours ?? freeTimesToBusyHours(e.freeTimes || {});
        const next = { ...currentBusy };
        const set = new Set(next[day]);
        if (set.has(hour)) set.delete(hour); else set.add(hour);
        next[day] = set;
        const ft = busyHoursToFreeTimes(next);
        return { ...e, busyHours: next, freeTimes: ft, status: "done" };
      }),
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Upload schedule files. System matches each file to a member by filename (e.g.{" "}
        <code className="bg-muted px-1 rounded">AdelineTooYiXuen_schedule.png</code>).
      </p>

      {/* Dropzone + Manual */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/20 transition-colors"
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Click to upload schedule files (multiple)</span>
          <span className="text-xs text-muted-foreground">Images, PDF, TXT, CSV</span>
        </button>
        <Button
          type="button"
          variant="outline"
          onClick={addManualEntry}
          className="h-auto sm:w-40 flex flex-col items-center justify-center gap-1 p-4"
        >
          <UserPlus className="h-5 w-5" />
          <span className="text-xs">Manually Add Entry</span>
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xlsx,.xls"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />

      {/* Summary grid */}
      {summaryMembers.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-semibold">Detected Free Time Summary</p>
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-blue-300 dark:bg-blue-500/60 border border-border" />
                  <span>Class time</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-background border border-border" />
                  <span>Free time</span>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto border border-border rounded">
              <table className="text-[10px] border-collapse w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="border border-border px-2 py-1 sticky left-0 bg-muted z-10">Day</th>
                    <th className="border border-border px-2 py-1 sticky left-[60px] bg-muted z-10">Member</th>
                    {HOURS.map((h) => (
                      <th key={h} className="border border-border px-1 py-1 whitespace-nowrap">
                        {fmtHour(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {WEEKDAYS.map((day) => (
                    <Fragment key={day}>
                      {summaryMembers.map(({ entryIdx, member, freeTimes }, i) => (
                        <tr key={`${day}-${member!.id}`}>
                          {i === 0 && (
                            <td
                              rowSpan={summaryMembers.length}
                              className="border border-border px-2 py-1 font-bold text-center bg-muted/50 sticky left-0 z-10"
                            >
                              {day.slice(0, 3).toUpperCase()}
                            </td>
                          )}
                          <td className="border border-border px-2 py-1 whitespace-nowrap sticky left-[60px] bg-card z-10">
                            {displayName(member)}
                          </td>
                          {HOURS.map((h) => {
                            const free = isFreeAt(freeTimes, day, h);
                            return (
                              <td
                                key={h}
                                onClick={() => toggleSummaryCell(entryIdx, day, h)}
                                className={`border border-border h-5 cursor-pointer ${free ? "bg-background hover:bg-accent" : "bg-blue-300 dark:bg-blue-500/60 hover:bg-blue-400"}`}
                                title={`${displayName(member)} ${day} ${fmtHour(h)} — click to toggle`}
                              />
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Matched (expandable, editable) */}
      {matched.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">
            Matched ({matched.length})
          </p>
          <div className="space-y-2 max-h-[420px] overflow-y-auto border border-border rounded p-2"
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
          >
            {matched.map((e) => {
              const realIdx = entries.indexOf(e);
              const member = members.find((m) => m.id === e.matchedMemberId);
              const isOpen = expanded.has(realIdx);
              return (
                <div key={`m-${realIdx}`} className="rounded border border-border bg-accent/10">
                  <div className="flex items-center gap-2 text-sm p-1.5">
                    <button type="button" onClick={() => toggleExpanded(realIdx)} className="shrink-0">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    {e.status === "parsing" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                    ) : e.status === "done" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    ) : e.status === "error" ? (
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    ) : e.manual ? (
                      <CalendarIcon className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                    )}
                    <Select
                      value={e.matchedMemberId || ""}
                      onValueChange={(v) =>
                        setEntries((prev) => prev.map((it, i) => (i === realIdx ? { ...it, matchedMemberId: v } : it)))
                      }
                    >
                      <SelectTrigger className="h-7 w-44 text-xs">
                        <SelectValue placeholder="Member" />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{displayName(m)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {e.file ? e.file.name : "(manual entry)"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setEntries((prev) => prev.filter((_, i) => i !== realIdx))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>

                  {isOpen && (
                    <div className="p-2 border-t border-border space-y-2">
                      {/* Manual class-hours grid */}
                      {e.manual && (
                        <div>
                          <p className="text-xs font-medium mb-1">Mark class hours (Mon–Fri, 8am–6pm). Unselected = free.</p>
                          <div className="overflow-x-auto select-none">
                            <table className="text-[10px] border-collapse">
                              <thead>
                                <tr>
                                  <th className="border border-border bg-muted/50 px-1 py-1 w-10">Day</th>
                                  {HOURS.map((h) => (
                                    <th key={h} className="border border-border bg-muted/50 px-1 py-1">{fmtHour(h)}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {WEEKDAYS.map((day) => (
                                  <tr key={day}>
                                    <td className="border border-border bg-muted/30 px-1 py-1 font-medium">{day.slice(0, 3)}</td>
                                    {HOURS.map((h) => {
                                      const isBusy = e.busyHours?.[day]?.has(h);
                                      return (
                                        <td
                                          key={h}
                                          className={`border border-border h-7 w-9 cursor-pointer ${isBusy ? "bg-destructive/70 hover:bg-destructive" : "bg-card hover:bg-accent"}`}
                                          onMouseDown={(ev) => {
                                            ev.preventDefault();
                                            const mode = isBusy ? "remove" : "add";
                                            setDragMode(mode);
                                            setIsDragging(true);
                                            toggleManualCell(realIdx, day, h, mode);
                                          }}
                                          onMouseEnter={() => { if (isDragging) toggleManualCell(realIdx, day, h, dragMode); }}
                                        />
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Editable free time list */}
                      {e.freeTimes && (
                        <div>
                          <p className="text-xs font-medium mb-1">Detected Free Times (editable):</p>
                          {WEEKDAYS.map((day) => {
                            const times = e.freeTimes![day] || [];
                            return (
                              <div key={day} className="flex items-start gap-2 mb-1">
                                <span className="text-xs font-medium w-20 pt-1 shrink-0">{day}:</span>
                                <div className="flex-1 space-y-1">
                                  {times.map((slot, ti) => (
                                    <div key={ti} className="flex items-center gap-1">
                                      <Input
                                        value={slot}
                                        className="h-7 text-xs"
                                        onChange={(ev) => {
                                          const updated = { ...e.freeTimes! };
                                          updated[day] = [...times];
                                          updated[day]![ti] = ev.target.value;
                                          updateEntryFreeTimes(realIdx, updated);
                                        }}
                                      />
                                      <Button
                                        type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                                        onClick={() => {
                                          const updated = { ...e.freeTimes! };
                                          updated[day] = times.filter((_, j) => j !== ti);
                                          updateEntryFreeTimes(realIdx, updated);
                                        }}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ))}
                                  <Button
                                    type="button" variant="ghost" size="sm" className="h-6 text-xs"
                                    onClick={() => {
                                      const updated = { ...(e.freeTimes || {}) } as FreeTimes;
                                      updated[day] = [...times, ""];
                                      updateEntryFreeTimes(realIdx, updated);
                                    }}
                                  >
                                    <Plus className="h-3 w-3 mr-1" /> Add slot
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Unmatched */}
      {unmatched.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-destructive mb-1">
            Not Detected ({unmatched.length}) — assign a member or remove
          </p>
          <div className="space-y-1 max-h-32 overflow-y-auto border border-destructive/30 rounded p-2">
            {unmatched.map((e) => {
              const realIdx = entries.indexOf(e);
              return (
                <div key={`u-${realIdx}`} className="flex items-center gap-2 text-sm p-1.5">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <span className="text-xs truncate flex-1">{e.file ? e.file.name : "(manual entry)"}</span>
                  <Select
                    value=""
                    onValueChange={(v) =>
                      setEntries((prev) =>
                        prev.map((it, i) => (i === realIdx ? { ...it, matchedMemberId: v } : it)),
                      )
                    }
                  >
                    <SelectTrigger className="h-7 w-40 text-xs">
                      <SelectValue placeholder="Assign member..." />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {displayName(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setEntries((prev) => prev.filter((_, i) => i !== realIdx))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap pt-2">
        <Button
          variant="outline"
          onClick={handleAiDetect}
          disabled={parsing || matched.filter((e) => e.file).length === 0}
          className="gap-2"
        >
          {parsing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
          AI Detect Free Time
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="intima-gradient text-primary-foreground"
            onClick={handleSave}
            disabled={saving || completed.length === 0}
          >
            {saving && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            Save Free Times
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function BulkMemberImport({ onClose }: { onClose: () => void }) {
  return (
    <Tabs defaultValue="members" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="members">Bulk Register Members</TabsTrigger>
        <TabsTrigger value="schedules">Bulk Import Schedules</TabsTrigger>
      </TabsList>
      <TabsContent value="members" className="mt-4">
        <MembersGrid onClose={onClose} />
      </TabsContent>
      <TabsContent value="schedules" className="mt-4">
        <SchedulesImport onClose={onClose} />
      </TabsContent>
    </Tabs>
  );
}

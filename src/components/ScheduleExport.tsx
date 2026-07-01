import React, { useState, useRef, useCallback } from "react";
import { displayName } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { toast } from "sonner";
import type { Schedule, TimeSlot, ScheduleAssignment, SlotPosition, Member } from "@/lib/types";
import { buildPositionGroups } from "@/lib/scheduleMerge";

type ExportFormat = "weekly" | "daily" | "multiday";

interface ScheduleExportProps {
  schedule: Schedule;
  slots: TimeSlot[];
  assignments: ScheduleAssignment[];
  positions: SlotPosition[];
  members: Member[];
}

export default function ScheduleExport({ schedule, slots, assignments, positions, members }: ScheduleExportProps) {
  const [open, setOpen] = useState(false);
  const [fileFormat, setFileFormat] = useState<"pdf" | "png">("pdf");
  const [tableFormat, setTableFormat] = useState<ExportFormat>("multiday");
  const [titleOverride, setTitleOverride] = useState("");
  const [exporting, setExporting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const memberMap = new Map(members.map((m) => [m.id, m]));

  // Build day groups
  const days = (() => {
    const seen = new Map<string, { label: string; date: string }>();
    for (const s of slots) {
      const key = s.slot_date || s.day_label;
      if (!seen.has(key)) seen.set(key, { label: s.day_label, date: s.slot_date || "" });
    }
    return Array.from(seen.values()).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  })();

  // All unique time slot ranges across all days, sorted chronologically by start minute.
  // Robust parser: accepts "8am", "8:30am", "1pm", "13:00", "08:30", etc.
  const parseTimeToMin = (t: string): number => {
    if (!t) return Number.MAX_SAFE_INTEGER;
    const cleaned = t.trim().toLowerCase().replace(/\s+/g, "");
    const m = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
    if (!m) return Number.MAX_SAFE_INTEGER; // unparsable → push to end
    let h = parseInt(m[1], 10);
    const mi = m[2] ? parseInt(m[2], 10) : 0;
    const p = m[3];
    if (p === "pm" && h !== 12) h += 12;
    else if (p === "am" && h === 12) h = 0;
    else if (!p && h >= 1 && h <= 6) h += 12; // bare "1"–"6" assumed PM
    return h * 60 + mi;
  };
  const timeSlotKeys = (() => {
    const set = new Set<string>();
    for (const s of slots) set.add(`${s.time_start}|${s.time_end}`);
    return Array.from(set).sort((a, b) => {
      const [aS, aE] = a.split("|");
      const [bS, bE] = b.split("|");
      const d = parseTimeToMin(aS) - parseTimeToMin(bS);
      if (d !== 0) return d;
      return parseTimeToMin(aE) - parseTimeToMin(bE);
    });
  })();

  const getSlotMembers = (slotId: string) => {
    const slotAssigns = assignments.filter((a) => a.slot_id === slotId);
    return slotAssigns
      .map((a) => {
        const m = memberMap.get(a.member_id);
        const pos = positions.find((p) => p.id === a.position_id);
        return m ? { name: displayName(m), position: pos?.position_name || "" } : null;
      })
      .filter(Boolean) as { name: string; position: string }[];
  };

  const title = titleOverride.trim() || schedule.name;
  const dateRange =
    schedule.start_date || schedule.end_date
      ? `${schedule.start_date || ""}${schedule.end_date ? ` to ${schedule.end_date}` : ""}`
      : "";

  // ---- PDF Export ----
  const exportAsPdf = useCallback(async () => {
    const { default: jsPDF } = await import("jspdf");
    await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape" });
    const pw = doc.internal.pageSize.getWidth();

    if (tableFormat === "weekly") {
      // Format 1: Weekday names as rows (no dates), times as columns
      const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text(title, pw / 2, 16, { align: "center" });
      const head = ["Day", ...timeSlotKeys.map((k) => k.replace("|", " - "))];
      const blockedCells: { row: number; col: number }[] = [];
      const body = WEEKDAYS.map((dayName, rowIdx) => {
        const row: string[] = [dayName];
        timeSlotKeys.forEach((tk, colIdx) => {
          const [ts, te] = tk.split("|");
          // Match by day-of-week derived from date OR the day_label starting with the weekday
          const matchSlots = slots.filter((s) => {
            if (s.time_start !== ts || s.time_end !== te) return false;
            if (s.slot_date) {
              const d = new Date(s.slot_date + "T00:00:00");
              return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()] === dayName;
            }
            return s.day_label.toLowerCase().includes(dayName.slice(0, 3).toLowerCase());
          });
          if (matchSlots.length === 0) {
            blockedCells.push({ row: rowIdx, col: colIdx + 1 });
            row.push("");
          } else {
            const items = Array.from(
              new Set(
                matchSlots.flatMap((slot) =>
                  getSlotMembers(slot.id).map((m) =>
                    m.position ? `${m.name} (${m.position})` : m.name,
                  ),
                ),
              ),
            );
            row.push(items.length > 0 ? items.join("\n") : "—");
          }
        });
        return row;
      });
      (doc as any).autoTable({
        startY: 22,
        head: [head], body,
        styles: { fontSize: 8, cellPadding: 3, lineWidth: 0.4, lineColor: [0, 0, 0], valign: "middle" },
        headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: "bold", halign: "center" },
        columnStyles: { 0: { fontStyle: "bold", fillColor: [245, 245, 245] } },
        theme: "grid",
        didParseCell: (data: any) => {
          if (data.section === "body" && blockedCells.some((b) => b.row === data.row.index && b.col === data.column.index)) {
            data.cell.styles.fillColor = [200, 200, 200];
            data.cell.text = [""];
          }
        },
      });
    } else if (tableFormat === "daily") {
      // Format 2: One table per day
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text(title, pw / 2, 16, { align: "center" });
      let y = 26;
      for (let i = 0; i < days.length; i++) {
        const day = days[i];
        const daySlots = slots
          .filter((s) => s.slot_date === day.date || s.day_label === day.label)
          .sort((a, b) => parseTimeToMin(a.time_start) - parseTimeToMin(b.time_start));
        if (daySlots.length === 0) continue;

        const head = ["Time", "Title / Note", "Group", "Position", "Previous Classroom", "Members"];
        const body: any[][] = [];
        for (const slot of daySlots) {
          const slotPos = positions.filter((p) => p.slot_id === slot.id);
          const slotAssigns = assignments.filter((a) => a.slot_id === slot.id);
          const time = `${slot.time_start} – ${slot.time_end}`;
          const note = (slot as any).note || slot.duty || "";
          if (slotPos.length === 0) {
            const ms = slotAssigns.map((a) => displayName(memberMap.get(a.member_id))).filter(Boolean).join("\n") || "—";
            body.push([time, note, "", "—", "", ms]);
          } else {
            const groups = buildPositionGroups(slotPos, slotAssigns, memberMap);
            for (const g of groups) {
              if (!g.label) {
                for (const { position: pos, members: ms } of g.positions) {
                  const memberCell = ms.map((m) => displayName(m)).join("\n") || "—";
                  const programmes = (pos as any).programmes;
                  const posCell = programmes ? `${pos.position_name}\n${programmes}` : pos.position_name;
                  body.push([time, note, "", posCell, (pos as any).previous_classroom || "", memberCell]);
                }
              } else {
                let mergedMemberCellAdded = false;
                g.positions.forEach(({ position: pos, members: ms }, idx) => {
                  const programmes = (pos as any).programmes;
                  const posCell = programmes ? `${pos.position_name}\n${programmes}` : pos.position_name;
                  const row: any[] = [time, note];
                  if (idx === 0) {
                    row.push({ content: g.label, rowSpan: g.positions.length, styles: { fontStyle: "bold", fillColor: [254, 226, 226], halign: "center", valign: "middle" } });
                  }
                  row.push(posCell);
                  if (idx === 0) {
                    row.push({ content: g.previousClassroom || "", rowSpan: g.positions.length, styles: { halign: "center", valign: "middle" } });
                  }
                  if (g.mergedMemberName) {
                    if (!mergedMemberCellAdded) {
                      row.push({ content: g.mergedMemberName, rowSpan: g.positions.length, styles: { fontStyle: "bold", valign: "middle", halign: "center" } });
                      mergedMemberCellAdded = true;
                    }
                  } else {
                    row.push(ms.map((m) => displayName(m)).join("\n") || "—");
                  }
                  body.push(row);
                });
              }
            }
            const general = slotAssigns
              .filter((a) => !a.position_id || !slotPos.some((p) => p.id === a.position_id))
              .map((a) => displayName(memberMap.get(a.member_id)))
              .filter(Boolean);
            if (general.length > 0) body.push([time, note, "", "General", "", general.join("\n")]);
          }
        }
        if (y > 170) { doc.addPage(); y = 20; }
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(`${day.date || ""} (${day.label})`, 14, y);
        y += 4;
        (doc as any).autoTable({
          startY: y,
          head: [head], body,
          styles: { fontSize: 8, cellPadding: 3, lineWidth: 0.4, lineColor: [0, 0, 0], valign: "middle" },
          headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: "bold", halign: "center" },
          theme: "grid",
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }
    } else {
      // Format 3: Multi-day matrix (dates as rows, slots as columns)
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text(title, pw / 2, 16, { align: "center" });
      if (dateRange) {
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(dateRange, pw / 2, 23, { align: "center" });
      }
      const head = ["Date", ...timeSlotKeys.map((k) => k.replace("|", " - "))];
      const blockedCells: { row: number; col: number }[] = [];
      const body = days.map((day, rowIdx) => {
        const row: string[] = [`${day.label}${day.date ? `\n(${day.date})` : ""}`];
        timeSlotKeys.forEach((tk, colIdx) => {
          const [ts, te] = tk.split("|");
          const slot = slots.find(
            (s) =>
              (s.slot_date === day.date || s.day_label === day.label) &&
              s.time_start === ts &&
              s.time_end === te,
          );
          if (!slot) {
            blockedCells.push({ row: rowIdx, col: colIdx + 1 });
            row.push("");
          } else {
            const slotPos = positions
              .filter((p) => p.slot_id === slot.id)
              .sort((a, b) => a.sort_order - b.sort_order);
            const slotAssigns = assignments.filter((a) => a.slot_id === slot.id);
            const note = (slot as any).note || slot.duty || "";
            const lines: string[] = [];
            if (note) lines.push(`[${note}]`);
            lines.push("Position | Members");
            lines.push("─────────────────");
            let prevGroup: string | null = null;
            for (const pos of slotPos) {
              const grp = (pos as any).group_label || null;
              if (grp && grp !== prevGroup) {
                lines.push(`▸ ${grp}`);
                prevGroup = grp;
              } else if (!grp) {
                prevGroup = null;
              }
              const memberNames = slotAssigns
                .filter((a) => a.position_id === pos.id)
                .map((a) => displayName(memberMap.get(a.member_id)))
                .filter(Boolean)
                .join(", ");
              lines.push(`${pos.position_name} | ${memberNames || "—"}`);
              const programmes = (pos as any).programmes;
              if (programmes) {
                programmes.split("\n").forEach((p: string) => {
                  const t = p.trim();
                  if (t) lines.push(`   · ${t}`);
                });
              }
            }
            const general = slotAssigns
              .filter((a) => !a.position_id || !slotPos.some((p) => p.id === a.position_id))
              .map((a) => displayName(memberMap.get(a.member_id)))
              .filter(Boolean) as string[];
            if (general.length > 0) {
              lines.push(`General | ${general.join(", ")}`);
            }
            row.push(lines.length > 2 ? lines.join("\n") : "—");
          }
        });
        return row;
      });
      (doc as any).autoTable({
        startY: dateRange ? 28 : 22,
        head: [head],
        body,
        styles: { fontSize: 8, cellPadding: 3, lineWidth: 0.4, lineColor: [0, 0, 0], valign: "top" },
        headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: "bold", halign: "center" },
        columnStyles: { 0: { fontStyle: "bold", fillColor: [245, 245, 245] } },
        theme: "grid",
        didParseCell: (data: any) => {
          if (data.section === "body" && blockedCells.some((b) => b.row === data.row.index && b.col === data.column.index)) {
            data.cell.styles.fillColor = [200, 200, 200];
            data.cell.text = [""];
          }
        },
      });
    }

    doc.save(`${title}.pdf`);
  }, [title, dateRange, tableFormat, days, timeSlotKeys, slots, assignments, positions, memberMap]);

  const exportAsPng = useCallback(async () => {
    if (!previewRef.current) return;
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(previewRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
    const link = document.createElement("a");
    link.download = `${title}.png`;
    link.href = dataUrl;
    link.click();
  }, [title]);

  const handleExport = async () => {
    setExporting(true);
    try {
      if (fileFormat === "pdf") await exportAsPdf();
      else await exportAsPng();
      toast.success(`Exported as ${fileFormat.toUpperCase()}`);
      setOpen(false);
    } catch (e: any) {
      toast.error("Export failed: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const formatDescriptions: Record<ExportFormat, string> = {
    weekly:
      "Format 1 — Weekly Duty: Days as rows, time slots as columns. Best when one weekly schedule covers multiple days.",
    daily:
      "Format 2 — Daily Manpower: A single day broken into sections per slot. Best for one-day events with positions.",
    multiday:
      "Format 3 — Multi-Day Schedule: Each date as a row with time slots as columns. Cells include members and positions.",
  };

  // Preview rendering helper — mirrors the PDF layouts
  const renderPreview = () => {
    // ---- Format 1: Weekly Duty (Day rows × time-slot cols, no dates) ----
    if (tableFormat === "weekly") {
      const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
      return (
        <div>
          <h2 className="text-lg font-bold text-center text-foreground">{title}</h2>
          {dateRange && (
            <p className="text-sm text-muted-foreground text-center mb-3">
              (Effective from {dateRange})
            </p>
          )}
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="px-2 py-2 text-left font-bold border border-primary">Day</th>
                {timeSlotKeys.map((tk) => (
                  <th key={tk} className="px-2 py-2 text-center font-bold border border-primary">
                    {tk.replace("|", " - ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((dayName) => (
                <tr key={dayName}>
                  <td className="px-2 py-2 font-bold text-foreground bg-muted border border-border align-top">
                    {dayName}
                  </td>
                  {timeSlotKeys.map((tk) => {
                    const [ts, te] = tk.split("|");
                    const matchSlots = slots.filter((s) => {
                      if (s.time_start !== ts || s.time_end !== te) return false;
                      if (s.slot_date) {
                        const d = new Date(s.slot_date + "T00:00:00");
                        return (
                          ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
                            d.getDay()
                          ] === dayName
                        );
                      }
                      return s.day_label.toLowerCase().includes(dayName.slice(0, 3).toLowerCase());
                    });
                    if (matchSlots.length === 0) {
                      return (
                        <td
                          key={tk}
                          className="px-2 py-2 border border-border bg-muted-foreground/30"
                        />
                      );
                    }
                    const items = Array.from(
                      new Set(
                        matchSlots.flatMap((slot) =>
                          getSlotMembers(slot.id).map((m) =>
                            m.position ? `${m.name} (${m.position})` : m.name,
                          ),
                        ),
                      ),
                    );
                    return (
                      <td
                        key={tk}
                        className="px-2 py-2 border border-border align-top text-foreground"
                      >
                        {items.length === 0 ? (
                          <span className="text-muted-foreground/40">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {items.map((n) => (
                              <li key={n}>{n}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // ---- Format 2: Daily Manpower — one table per day ----
    if (tableFormat === "daily") {
      return (
        <div className="space-y-6">
          <h2 className="text-lg font-bold text-center text-foreground">{title}</h2>
          {days.map((day) => {
            const daySlots = slots
              .filter((s) => s.slot_date === day.date || s.day_label === day.label)
              .sort((a, b) => parseTimeToMin(a.time_start) - parseTimeToMin(b.time_start));
            if (daySlots.length === 0) return null;
            return (
              <div key={day.date || day.label}>
                <h3 className="text-sm font-bold text-foreground mb-2">
                  {day.date ? `${day.date} — ${day.label}` : day.label}
                </h3>
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-primary text-primary-foreground">
                      <th className="px-2 py-2 text-left font-bold border border-primary">Time</th>
                      <th className="px-2 py-2 text-left font-bold border border-primary">
                        Title / Note
                      </th>
                      <th className="px-2 py-2 text-left font-bold border border-primary">
                        Position
                      </th>
                      <th className="px-2 py-2 text-left font-bold border border-primary">
                        Members
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {daySlots.flatMap((slot) => {
                      const slotPos = positions.filter((p) => p.slot_id === slot.id);
                      const slotAssigns = assignments.filter((a) => a.slot_id === slot.id);
                      const time = `${slot.time_start} – ${slot.time_end}`;
                      const note = slot.note || slot.duty || "";
                      const rows: { key: string; kind: "group" | "row"; group?: string; pos?: string; programmes?: string | null; members?: string }[] = [];
                      if (slotPos.length === 0) {
                        const ms = slotAssigns
                          .map((a) => displayName(memberMap.get(a.member_id)))
                          .filter(Boolean)
                          .join("\n") || "—";
                        rows.push({ key: slot.id, kind: "row", pos: "—", members: ms });
                      } else {
                        let prevGroup: string | null = null;
                        for (const pos of slotPos) {
                          const grp = (pos as any).group_label || null;
                          if (grp && grp !== prevGroup) {
                            rows.push({ key: `${slot.id}-g-${grp}`, kind: "group", group: grp });
                          }
                          prevGroup = grp;
                          const ms = slotAssigns
                            .filter((a) => a.position_id === pos.id)
                            .map((a) => displayName(memberMap.get(a.member_id)))
                            .filter(Boolean)
                            .join("\n") || "—";
                          rows.push({
                            key: `${slot.id}-${pos.id}`,
                            kind: "row",
                            pos: pos.position_name,
                            programmes: (pos as any).programmes || null,
                            members: ms,
                          });
                        }
                        const generalNames = slotAssigns
                          .filter((a) => !a.position_id || !slotPos.some((p) => p.id === a.position_id))
                          .map((a) => displayName(memberMap.get(a.member_id)))
                          .filter(Boolean) as string[];
                        if (generalNames.length > 0) {
                          rows.push({ key: `${slot.id}-general`, kind: "row", pos: "General", members: generalNames.join("\n") });
                        }
                      }
                      return rows.map((r, i) => (
                        <tr key={r.key}>
                          {i === 0 && (
                            <>
                              <td
                                rowSpan={rows.length}
                                className="px-2 py-1.5 border border-border align-top font-medium text-foreground"
                              >
                                {time}
                              </td>
                              <td
                                rowSpan={rows.length}
                                className="px-2 py-1.5 border border-border align-top text-foreground"
                              >
                                {note || <span className="text-muted-foreground/40">—</span>}
                              </td>
                            </>
                          )}
                          {r.kind === "group" ? (
                            <td colSpan={2} className="px-2 py-1 border border-border bg-muted font-bold uppercase tracking-wide text-[11px] text-primary">
                              {r.group}
                            </td>
                          ) : (
                            <>
                              <td className="px-2 py-1.5 border border-border align-top text-foreground">
                                {r.pos}
                                {r.programmes && (
                                  <div className="text-[10px] text-muted-foreground italic whitespace-pre-wrap">{r.programmes}</div>
                                )}
                              </td>
                              <td className="px-2 py-1.5 border border-border align-top text-foreground whitespace-pre-line">
                                {r.members}
                              </td>
                            </>
                          )}
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      );
    }

    // ---- Format 3: Multi-Day matrix (date rows × time-slot cols) ----
    return (
      <div>
        <h2 className="text-lg font-bold text-center text-foreground">{title}</h2>
        {dateRange && (
          <p className="text-sm text-muted-foreground text-center mb-3">{dateRange}</p>
        )}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-primary text-primary-foreground">
              <th className="px-2 py-2 text-left font-bold border border-primary">Date</th>
              {timeSlotKeys.map((tk) => (
                <th key={tk} className="px-2 py-2 text-center font-bold border border-primary">
                  {tk.replace("|", " - ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              // Pre-compute innerRows per slot for this day to align row heights across columns
              const perSlot = timeSlotKeys.map((tk) => {
                const [ts, te] = tk.split("|");
                const slot = slots.find(
                  (s) =>
                    (s.slot_date === day.date || s.day_label === day.label) &&
                    s.time_start === ts &&
                    s.time_end === te,
                );
                if (!slot) return { tk, slot: null as any, note: "", innerRows: [] as any[] };
                const slotPos = positions
                  .filter((p) => p.slot_id === slot.id)
                  .sort((a, b) => a.sort_order - b.sort_order);
                const slotAssigns = assignments.filter((a) => a.slot_id === slot.id);
                const note = slot.note || slot.duty || "";
                const general = slotAssigns.filter(
                  (a) => !a.position_id || !slotPos.some((p) => p.id === a.position_id),
                );
                let prevGroup: string | null | undefined = undefined;
                const innerRows: { kind: "group" | "row" | "filler"; group?: string | null; position?: string; members?: string; programmes?: string | null }[] = [];
                for (const pos of slotPos) {
                  const grp = (pos as any).group_label || null;
                  if (grp && grp !== prevGroup) innerRows.push({ kind: "group", group: grp });
                  prevGroup = grp;
                  const memberNames = slotAssigns
                    .filter((a) => a.position_id === pos.id)
                    .map((a) => displayName(memberMap.get(a.member_id)))
                    .filter(Boolean) as string[];
                  innerRows.push({
                    kind: "row",
                    position: pos.position_name,
                    members: memberNames.join("\n"),
                    programmes: (pos as any).programmes || null,
                  });
                }
                if (general.length > 0) {
                  innerRows.push({
                    kind: "row",
                    position: "General",
                    members: general
                      .map((a) => displayName(memberMap.get(a.member_id)))
                      .filter(Boolean)
                      .join("\n"),
                  });
                }
                return { tk, slot, note, innerRows };
              });
              const maxRows = Math.max(0, ...perSlot.map((p) => p.innerRows.length));
              // Pad each slot's innerRows with fillers to align heights
              perSlot.forEach((p) => {
                while (p.innerRows.length < maxRows) p.innerRows.push({ kind: "filler" });
              });
              return (
              <tr key={day.date || day.label}>
                <td className="px-2 py-2 font-bold text-foreground bg-muted border border-border align-top">
                  {day.label}
                  {day.date && (
                    <div className="text-[10px] text-muted-foreground font-normal">{day.date}</div>
                  )}
                </td>
                {perSlot.map(({ tk, slot, note, innerRows }) => {
                  if (!slot)
                    return (
                      <td
                        key={tk}
                        className="px-2 py-2 border border-border bg-muted-foreground/30"
                      />
                    );
                  return (
                    <td key={tk} className="p-0 border border-border align-top text-foreground" style={{ minWidth: 140 }}>
                      {note && <div className="italic text-muted-foreground px-1.5 py-1 text-[10px] border-b border-border">[{note}]</div>}
                      {innerRows.length === 0 ? (
                        <div className="px-2 py-2 text-muted-foreground/40">—</div>
                      ) : (
                        <div className="flex flex-col">
                          {innerRows.map((r, i) => {
                            if (r.kind === "group") {
                              return (
                                <div key={i} className="px-1.5 py-1 border-b border-border bg-muted font-bold uppercase tracking-wide text-[10px]" style={{ minHeight: 28 }}>
                                  {r.group}
                                </div>
                              );
                            }
                            if (r.kind === "filler") {
                              return <div key={i} className="border-b border-border" style={{ minHeight: 48 }} />;
                            }
                            return (
                              <div key={i} className="px-1.5 py-1 border-b border-border flex flex-col gap-0.5" style={{ minHeight: 48 }}>
                                <div className="font-semibold text-[11px] leading-tight">{r.position}</div>
                                {r.programmes && (
                                  <div className="text-[9px] text-muted-foreground whitespace-pre-wrap leading-tight">{r.programmes}</div>
                                )}
                                <div className="text-[11px] whitespace-pre-line leading-tight">
                                  {r.members || <span className="text-muted-foreground/40">—</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1">
        <Download className="h-3 w-3" /> Export
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Export Schedule — {schedule.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs mb-1 block">File Format</Label>
                <Select value={fileFormat} onValueChange={(v) => setFileFormat(v as "pdf" | "png")}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="png">PNG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Table Format</Label>
                <Select value={tableFormat} onValueChange={(v) => setTableFormat(v as ExportFormat)}>
                  <SelectTrigger className="w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Format 1 — Weekly Duty</SelectItem>
                    <SelectItem value="daily">Format 2 — Daily Manpower</SelectItem>
                    <SelectItem value="multiday">Format 3 — Multi-Day Schedule</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs mb-1 block">Title (optional)</Label>
                <Input
                  value={titleOverride}
                  onChange={(e) => setTitleOverride(e.target.value)}
                  placeholder={schedule.name}
                />
              </div>
              <Button onClick={handleExport} disabled={exporting} className="gap-1">
                <Download className="h-4 w-4" />
                {exporting ? "Exporting..." : `Download ${fileFormat.toUpperCase()}`}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">{formatDescriptions[tableFormat]}</p>

            {/* Preview */}
            <div
              ref={previewRef}
              className="bg-white p-6 rounded border overflow-x-auto"
              style={{
                colorScheme: "light",
                ["--background" as any]: "0 0% 100%",
                ["--foreground" as any]: "0 0% 12%",
                ["--card" as any]: "0 0% 100%",
                ["--card-foreground" as any]: "0 0% 12%",
                ["--muted" as any]: "0 0% 94%",
                ["--muted-foreground" as any]: "0 0% 45%",
                ["--border" as any]: "0 0% 80%",
                ["--primary" as any]: "355 85% 52%",
                ["--primary-foreground" as any]: "0 0% 100%",
                ["--accent" as any]: "355 85% 95%",
                ["--accent-foreground" as any]: "355 85% 35%",
                color: "hsl(0 0% 12%)",
              }}
            >
              {renderPreview()}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

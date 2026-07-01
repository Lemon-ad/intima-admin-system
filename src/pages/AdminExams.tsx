import { useMemo, useState } from "react";
import { useMembers } from "@/hooks/useMembers";
import {
  useExamPeriods,
  useCreateExamPeriod,
  useDeleteExamPeriod,
  useUpdateExamPeriod,
} from "@/hooks/useExamPeriods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, GraduationCap, Search, Pencil } from "lucide-react";
import { toast } from "sonner";
import { getCurrentRole } from "@/lib/adminAuth";


export default function AdminExams() {
  const { data: members = [] } = useMembers();
  const { data: examPeriods = [] } = useExamPeriods();
  const createExam = useCreateExamPeriod();
  const updateExam = useUpdateExamPeriod();
  const deleteExam = useDeleteExamPeriod();
  const isAdmin = getCurrentRole() === "admin";

  const [editId, setEditId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [position, setPosition] = useState<string>("");
  const [memberId, setMemberId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const today = new Date().toISOString().split("T")[0];

  const enrichedPeriods = useMemo(() => {
    return examPeriods
      .map((ep) => ({
        ...ep,
        member: memberMap.get(ep.member_id),
        active: ep.start_date <= today && ep.end_date >= today,
      }))
      .filter((ep) => ep.member)
      .filter((ep) =>
        search ? ep.member!.name.toLowerCase().includes(search.toLowerCase()) : true,
      )
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.start_date.localeCompare(b.start_date);
      });
  }, [examPeriods, memberMap, search, today]);

  const resetForm = () => {
    setPosition("");
    setMemberId("");
    setStartDate("");
    setEndDate("");
    setNote("");
    setEditId(null);
  };

  const handleSave = async () => {
    if (!memberId || !startDate || !endDate) {
      toast.error("Please fill in member, start date and end date");
      return;
    }
    if (endDate < startDate) {
      toast.error("End date must be after start date");
      return;
    }
    if (editId) {
      await updateExam.mutateAsync({ id: editId, member_id: memberId, start_date: startDate, end_date: endDate, note });
    } else {
      await createExam.mutateAsync({ member_id: memberId, start_date: startDate, end_date: endDate, note });
    }
    setShowAdd(false);
    resetForm();
  };

  const openEdit = (ep: typeof enrichedPeriods[number]) => {
    setEditId(ep.id);
    setPosition(ep.member!.position);
    setMemberId(ep.member_id);
    setStartDate(ep.start_date);
    setEndDate(ep.end_date);
    setNote(ep.note || "");
    setShowAdd(true);
  };

  const filteredMembers = position ? members.filter((m) => m.position === position) : [];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <GraduationCap className="h-6 w-6" /> Exam Period
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Members in their exam period are marked as <span className="font-semibold">Busy (Exam)</span> and unavailable for assignments.
          </p>
        </div>
        {isAdmin && (
          <Dialog open={showAdd} onOpenChange={(o) => { setShowAdd(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="intima-gradient text-primary-foreground gap-2" onClick={resetForm}>
                <Plus className="h-4 w-4" /> Add Exam Period
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editId ? "Edit Exam Period" : "Add Exam Period"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Position</Label>
                  <Select value={position} onValueChange={(v) => { setPosition(v); setMemberId(""); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a position" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SLT">SLT</SelectItem>
                      <SelectItem value="EXCO">EXCO</SelectItem>
                      <SelectItem value="Junior">Junior</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Member</Label>
                  <Select value={memberId} onValueChange={setMemberId} disabled={!position}>
                    <SelectTrigger>
                      <SelectValue placeholder={position ? "Select a member" : "Select a position first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredMembers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Start Date</Label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>End Date</Label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Note (optional)</Label>
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Final exam week"
                  />
                </div>
                <Button onClick={handleSave} className="w-full intima-gradient text-primary-foreground">
                  {editId ? "Save Changes" : "Add Exam Period"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="relative max-w-xs mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by member name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="grid gap-2">
        {enrichedPeriods.length === 0 && (
          <p className="text-muted-foreground text-sm">No exam periods recorded.</p>
        )}
        {enrichedPeriods.map((ep) => (
          <div
            key={ep.id}
            className="flex items-center justify-between p-3 rounded-lg bg-card border border-border"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                  ep.member!.position === "SLT"
                    ? "bg-tag-slt-bg text-tag-slt border-tag-slt/30"
                    : ep.member!.position === "EXCO"
                    ? "bg-tag-exco-bg text-tag-exco border-tag-exco/30"
                    : "bg-tag-members-bg text-tag-members border-tag-members/30"
                }`}
              >
                {ep.member!.position}
              </span>
              <span className="font-medium">{ep.member!.name}</span>
              <Badge variant={ep.active ? "default" : "outline"} className={ep.active ? "bg-destructive text-destructive-foreground" : ""}>
                {ep.active ? "Busy (Exam) — active" : "Scheduled"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {ep.start_date} → {ep.end_date}
              </span>
              {ep.note && <span className="text-sm italic text-muted-foreground">"{ep.note}"</span>}
            </div>
            {isAdmin && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(ep)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => deleteExam.mutate(ep.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}

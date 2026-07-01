import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useMembers } from "@/hooks/useMembers";

const DEFAULT_TITLE = "You have duty for {schedule}";
const DEFAULT_BODY = "{date} ({day}) {time_start}–{time_end}\n{duty}\n{time_left} to go~";
const DEFAULT_REMINDER_OFFSETS = [1440, 60, 15, 1];
const VARS = ["schedule", "member", "date", "day", "time_start", "time_end", "duty", "position", "time_left"];

const PRESETS = [
  { label: "1 week before", minutes: 10080 },
  { label: "3 days before", minutes: 4320 },
  { label: "1 day before", minutes: 1440 },
  { label: "12 hours before", minutes: 720 },
  { label: "3 hours before", minutes: 180 },
  { label: "1 hour before", minutes: 60 },
  { label: "30 min before", minutes: 30 },
  { label: "15 min before", minutes: 15 },
  { label: "5 min before", minutes: 5 },
  { label: "1 min before", minutes: 1 },
];

function formatMinutes(m: number): string {
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? "" : "s"} before`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? "" : "s"} before`;
  return `${m} min before`;
}

export default function AdminSettings() {
  const [offsets, setOffsets] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [customValue, setCustomValue] = useState("");
  const [customUnit, setCustomUnit] = useState<"min" | "hour" | "day">("min");
  const [testMemberId, setTestMemberId] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [titleTpl, setTitleTpl] = useState(DEFAULT_TITLE);
  const [bodyTpl, setBodyTpl] = useState(DEFAULT_BODY);
  const [tplSaving, setTplSaving] = useState(false);
  const { data: members = [] } = useMembers();

  useEffect(() => {
    (async () => {
      const [{ data: offsetRow }, { data: tplRow }] = await Promise.all([
        supabase.from("app_settings").select("value").eq("key", "reminder_offsets_minutes").maybeSingle(),
        supabase.from("app_settings").select("value").eq("key", "notification_template").maybeSingle(),
      ]);
      const arr = Array.isArray(offsetRow?.value) ? (offsetRow!.value as number[]) : DEFAULT_REMINDER_OFFSETS;
      setOffsets(arr.sort((a, b) => b - a));
      const tpl = (tplRow?.value && typeof tplRow.value === "object") ? tplRow.value as any : {};
      setTitleTpl(tpl.title || DEFAULT_TITLE);
      setBodyTpl(tpl.body || DEFAULT_BODY);
      setLoading(false);
    })();
  }, []);

  const saveTemplate = async () => {
    setTplSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: "notification_template", value: { title: titleTpl, body: bodyTpl } },
        { onConflict: "key" },
      );
    setTplSaving(false);
    if (error) toast.error("Save failed: " + error.message);
    else toast.success("Notification template saved");
  };

  const renderPreview = (s: string) => {
    const sample: Record<string, string> = {
      schedule: "INTIMA Test Schedule",
      member: "You",
      date: "13 May 2026",
      day: "Wednesday",
      time_start: "14:00",
      time_end: "16:00",
      duty: "Registration Counter",
      position: "Test Member",
      time_left: "15 minutes",
    };
    return s.replace(/\{(\w+)\}/g, (_, k) => sample[k] ?? `{${k}}`);
  };

  const save = async (next: number[]) => {
    const sorted = Array.from(new Set(next)).sort((a, b) => b - a);
    setOffsets(sorted);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "reminder_offsets_minutes", value: sorted }, { onConflict: "key" });
    if (error) toast.error("Save failed: " + error.message);
  };

  const addPreset = (m: number) => {
    if (offsets.includes(m)) return;
    save([...offsets, m]);
  };

  const addCustom = () => {
    const n = parseInt(customValue, 10);
    if (!n || n <= 0) return toast.error("Enter a positive number");
    const minutes = customUnit === "min" ? n : customUnit === "hour" ? n * 60 : n * 1440;
    if (minutes > 10080 * 4) return toast.error("Max 4 weeks");
    if (offsets.includes(minutes)) return toast.error("Already added");
    save([...offsets, minutes]);
    setCustomValue("");
  };

  const remove = (m: number) => save(offsets.filter((x) => x !== m));

  const sendTest = async (mode: "one" | "all" = "one") => {
    if (mode === "one" && !testMemberId) return toast.error("Pick a member");
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("push-send", {
        body: mode === "all" ? { test: true, all: true } : { test: true, member_id: testMemberId },
      });
      if (error) throw error;
      const r = data as { sent: number; failed: number; count: number };
      if (r.count === 0) toast.error(mode === "all" ? "No one has enabled notifications yet" : "That member has no notification subscriptions yet");
      else toast.success(`Sent ${r.sent}/${r.count} notification(s)${r.failed ? `, ${r.failed} failed` : ""}`);
    } catch (e: any) {
      toast.error("Test failed: " + (e.message || e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      <Card className="mb-6">
        <CardContent className="p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold">🔔 Push Notification Reminders</h3>
            <p className="text-sm text-muted-foreground mt-1">
              When members enable notifications, they'll receive a popup reminder at each of these times before their duty slot.
              Background cron checks every 5 minutes.
            </p>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              <div>
                <p className="text-sm font-medium mb-2">Active reminders ({offsets.length})</p>
                {offsets.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No reminders set — members won't get notifications.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {offsets.map((m) => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-2 rounded-full bg-primary/10 border border-primary/30 px-3 py-1 text-sm text-primary"
                      >
                        ⏰ {formatMinutes(m)}
                        <button
                          onClick={() => remove(m)}
                          className="hover:bg-primary/20 rounded-full w-5 h-5 inline-flex items-center justify-center"
                          aria-label="Remove"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Quick add</p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.filter((p) => !offsets.includes(p.minutes)).map((p) => (
                    <button
                      key={p.minutes}
                      onClick={() => addPreset(p.minutes)}
                      className="rounded-md border border-border bg-card px-3 py-1 text-xs hover:border-primary hover:text-primary transition-colors"
                    >
                      + {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Custom reminder</p>
                <div className="flex gap-2 items-center flex-wrap">
                  <Input
                    type="number"
                    min="1"
                    placeholder="e.g. 45"
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    className="w-28"
                  />
                  <select
                    value={customUnit}
                    onChange={(e) => setCustomUnit(e.target.value as any)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="min">minutes</option>
                    <option value="hour">hours</option>
                    <option value="day">days</option>
                  </select>
                  <span className="text-sm text-muted-foreground">before slot</span>
                  <Button onClick={addCustom} size="sm">Add</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold">✏️ Notification Message Template</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Customize what each reminder push notification says. Use the variables below — they'll be replaced with real values when sent.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Available variables (click to insert into body)</p>
            <div className="flex flex-wrap gap-2">
              {VARS.map((v) => (
                <button
                  key={v}
                  onClick={() => setBodyTpl((b) => b + `{${v}}`)}
                  className="rounded-md border border-border bg-card px-2 py-1 text-xs font-mono hover:border-primary hover:text-primary transition-colors"
                >
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Title</label>
            <Input value={titleTpl} onChange={(e) => setTitleTpl(e.target.value)} />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Body (multi-line allowed)</label>
            <Textarea
              value={bodyTpl}
              onChange={(e) => setBodyTpl(e.target.value)}
              rows={4}
              className="font-mono text-sm"
            />
          </div>

          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Preview</p>
            <p className="text-sm font-semibold">{renderPreview(titleTpl)}</p>
            <p className="text-sm whitespace-pre-line text-muted-foreground">{renderPreview(bodyTpl)}</p>
          </div>

          <div className="flex gap-2">
            <Button onClick={saveTemplate} disabled={tplSaving}>
              {tplSaving ? "Saving..." : "Save Template"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => { setTitleTpl(DEFAULT_TITLE); setBodyTpl(DEFAULT_BODY); }}
            >
              Reset to default
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-3">
          <div>
            <h3 className="text-lg font-semibold">🧪 Test Notifications</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Send a test notification to a member who has enabled them. Useful for verifying setup.
            </p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <select
              value={testMemberId}
              onChange={(e) => setTestMemberId(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm flex-1 min-w-[200px]"
            >
              <option value="">Pick a member...</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <Button onClick={() => sendTest("one")} disabled={testing || !testMemberId}>
              {testing ? "Sending..." : "Send Test"}
            </Button>
            <Button onClick={() => sendTest("all")} disabled={testing} variant="secondary">
              {testing ? "Sending..." : "📢 Send to Everyone"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

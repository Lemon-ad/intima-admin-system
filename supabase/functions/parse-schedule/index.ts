import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

function normalizeBusyHours(hours: unknown): number[] {
  if (!Array.isArray(hours)) return [];

  return Array.from(
    new Set(
      hours
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 8 && value < 18)
    )
  ).sort((a, b) => a - b);
}

function formatHour(hour: number): string {
  if (hour === 12) return "12pm";
  if (hour > 12) return `${hour - 12}pm`;
  return `${hour}am`;
}

function buildFreeRanges(busyHours: number[]): string[] {
  const busySet = new Set(busyHours);
  const freeHours: number[] = [];

  for (let hour = 8; hour < 18; hour += 1) {
    if (!busySet.has(hour)) freeHours.push(hour);
  }

  if (freeHours.length === 0) return [];

  const ranges: string[] = [];
  let rangeStart = freeHours[0];
  let previousHour = freeHours[0];

  for (let index = 1; index < freeHours.length; index += 1) {
    const currentHour = freeHours[index];
    if (currentHour === previousHour + 1) {
      previousHour = currentHour;
      continue;
    }

    ranges.push(`${formatHour(rangeStart)}-${formatHour(previousHour + 1)}`);
    rangeStart = currentHour;
    previousHour = currentHour;
  }

  ranges.push(`${formatHour(rangeStart)}-${formatHour(previousHour + 1)}`);
  return ranges;
}

function computeFreeTimesFromBusyHours(busyHoursByDay: Record<string, unknown>) {
  return Object.fromEntries(
    WEEKDAYS.map((day) => [day, buildFreeRanges(normalizeBusyHours(busyHoursByDay?.[day]))])
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { schedule_text, images } = await req.json();
    // images is an array of { data: base64string, mime_type: string }
    if (!schedule_text && (!images || images.length === 0)) {
      return new Response(JSON.stringify({ error: "schedule_text or images required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build multimodal content array
    const userContent: any[] = [];

    if (schedule_text) {
      userContent.push({ type: "text", text: schedule_text });
    }

    if (images && images.length > 0) {
      for (const img of images) {
        userContent.push({
          type: "image_url",
          image_url: {
            url: `data:${img.mime_type};base64,${img.data}`,
          },
        });
      }
    }

    if (userContent.length === 0) {
      userContent.push({ type: "text", text: "No schedule provided" });
    }

    // Add instruction for merging
    const mergeNote = (images && images.length > 1) || (schedule_text && images && images.length > 0)
      ? "\nIMPORTANT: Multiple schedules have been provided. Merge ALL of them together — combine all busy times from every schedule, then calculate the overall free times."
      : "";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content: `You are a precise university timetable parser.
${mergeNote}
Your job is NOT to calculate free-time text directly.
Your job is to extract OCCUPIED 1-hour timetable blocks for Monday-Friday, then the server will calculate free times.

HOW TO READ THIS TIMETABLE PATTERN:
- Rows are weekdays.
- Columns are 1-hour blocks labeled 0800, 0900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700.
- A class shown inside the 1100 cell means BUSY for 11am-12pm, so record hour 11.
- A class shown inside the 1200 cell means BUSY for 12pm-1pm, so record hour 12.
- A class shown inside the 1400 cell means BUSY for 2pm-3pm, so record hour 14.
- If the same subject appears across consecutive cells, record EVERY occupied hour block.

CRITICAL EXAMPLES FROM THIS SCHEDULE STYLE:
- Thursday with classes only in 1100 and 1300 means busy_hours Thursday = [11, 13], which becomes free time 8am-11am, 12pm-1pm, 2pm-6pm.
- Friday with classes in 1400, 1500, 1600 means busy_hours Friday = [14, 15, 16], which becomes free time 8am-2pm, 5pm-6pm.
- Do NOT stretch a class beyond the occupied cells. Example: if Thursday has a class at 1300 only, that is 1pm-2pm busy, NOT 1pm-3pm.
- Do NOT convert busy blocks into free time yourself.

RULES:
- Return only occupied hour START values as integers.
- Only include Monday-Friday.
- Only include hours from 8 to 17.
- If a weekday has no classes, return an empty array for that day.
- Be literal and conservative: only mark hours that are visibly occupied or explicitly stated in text.
- Return ONLY the tool call result.`
          },
          { role: "user", content: userContent }
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_busy_hours",
            description: "Extract occupied 1-hour timetable blocks from one or more schedules",
            parameters: {
              type: "object",
              properties: {
                busy_hours: {
                  type: "object",
                  properties: {
                    Monday: { type: "array", items: { type: "integer" } },
                    Tuesday: { type: "array", items: { type: "integer" } },
                    Wednesday: { type: "array", items: { type: "integer" } },
                    Thursday: { type: "array", items: { type: "integer" } },
                    Friday: { type: "array", items: { type: "integer" } },
                  },
                  required: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                  additionalProperties: false,
                },
              },
              required: ["busy_hours"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_busy_hours" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall) {
      const parsed = JSON.parse(toolCall.function.arguments);
      const busyHours = parsed.busy_hours ?? {};
      const freeTimes = computeFreeTimesFromBusyHours(busyHours);

      return new Response(JSON.stringify({ free_times: freeTimes, busy_hours: busyHours }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Failed to parse schedule" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-schedule error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

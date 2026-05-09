// AI-powered "Find a Time" — analyzes participants' busy slots and suggests best meeting times.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ScheduleEvent {
  title: string;
  dayOfWeek: number; // 1=Mon..7=Sun
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

interface Participant {
  name: string;
  schedule: ScheduleEvent[];
}

const DAYS = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const DAY_START = 8 * 60;   // 08:00
const DAY_END   = 22 * 60;  // 22:00
const SLOT = 30;            // minutes

function fmt(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

// Compute free intervals (>= duration) per day across all participants
function computeFreeSlots(participants: Participant[], durationMin: number) {
  const results: Array<{ day: number; dayName: string; start: string; end: string; durationMin: number; freeCount: number }> = [];

  for (let day = 1; day <= 7; day++) {
    // Build a busy bitmap per slot
    const slotsCount = (DAY_END - DAY_START) / SLOT;
    const busy = new Array(slotsCount).fill(0);

    for (const p of participants) {
      const occupied = new Set<number>();
      for (const ev of p.schedule) {
        if (ev.dayOfWeek !== day) continue;
        const start = ev.startHour * 60 + ev.startMinute;
        const end   = ev.endHour   * 60 + ev.endMinute;
        for (let i = 0; i < slotsCount; i++) {
          const sMin = DAY_START + i * SLOT;
          const eMin = sMin + SLOT;
          if (sMin < end && eMin > start) occupied.add(i);
        }
      }
      for (const i of occupied) busy[i]++;
    }

    // Find runs where busy[i] === 0 (everyone free)
    let runStart: number | null = null;
    for (let i = 0; i <= slotsCount; i++) {
      const free = i < slotsCount && busy[i] === 0;
      if (free && runStart === null) runStart = i;
      if ((!free || i === slotsCount) && runStart !== null) {
        const lengthSlots = i - runStart;
        const lengthMin = lengthSlots * SLOT;
        if (lengthMin >= durationMin) {
          // Emit windows of exactly durationMin sliding by SLOT to give multiple options
          for (let s = runStart; s + (durationMin / SLOT) <= i; s += 1) {
            const startMin = DAY_START + s * SLOT;
            const endMin = startMin + durationMin;
            results.push({
              day,
              dayName: DAYS[day - 1],
              start: fmt(startMin),
              end: fmt(endMin),
              durationMin,
              freeCount: participants.length,
            });
          }
        }
        runStart = null;
      }
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { eventId, durationMin = 60, timeOfDay = "any", weekdaysOnly = false } = await req.json();
    if (!eventId) {
      return new Response(JSON.stringify({ error: "eventId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load participants for this event
    const { data: rows, error } = await userClient
      .from("event_users")
      .select("name, schedule")
      .eq("event_id", eventId);
    if (error) throw error;

    const participants: Participant[] = (rows ?? []).map((r: any) => ({
      name: r.name,
      schedule: Array.isArray(r.schedule) ? r.schedule : [],
    }));

    if (participants.length === 0) {
      return new Response(JSON.stringify({ suggestions: [], reasoning: "No hay participantes todavía." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let candidates = computeFreeSlots(participants, durationMin);

    // Apply user filters
    const inRange = (hhmm: string, fromH: number, toH: number) => {
      const [h, m] = hhmm.split(":").map(Number);
      const min = h * 60 + m;
      return min >= fromH * 60 && min <= toH * 60;
    };
    if (weekdaysOnly) candidates = candidates.filter((c) => c.day >= 1 && c.day <= 5);
    if (timeOfDay === "morning") candidates = candidates.filter((c) => inRange(c.start, 6, 12));
    else if (timeOfDay === "afternoon") candidates = candidates.filter((c) => inRange(c.start, 12, 18));
    else if (timeOfDay === "evening") candidates = candidates.filter((c) => inRange(c.start, 18, 23));

    // Limit to top 30 raw candidates to keep prompt small
    const topRaw = candidates.slice(0, 30);

    // Ask AI to rank and explain (with fallback to deterministic ordering)
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    let ranked = topRaw.slice(0, 5).map((s, i) => ({ ...s, rank: i + 1, reason: "Todos disponibles." }));

    if (LOVABLE_API_KEY && topRaw.length > 0) {
      try {
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content: "Eres un asistente que sugiere las mejores horas para reuniones grupales en español. Prefieres horarios entre 9:00 y 18:00, evitando muy temprano o muy tarde, y prefieres días entre semana cuando sea posible. Devuelve siempre una llamada a la herramienta rank_meetings.",
              },
              {
                role: "user",
                content: `Tengo ${participants.length} participantes (${participants.map(p=>p.name).join(", ")}). Estas son ventanas donde TODOS están libres (duración ${durationMin} min). Elige las 5 mejores y explica brevemente por qué cada una es buena.\n\n${JSON.stringify(topRaw)}`,
              },
            ],
            tools: [{
              type: "function",
              function: {
                name: "rank_meetings",
                description: "Rank top meeting time suggestions",
                parameters: {
                  type: "object",
                  properties: {
                    suggestions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          day: { type: "number" },
                          dayName: { type: "string" },
                          start: { type: "string" },
                          end: { type: "string" },
                          reason: { type: "string" },
                        },
                        required: ["day","dayName","start","end","reason"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["suggestions"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "rank_meetings" } },
          }),
        });

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const tc = aiData?.choices?.[0]?.message?.tool_calls?.[0];
          if (tc?.function?.arguments) {
            const args = JSON.parse(tc.function.arguments);
            if (Array.isArray(args.suggestions)) {
              ranked = args.suggestions.slice(0, 5).map((s: any, i: number) => ({
                day: s.day, dayName: s.dayName, start: s.start, end: s.end,
                durationMin, freeCount: participants.length,
                rank: i + 1, reason: s.reason,
              }));
            }
          }
        } else if (aiRes.status === 429 || aiRes.status === 402) {
          console.warn("AI gateway throttled/unpaid, using deterministic ranking");
        }
      } catch (e) {
        console.warn("AI ranking failed, falling back:", e);
      }
    }

    return new Response(JSON.stringify({
      suggestions: ranked,
      participantCount: participants.length,
      candidateCount: candidates.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

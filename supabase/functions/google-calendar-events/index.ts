// Fetches calendar events in a date range and converts them to ScheduleEvent[] busy slots.
// IMPORTANT: All event times are interpreted in the user's IANA timezone (passed by client),
// NOT the server's timezone. This ensures morning events and timezone-shifted events
// appear on the correct day/hour in the availability map.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ScheduleEvent {
  title: string;
  dayOfWeek: number; // 1=Mon..7=Sun (matching the app's grid)
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Refresh failed: ${JSON.stringify(data)}`);
  return data;
}

// Returns { year, month, day, hour, minute, weekday } in the given IANA timezone.
// weekday: 1=Mon..7=Sun
function getZonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const wmap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // Intl can return "24" for midnight in some locales
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    minute: parseInt(parts.minute, 10),
    weekday: wmap[parts.weekday] ?? 1,
  };
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

    const { startDate, endDate, timeZone } = await req.json();
    if (!startDate || !endDate) {
      return new Response(JSON.stringify({ error: "startDate and endDate required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tz = (typeof timeZone === "string" && timeZone) ? timeZone : "UTC";

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tokenRow, error: tokenErr } = await adminClient
      .from("google_calendar_tokens")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (tokenErr || !tokenRow) {
      return new Response(JSON.stringify({ error: "Google Calendar not connected" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = tokenRow.access_token;
    if (new Date(tokenRow.expires_at).getTime() < Date.now() + 60_000) {
      if (!tokenRow.refresh_token) {
        return new Response(JSON.stringify({ error: "Token expired and no refresh token. Please reconnect." }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const refreshed = await refreshAccessToken(tokenRow.refresh_token);
      accessToken = refreshed.access_token;
      const newExpiry = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();
      await adminClient.from("google_calendar_tokens").update({
        access_token: accessToken, expires_at: newExpiry,
      }).eq("user_id", user.id);
    }

    // Pass timeZone to Google so all-day events and floating times are anchored correctly.
    const params = new URLSearchParams({
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      timeZone: tz,
    });

    const evRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const evData = await evRes.json();
    if (!evRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch events", details: evData }), {
        status: evRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const weekStart = new Date(startDate);
    const weekEnd = new Date(endDate);

    const schedule: ScheduleEvent[] = [];

    // Helper: push one busy block, splitting by midnight (in the user's TZ) if it crosses days.
    const pushBlock = (title: string, startInstant: Date, endInstant: Date) => {
      // Clamp to selected week window
      const s = startInstant < weekStart ? weekStart : startInstant;
      const e = endInstant > weekEnd ? weekEnd : endInstant;
      if (e <= s) return;

      let cursor = new Date(s);
      while (cursor < e) {
        const cp = getZonedParts(cursor, tz);
        // Compute the next local midnight in tz by stepping forward to (day+1) 00:00 local.
        // We approximate by adding minutes until parts.day changes. Cheaper: jump to end of segment.
        // End of this local day in tz:
        const minutesUntilEndOfDay = (23 - cp.hour) * 60 + (60 - cp.minute);
        const segmentEnd = new Date(Math.min(
          cursor.getTime() + minutesUntilEndOfDay * 60_000,
          e.getTime()
        ));
        const ep = getZonedParts(segmentEnd, tz);

        // If segmentEnd is exactly at next-day midnight, ep.hour will be 0 and ep.day will differ.
        // We want endHour/endMinute on the same local day as cursor.
        let endHour = ep.hour;
        let endMinute = ep.minute;
        if (ep.day !== cp.day || ep.month !== cp.month || ep.year !== cp.year) {
          endHour = 24;
          endMinute = 0;
        }

        schedule.push({
          title,
          dayOfWeek: cp.weekday,
          startHour: cp.hour,
          startMinute: cp.minute,
          endHour,
          endMinute,
        });

        // Advance cursor to segmentEnd
        if (segmentEnd.getTime() === cursor.getTime()) break;
        cursor = segmentEnd;
      }
    };

    for (const ev of evData.items ?? []) {
      if (ev.status === "cancelled") continue;
      // Skip events the user declined
      const attendees = ev.attendees ?? [];
      const me = attendees.find((a: { self?: boolean }) => a.self);
      if (me?.responseStatus === "declined") continue;
      if (ev.transparency === "transparent") continue; // marked as "free"

      const title = ev.summary ?? "Busy";

      if (ev.start?.dateTime && ev.end?.dateTime) {
        // Timed event. dateTime is an ISO string with offset; new Date() parses correctly.
        pushBlock(title, new Date(ev.start.dateTime), new Date(ev.end.dateTime));
      } else if (ev.start?.date && ev.end?.date) {
        // All-day event. Google uses exclusive end date. Treat as busy 00:00 → 24:00 local for each day.
        // Build local midnight in tz for start and end.
        // Trick: create a UTC date at the date string, then use getZonedParts to align by walking days.
        // Simpler: iterate day by day from start.date to end.date (exclusive).
        const [sy, sm, sd] = ev.start.date.split("-").map((n: string) => parseInt(n, 10));
        const [ey, em, ed] = ev.end.date.split("-").map((n: string) => parseInt(n, 10));
        // Iterate using a UTC-anchored date; we only care about y/m/d arithmetic.
        const cur = new Date(Date.UTC(sy, sm - 1, sd));
        const endExclusive = new Date(Date.UTC(ey, em - 1, ed));
        while (cur < endExclusive) {
          // For each all-day date, find which weekday it is in tz.
          // Use noon UTC to avoid DST edge cases when computing weekday in tz.
          const noon = new Date(Date.UTC(
            cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate(), 12, 0, 0
          ));
          const parts = getZonedParts(noon, tz);
          // Only include if the date falls within the selected week (compare y/m/d in tz).
          const weekStartParts = getZonedParts(weekStart, tz);
          const weekEndParts = getZonedParts(new Date(weekEnd.getTime() - 1), tz);
          const k = parts.year * 10000 + parts.month * 100 + parts.day;
          const ks = weekStartParts.year * 10000 + weekStartParts.month * 100 + weekStartParts.day;
          const ke = weekEndParts.year * 10000 + weekEndParts.month * 100 + weekEndParts.day;
          if (k >= ks && k <= ke) {
            schedule.push({
              title,
              dayOfWeek: parts.weekday,
              startHour: 0,
              startMinute: 0,
              endHour: 24,
              endMinute: 0,
            });
          }
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }
    }

    return new Response(JSON.stringify({ schedule, count: schedule.length, timeZone: tz }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

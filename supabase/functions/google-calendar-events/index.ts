// =============================================================================
// SECURITY CHECKLIST — Google Calendar Events Sync
// -----------------------------------------------------------------------------
// 1. JWT validated via getUser(); only the owning user can read their tokens.
// 2. Tokens are decrypted server-side via public.gcal_decrypt() — plaintext
//    never crosses the network or hits a log.
// 3. Token refresh happens here; the new access token is re-encrypted before
//    being persisted. Refresh tokens never leave the server.
// 4. Only busy-interval data (title, day-of-week, start/end) is returned to the
//    client — we deliberately drop attendee lists, attachments, conferencing
//    links, descriptions, and locations. Minimum data for scheduling.
// 5. All timestamps are computed in the client's IANA tz; no calendar data is
//    cached on disk.
// 6. Audit log records every sync (success or auth failure). Tokens are NEVER
//    logged.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ScheduleEvent {
  title: string;
  dayOfWeek: number;
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
  if (!res.ok) {
    // Sanitized — do NOT include token material in the thrown message.
    throw new Error(`Refresh failed (${res.status})`);
  }
  return data;
}

function getZonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const parts = fmt.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value; return acc;
  }, {});
  const wmap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour, minute: parseInt(parts.minute, 10),
    weekday: wmap[parts.weekday] ?? 1,
  };
}

async function audit(
  admin: ReturnType<typeof createClient>,
  userId: string | null,
  eventType: string,
  details: Record<string, unknown>,
  req: Request,
) {
  try {
    await admin.from("security_audit_log").insert({
      user_id: userId, event_type: eventType, details,
      ip_address: req.headers.get("x-forwarded-for") ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
    });
  } catch (_) { /* swallow */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      await audit(adminClient, null, "auth_fail", { fn: "events" }, req);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData?.user?.id) {
      await audit(adminClient, null, "auth_fail", { fn: "events" }, req);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { startDate, endDate, timeZone } = await req.json();
    if (typeof startDate !== "string" || typeof endDate !== "string") {
      return new Response(JSON.stringify({ error: "startDate and endDate required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tz = (typeof timeZone === "string" && timeZone) ? timeZone : "UTC";

    // Fetch decrypted tokens via a SECURITY DEFINER RPC. We never round-trip
    // bytea ciphertext through PostgREST (it serializes as a hex string and
    // can't be safely re-passed to another RPC).
    const { data: tokenRows, error: tokenErr } = await adminClient
      .rpc("gcal_get_tokens", { _user_id: userId });

    if (tokenErr) {
      console.error("gcal_get_tokens error:", tokenErr.message);
      return new Response(JSON.stringify({ error: "Token lookup failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tokenRow = Array.isArray(tokenRows) ? tokenRows[0] : tokenRows;
    if (!tokenRow) {
      return new Response(JSON.stringify({ error: "Google Calendar no está conectado. Vuelve a conectarlo.", requiresReconnect: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = tokenRow.access_token as string | null;
    const refreshToken = tokenRow.refresh_token as string | null;
    const expiresAt = tokenRow.expires_at as string;

    if (!accessToken) {
      await adminClient.from("google_calendar_tokens").delete().eq("user_id", userId);
      await audit(adminClient, userId, "gcal_reconnect_required", { reason: "missing_access_token" }, req);
      return new Response(JSON.stringify({ error: "La conexión con Google Calendar caducó. Vuelve a conectarla.", requiresReconnect: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new Date(expiresAt).getTime() < Date.now() + 60_000) {
      if (!refreshToken) {
        await adminClient.from("google_calendar_tokens").delete().eq("user_id", userId);
        await audit(adminClient, userId, "gcal_reconnect_required", { reason: "missing_refresh_token" }, req);
        return new Response(JSON.stringify({ error: "La conexión con Google Calendar caducó. Vuelve a conectarla.", requiresReconnect: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>;
      try {
        refreshed = await refreshAccessToken(refreshToken);
      } catch (refreshErr) {
        await adminClient.from("google_calendar_tokens").delete().eq("user_id", userId);
        await audit(adminClient, userId, "gcal_refresh_fail", { reason: "google_rejected_refresh" }, req);
        console.error("gcal refresh failed:", (refreshErr as Error).message);
        return new Response(JSON.stringify({ error: "La conexión con Google Calendar caducó. Vuelve a conectarla.", requiresReconnect: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      accessToken = refreshed.access_token;
      const newExpiry = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();
      const { error: updErr } = await adminClient.rpc("gcal_update_access_token", {
        _user_id: userId, _new_access: accessToken, _new_expires: newExpiry,
      });
      if (updErr) console.error("gcal_update_access_token error:", updErr.message);
      await audit(adminClient, userId, "gcal_refresh", {}, req);
    }

    const params = new URLSearchParams({
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      timeZone: tz,
    });

    let evRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!evRes.ok) {
      if ((evRes.status === 401 || evRes.status === 403) && refreshToken) {
        try {
          const refreshed = await refreshAccessToken(refreshToken);
          accessToken = refreshed.access_token;
          const newExpiry = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();
          await adminClient.rpc("gcal_update_access_token", {
            _user_id: userId, _new_access: accessToken, _new_expires: newExpiry,
          });
          evRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
        } catch (_) { /* handled below */ }
      }
    }
    if (!evRes.ok) {
      // Don't leak Google's response body to the client.
      if (evRes.status === 401 || evRes.status === 403) {
        await adminClient.from("google_calendar_tokens").delete().eq("user_id", userId);
        await audit(adminClient, userId, "gcal_reconnect_required", { reason: "google_calendar_denied" }, req);
        return new Response(JSON.stringify({ error: "Google Calendar rechazó el acceso. Vuelve a conectarlo.", requiresReconnect: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "No se pudieron leer los eventos de Google Calendar. Intenta de nuevo." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const evData = await evRes.json();

    const weekStart = new Date(startDate);
    const weekEnd = new Date(endDate);
    const schedule: ScheduleEvent[] = [];

    const pushBlock = (title: string, startInstant: Date, endInstant: Date) => {
      const s = startInstant < weekStart ? weekStart : startInstant;
      const e = endInstant > weekEnd ? weekEnd : endInstant;
      if (e <= s) return;
      let cursor = new Date(s);
      while (cursor < e) {
        const cp = getZonedParts(cursor, tz);
        const minutesUntilEndOfDay = (23 - cp.hour) * 60 + (60 - cp.minute);
        const segmentEnd = new Date(Math.min(
          cursor.getTime() + minutesUntilEndOfDay * 60_000,
          e.getTime()
        ));
        const ep = getZonedParts(segmentEnd, tz);
        let endHour = ep.hour;
        let endMinute = ep.minute;
        if (ep.day !== cp.day || ep.month !== cp.month || ep.year !== cp.year) {
          endHour = 24; endMinute = 0;
        }
        schedule.push({
          title, dayOfWeek: cp.weekday,
          startHour: cp.hour, startMinute: cp.minute,
          endHour, endMinute,
        });
        if (segmentEnd.getTime() === cursor.getTime()) break;
        cursor = segmentEnd;
      }
    };

    for (const ev of evData.items ?? []) {
      if (ev.status === "cancelled") continue;
      const attendees = ev.attendees ?? [];
      const me = attendees.find((a: { self?: boolean }) => a.self);
      if (me?.responseStatus === "declined") continue;
      if (ev.transparency === "transparent") continue;

      // Minimization: we keep only a generic title; never the description, location,
      // attendees, or conferencing links. If you'd prefer total opacity, replace with "Busy".
      const title = typeof ev.summary === "string" ? ev.summary.slice(0, 80) : "Busy";

      if (ev.start?.dateTime && ev.end?.dateTime) {
        pushBlock(title, new Date(ev.start.dateTime), new Date(ev.end.dateTime));
      } else if (ev.start?.date && ev.end?.date) {
        const [sy, sm, sd] = ev.start.date.split("-").map((n: string) => parseInt(n, 10));
        const [ey, em, ed] = ev.end.date.split("-").map((n: string) => parseInt(n, 10));
        const cur = new Date(Date.UTC(sy, sm - 1, sd));
        const endExclusive = new Date(Date.UTC(ey, em - 1, ed));
        while (cur < endExclusive) {
          const noon = new Date(Date.UTC(
            cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate(), 12, 0, 0
          ));
          const parts = getZonedParts(noon, tz);
          const weekStartParts = getZonedParts(weekStart, tz);
          const weekEndParts = getZonedParts(new Date(weekEnd.getTime() - 1), tz);
          const k = parts.year * 10000 + parts.month * 100 + parts.day;
          const ks = weekStartParts.year * 10000 + weekStartParts.month * 100 + weekStartParts.day;
          const ke = weekEndParts.year * 10000 + weekEndParts.month * 100 + weekEndParts.day;
          if (k >= ks && k <= ke) {
            schedule.push({
              title, dayOfWeek: parts.weekday,
              startHour: 0, startMinute: 0, endHour: 24, endMinute: 0,
            });
          }
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }
    }

    await adminClient.from("google_calendar_tokens")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("user_id", userId);
    await audit(adminClient, userId, "gcal_sync", { count: schedule.length }, req);

    return new Response(JSON.stringify({ schedule, count: schedule.length, timeZone: tz }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const err = e as Error;
    console.error("events error:", err.name, err.message, err.stack);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

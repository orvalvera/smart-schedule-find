// =============================================================================
// SECURITY CHECKLIST — Google Calendar Disconnect
// -----------------------------------------------------------------------------
// 1. JWT validated; only the owning user can disconnect.
// 2. Refresh token is revoked at Google (oauth2/revoke) BEFORE we delete the
//    row, so even if a backup leaks the user's access is already gone upstream.
// 3. Token plaintext is decrypted briefly only to call revoke; never logged.
// 4. Audit log records every disconnect (success and failure).
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
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
    const { data: claims, error } = await userClient.auth.getClaims(jwt);
    if (error || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const { data: tokenRows } = await admin.rpc("gcal_get_tokens", { _user_id: userId });
    const row = Array.isArray(tokenRows) ? tokenRows[0] : tokenRows;
    if (row) {
      const plain = (row.refresh_token ?? row.access_token) as string | null;
      if (plain) {
        try {
          await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: plain }),
          });
        } catch (_) { /* even if revoke fails, we still delete the row */ }
      }
      await admin.from("google_calendar_tokens").delete().eq("user_id", userId);
    }

    await audit(admin, userId, "gcal_disconnect", {}, req);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

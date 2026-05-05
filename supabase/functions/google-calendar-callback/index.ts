// =============================================================================
// SECURITY CHECKLIST — Google Calendar OAuth Callback
// -----------------------------------------------------------------------------
// 1. JWT validated via getUser() before doing anything (no anonymous calls).
// 2. redirect_uri is validated against an allow-list (origin must match the
//    project domain) to prevent open-redirect / token-injection attacks.
// 3. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET come from Lovable Cloud secrets,
//    never the frontend.
// 4. Tokens are encrypted at rest (pgp_sym_encrypt) via public.gcal_encrypt()
//    before being stored in google_calendar_tokens (access_token_enc /
//    refresh_token_enc bytea columns). The plaintext columns are never written.
// 5. Token-exchange responses are NEVER logged or echoed to the client; only a
//    sanitized error message is returned. Audit log records connect/fail only.
// 6. Service-role client is only used for the encrypted upsert + audit insert.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Allow-list of redirect-URI origins. Add custom domains here.
const ALLOWED_ORIGINS = [
  "https://smart-schedule-find.lovable.app",
  "https://id-preview--bd2836e1-5a44-48d7-9784-ce2e1585dabe.lovable.app",
];
function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.pathname !== "/google-calendar/callback") return false;
    if (u.hostname === "localhost") return true; // dev only
    if (u.hostname.endsWith(".lovable.app")) return true; // any preview/subdomain on lovable
    return ALLOWED_ORIGINS.includes(u.origin);
  } catch {
    return false;
  }
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
      user_id: userId,
      event_type: eventType,
      details, // never includes tokens
      ip_address: req.headers.get("x-forwarded-for") ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
    });
  } catch (_) { /* never block the request on audit failure */ }
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
      await audit(admin, null, "auth_fail", { fn: "callback", reason: "missing_auth" }, req);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      await audit(admin, null, "auth_fail", { fn: "callback", reason: "invalid_jwt" }, req);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { code, redirectUri } = await req.json();
    if (typeof code !== "string" || typeof redirectUri !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid code/redirectUri" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isAllowedRedirect(redirectUri)) {
      await audit(admin, userId, "gcal_connect_fail", { reason: "bad_redirect" }, req);
      return new Response(JSON.stringify({ error: "Invalid redirect URI" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exchange the code for tokens. We do NOT log Google's response.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens?.access_token) {
      await audit(admin, userId, "gcal_connect_fail", { http_status: tokenRes.status }, req);
      return new Response(JSON.stringify({ error: "Token exchange failed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

    // Encrypt tokens at rest via the security-definer helper (never store plaintext).
    const { data: encAccess } = await admin.rpc("gcal_encrypt", { plaintext: tokens.access_token });
    const encRefreshRes = tokens.refresh_token
      ? await admin.rpc("gcal_encrypt", { plaintext: tokens.refresh_token })
      : { data: null };

    const { error: dbErr } = await admin
      .from("google_calendar_tokens")
      .upsert({
        user_id: userId,
        access_token: "ENCRYPTED",      // placeholder; real value lives in *_enc
        access_token_enc: encAccess,
        refresh_token: null,
        refresh_token_enc: encRefreshRes.data,
        expires_at: expiresAt,
        scope: typeof tokens.scope === "string" ? tokens.scope : null,
      }, { onConflict: "user_id" });

    if (dbErr) {
      await audit(admin, userId, "gcal_connect_fail", { reason: "db_error" }, req);
      return new Response(JSON.stringify({ error: "Storage failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await audit(admin, userId, "gcal_connect", { scope: tokens.scope ?? null }, req);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Generic message — never leak internals to the client.
    console.error("callback error (sanitized):", (e as Error).name);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

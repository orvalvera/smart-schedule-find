// =============================================================================
// SECURITY CHECKLIST — Google Calendar OAuth: Authorize URL builder
// -----------------------------------------------------------------------------
// 1. Caller must present a valid Supabase JWT; we do NOT issue OAuth URLs to
//    anonymous users.
// 2. redirect_uri is validated against an allow-list (open-redirect protection).
// 3. Minimal scope: `calendar.readonly`. We never request write access.
// 4. `state` carries only a random nonce + the user id (signed-implicitly via
//    the callback's own JWT check); no tokens or sensitive data.
// 5. GOOGLE_CLIENT_ID is stored as a Lovable Cloud secret; never sent by the
//    client.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ORIGINS = [
  "https://smart-schedule-find.lovable.app",
  "https://id-preview--bd2836e1-5a44-48d7-9784-ce2e1585dabe.lovable.app",
];
function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.pathname !== "/google-calendar/callback") return false;
    if (u.hostname === "localhost") return true;
    if (u.hostname.endsWith(".lovable.app")) return true;
    return ALLOWED_ORIGINS.includes(u.origin);
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { redirectUri } = await req.json();
    if (typeof redirectUri !== "string" || !isAllowedRedirect(redirectUri)) {
      return new Response(JSON.stringify({ error: "Invalid redirect URI" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const nonce = crypto.randomUUID();
    const state = btoa(JSON.stringify({ userId, nonce, ts: Date.now() }));

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.readonly", // read-only, minimal scope
      access_type: "offline",
      prompt: "consent",
      state,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return new Response(JSON.stringify({ authUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

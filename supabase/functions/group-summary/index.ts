// AI-generated summary of group activity and availability.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { groupId } = await req.json();
    if (!groupId) {
      return new Response(JSON.stringify({ error: "groupId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: grp }, { data: events }, { data: members }] = await Promise.all([
      userClient.from("groups").select("name").eq("id", groupId).single(),
      userClient.from("events").select("id, name, created_at").eq("group_id", groupId),
      userClient.from("user_groups").select("user_id").eq("group_id", groupId),
    ]);

    let totalParticipants = 0;
    if (events?.length) {
      const ids = events.map((e: any) => e.id);
      const { count } = await userClient
        .from("event_users")
        .select("*", { count: "exact", head: true })
        .in("event_id", ids);
      totalParticipants = count ?? 0;
    }

    const stats = {
      groupName: grp?.name ?? "el grupo",
      eventCount: events?.length ?? 0,
      memberCount: members?.length ?? 0,
      totalParticipations: totalParticipants,
      latestEvents: (events ?? []).slice(0, 5).map((e: any) => e.name).filter(Boolean),
    };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    let summary = `${stats.groupName} tiene ${stats.memberCount} miembros y ${stats.eventCount} eventos.`;

    if (LOVABLE_API_KEY) {
      try {
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "Eres un asistente que escribe resúmenes breves (2-3 frases) en español sobre la actividad de un grupo de coordinación de horarios. Tono cercano y motivador." },
              { role: "user", content: `Resume la actividad de este grupo:\n${JSON.stringify(stats)}` },
            ],
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const text = aiData?.choices?.[0]?.message?.content;
          if (typeof text === "string" && text.trim()) summary = text.trim();
        }
      } catch (e) {
        console.warn("AI summary failed:", e);
      }
    }

    return new Response(JSON.stringify({ summary, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
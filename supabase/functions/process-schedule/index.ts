// =============================================================================
// SECURITY CHECKLIST — Schedule OCR
// -----------------------------------------------------------------------------
// 1. Requires a valid Supabase JWT — no anonymous AI-credit burning.
// 2. Image payload size is capped (~6 MB base64) to prevent abuse.
// 3. LOVABLE_API_KEY is read from Lovable Cloud secrets only.
// 4. AI gateway responses are NOT echoed verbatim on error; sanitized status.
// =============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth gate
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
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(jwt);
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { imageBase64 } = await req.json();
    if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
      return new Response(JSON.stringify({ error: "No image provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (imageBase64.length > MAX_IMAGE_BYTES) {
      return new Response(JSON.stringify({ error: "Image too large" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Eres un asistente que extrae horarios de imágenes. Devuelve estrictamente un JSON con un arreglo 'events'. Cada evento debe tener: 'title' (string, nombre de la clase/actividad), 'dayOfWeek' (number, 1 para Lunes, 7 para Domingo), 'startHour' (number, formato 24h), 'startMinute' (number), 'endHour' (number, formato 24h), 'endMinute' (number). Solo devuelve el JSON, sin texto adicional ni markdown.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extrae todas las clases o actividades de este horario escolar/laboral. Devuelve el JSON con el arreglo 'events'." },
              {
                type: "image_url",
                image_url: {
                  url: imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_schedule",
            description: "Extract schedule events from an image",
            parameters: {
              type: "object",
              properties: {
                events: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      dayOfWeek: { type: "number" },
                      startHour: { type: "number" },
                      startMinute: { type: "number" },
                      endHour: { type: "number" },
                      endMinute: { type: "number" },
                    },
                    required: ["title", "dayOfWeek", "startHour", "startMinute", "endHour", "endMinute"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["events"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_schedule" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const schedule = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(schedule), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const content = data.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const schedule = JSON.parse(jsonMatch[0]);
      return new Response(JSON.stringify(schedule), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Could not extract schedule" }), {
      status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-schedule error:", (e as Error).name);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

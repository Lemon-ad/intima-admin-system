import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: existing } = await supabase
      .from("vapid_keys")
      .select("public_key")
      .limit(1)
      .maybeSingle();

    if (existing?.public_key) {
      return new Response(JSON.stringify({ public_key: existing.public_key }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate new VAPID keys
    const keys = webpush.generateVAPIDKeys();
    await supabase.from("vapid_keys").insert({
      public_key: keys.publicKey,
      private_key: keys.privateKey,
      subject: "mailto:admin@intima.local",
    });

    return new Response(JSON.stringify({ public_key: keys.publicKey }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

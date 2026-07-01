import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { member_id, subscription, user_agent, action } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "unsubscribe") {
      if (!subscription?.endpoint) throw new Error("endpoint required");
      await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!member_id || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      throw new Error("invalid subscription");
    }

    // Upsert by endpoint
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        member_id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: user_agent || null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

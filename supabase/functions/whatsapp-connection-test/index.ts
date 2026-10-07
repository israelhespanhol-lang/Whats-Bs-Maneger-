import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Authentication required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION");

  if (!accessToken || !graphVersion) {
    return json(
      {
        error: "WhatsApp secrets are not configured",
        missing: [
          !accessToken ? "WHATSAPP_ACCESS_TOKEN" : null,
          !graphVersion ? "WHATSAPP_GRAPH_VERSION" : null
        ].filter(Boolean)
      },
      503
    );
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Invalid session" }, 401);
  }

  const { data: account, error: accountError } = await client
    .from("whatsapp_accounts")
    .select("id,phone_number_id,status")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (accountError || !account) {
    return json({ error: "No WhatsApp account configured" }, 404);
  }

  const endpoint =
    `https://graph.facebook.com/${graphVersion}/${account.phone_number_id}?fields=display_phone_number,verified_name,quality_rating`;

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const payload = await response.json();

  if (!response.ok) {
    await client
      .from("whatsapp_accounts")
      .update({ status: "ERROR" })
      .eq("id", account.id);

    return json(
      {
        error: "Meta connection test failed",
        meta: {
          code: payload?.error?.code ?? null,
          message: payload?.error?.message ?? "Unknown error"
        }
      },
      502
    );
  }

  const { error: updateError } = await client
    .from("whatsapp_accounts")
    .update({
      status: "CONNECTED",
      display_phone_number: payload?.display_phone_number ?? null,
      verified_name: payload?.verified_name ?? null
    })
    .eq("id", account.id);

  if (updateError) {
    return json({ error: "Connection succeeded but status could not be saved" }, 500);
  }

  return json({
    ok: true,
    account: {
      id: account.id,
      status: "CONNECTED",
      display_phone_number: payload?.display_phone_number ?? null,
      verified_name: payload?.verified_name ?? null,
      quality_rating: payload?.quality_rating ?? null
    }
  });
});

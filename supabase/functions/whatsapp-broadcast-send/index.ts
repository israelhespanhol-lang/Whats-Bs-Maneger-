import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function hasVariables(value: string | null | undefined) {
  return /\{\{\d+\}\}/.test(value ?? "");
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

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
    return json({ error: "WhatsApp credentials are not configured" }, 503);
  }

  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const serviceKey = secretKeys
    ? JSON.parse(secretKeys)["default"]
    : legacyKey;

  if (!serviceKey) {
    return json({ error: "Supabase admin key unavailable" }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Invalid session" }, 401);
  }

  let body: { broadcastId?: string; confirm?: boolean; batchSize?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.broadcastId || body.confirm !== true) {
    return json(
      {
        error:
          "Explicit confirmation is required before starting a bulk send."
      },
      400
    );
  }

  const batchSize = Math.max(
    1,
    Math.min(Number(body.batchSize ?? 25) || 25, 50)
  );

  const { data: broadcast, error: broadcastError } = await userClient
    .from("broadcasts")
    .select(
      "id,organization_id,name,status,opt_in_confirmed,unit_cost_brl,template_id,message_templates(id,name,language,body,status,header_type,header_text,buttons)"
    )
    .eq("id", body.broadcastId)
    .maybeSingle();

  if (broadcastError || !broadcast) {
    return json({ error: "Broadcast not found or access denied" }, 404);
  }

  if (!broadcast.opt_in_confirmed) {
    return json(
      { error: "Opt-in confirmation is required for this broadcast." },
      409
    );
  }

  if (!["READY", "SENDING"].includes(broadcast.status)) {
    return json(
      {
        error:
          broadcast.status === "PAUSED"
            ? "This broadcast is paused."
            : "This broadcast cannot be started in its current state."
      },
      409
    );
  }

  const template = one(broadcast.message_templates as any);
  if (!template || template.status !== "APPROVED") {
    return json({ error: "The selected template is not approved." }, 409);
  }

  if (hasVariables(template.body) || hasVariables(template.header_text)) {
    return json(
      {
        error:
          "Este template possui variáveis. Configure os valores por destinatário antes de usar em disparo em massa."
      },
      409
    );
  }

  const { data: account, error: accountError } = await admin
    .from("whatsapp_accounts")
    .select("id,phone_number_id,status")
    .eq("organization_id", broadcast.organization_id)
    .eq("status", "CONNECTED")
    .limit(1)
    .maybeSingle();

  if (accountError || !account?.phone_number_id) {
    return json({ error: "Connected WhatsApp account not found." }, 409);
  }

  if (broadcast.status === "READY") {
    await admin
      .from("broadcasts")
      .update({
        status: "SENDING",
        started_at: new Date().toISOString()
      })
      .eq("id", broadcast.id);
  }

  await admin.rpc("release_stale_broadcast_recipients", {
    p_broadcast_id: broadcast.id,
    p_older_than: "10 minutes"
  });

  const { data: recipients, error: claimError } = await admin.rpc(
    "claim_broadcast_recipients",
    {
      p_broadcast_id: broadcast.id,
      p_limit: batchSize
    }
  );

  if (claimError) {
    return json({ error: claimError.message }, 500);
  }

  const claimed = recipients ?? [];

  if (claimed.length === 0) {
    await admin.rpc("refresh_broadcast_counters", {
      p_broadcast_id: broadcast.id
    });

    return json({
      ok: true,
      processed: 0,
      accepted: 0,
      failed: 0,
      remaining: 0,
      completed: true
    });
  }

  let accepted = 0;
  let failed = 0;

  for (const recipient of claimed) {
    const recipientId = recipient.id;
    const contactId = recipient.contact_id;
    const to = String(recipient.phone_e164 ?? "").replace(/\D/g, "");

    if (!to) {
      failed += 1;
      await admin
        .from("broadcast_recipients")
        .update({
          status: "FAILED",
          error_code: "INVALID_PHONE",
          error_message: "Recipient phone number is invalid."
        })
        .eq("id", recipientId);
      continue;
    }

    const metaResponse = await fetch(
      `https://graph.facebook.com/${graphVersion}/${account.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "template",
          template: {
            name: template.name,
            language: {
              code: template.language
            }
          }
        })
      }
    );

    const metaBody = await metaResponse.json();

    if (!metaResponse.ok || !metaBody?.messages?.[0]?.id) {
      failed += 1;
      const metaError = metaBody?.error;

      await admin
        .from("broadcast_recipients")
        .update({
          status: "FAILED",
          error_code: metaError?.code ? String(metaError.code) : "META_ERROR",
          error_message:
            metaError?.error_user_msg ??
            metaError?.message ??
            "Meta rejected the template message."
        })
        .eq("id", recipientId);

      continue;
    }

    accepted += 1;
    const whatsappMessageId = metaBody.messages[0].id;
    const now = new Date().toISOString();

    await admin
      .from("broadcast_recipients")
      .update({
        status: "SENT",
        whatsapp_message_id: whatsappMessageId,
        sent_at: now,
        error_code: null,
        error_message: null
      })
      .eq("id", recipientId);

    let { data: conversation } = await admin
      .from("conversations")
      .select("id")
      .eq("organization_id", broadcast.organization_id)
      .eq("whatsapp_account_id", account.id)
      .eq("contact_id", contactId)
      .maybeSingle();

    if (!conversation) {
      const { data: createdConversation, error: conversationError } =
        await admin
          .from("conversations")
          .insert({
            organization_id: broadcast.organization_id,
            whatsapp_account_id: account.id,
            contact_id: contactId,
            status: "OPEN",
            unread_count: 0,
            last_message_at: now,
            customer_service_window_expires_at: null
          })
          .select("id")
          .single();

      if (!conversationError) {
        conversation = createdConversation;
      } else if (conversationError.code === "23505") {
        const { data: recovered } = await admin
          .from("conversations")
          .select("id")
          .eq("organization_id", broadcast.organization_id)
          .eq("whatsapp_account_id", account.id)
          .eq("contact_id", contactId)
          .maybeSingle();

        conversation = recovered;
      }
    }

    if (conversation?.id) {
      await admin.from("messages").insert({
        organization_id: broadcast.organization_id,
        conversation_id: conversation.id,
        whatsapp_message_id: whatsappMessageId,
        direction: "OUTBOUND",
        message_type: "template",
        body: template.body,
        status: "SENT",
        sent_at: now,
        created_at: now,
        raw_payload: {
          provider: "meta",
          broadcast_id: broadcast.id,
          broadcast_recipient_id: recipientId,
          template: {
            name: template.name,
            language: template.language
          }
        }
      });

      await admin
        .from("conversations")
        .update({
          last_message_at: now,
          status: "OPEN"
        })
        .eq("id", conversation.id);
    }
  }

  await admin.rpc("refresh_broadcast_counters", {
    p_broadcast_id: broadcast.id
  });

  const { count: remaining } = await admin
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcast.id)
    .eq("status", "PENDING");

  return json({
    ok: true,
    processed: claimed.length,
    accepted,
    failed,
    remaining: remaining ?? 0,
    completed: (remaining ?? 0) === 0
  });
});

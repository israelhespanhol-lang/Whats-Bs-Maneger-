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
    return json({ error: "WhatsApp credentials are not configured" }, 503);
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Invalid session" }, 401);
  }

  let body: { conversationId?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const conversationId = body.conversationId?.trim();
  const text = body.text?.trim();

  if (!conversationId || !text) {
    return json({ error: "conversationId and text are required" }, 400);
  }

  if (text.length > 4096) {
    return json({ error: "Message exceeds 4096 characters" }, 400);
  }

  const { data: conversation, error: conversationError } = await client
    .from("conversations")
    .select(
      "id,organization_id,customer_service_window_expires_at,contacts(phone_e164),whatsapp_accounts(phone_number_id,status)"
    )
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationError || !conversation) {
    return json({ error: "Conversation not found or access denied" }, 404);
  }

  const contact = Array.isArray(conversation.contacts)
    ? conversation.contacts[0]
    : conversation.contacts;
  const account = Array.isArray(conversation.whatsapp_accounts)
    ? conversation.whatsapp_accounts[0]
    : conversation.whatsapp_accounts;

  if (!contact?.phone_e164 || !account?.phone_number_id) {
    return json({ error: "Conversation is missing WhatsApp routing data" }, 409);
  }

  if (account.status !== "CONNECTED") {
    return json({ error: "WhatsApp account is not connected" }, 409);
  }

  const expiresAt = conversation.customer_service_window_expires_at
    ? new Date(conversation.customer_service_window_expires_at).getTime()
    : 0;

  if (!expiresAt || expiresAt <= Date.now()) {
    return json(
      {
        error: "Customer service window is closed",
        code: "WINDOW_CLOSED",
        requiresTemplate: true
      },
      409
    );
  }

  const recipient = contact.phone_e164.replace(/^\+/, "");
  const endpoint = `https://graph.facebook.com/${graphVersion}/${account.phone_number_id}/messages`;

  const metaResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: {
        preview_url: false,
        body: text
      }
    })
  });

  const metaBody = await metaResponse.json();

  if (!metaResponse.ok) {
    return json(
      {
        error: "Meta rejected the message",
        meta: {
          code: metaBody?.error?.code ?? null,
          message: metaBody?.error?.message ?? "Unknown error"
        }
      },
      502
    );
  }

  const whatsappMessageId = metaBody?.messages?.[0]?.id ?? null;
  const now = new Date().toISOString();

  const { data: message, error: insertError } = await client
    .from("messages")
    .insert({
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      whatsapp_message_id: whatsappMessageId,
      direction: "OUTBOUND",
      message_type: "text",
      body: text,
      status: "PENDING",
      raw_payload: {
        provider: "meta",
        accepted: true
      },
      created_at: now
    })
    .select("id,direction,message_type,body,status,created_at")
    .single();

  if (insertError) {
    return json(
      {
        error: "Message sent by Meta but could not be persisted",
        whatsappMessageId
      },
      500
    );
  }

  await client
    .from("conversations")
    .update({
      last_message_at: now,
      status: "OPEN"
    })
    .eq("id", conversation.id);

  return json({
    ok: true,
    whatsappMessageId,
    message
  });
});

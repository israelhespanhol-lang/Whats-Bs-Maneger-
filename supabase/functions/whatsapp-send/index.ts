import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type AttachmentInput = {
  kind: "image" | "document";
  name: string;
  mimeType: string;
  dataBase64: string;
  caption?: string;
};

type SendBody = {
  conversationId?: string;
  text?: string;
  attachment?: AttachmentInput;
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

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Invalid session" }, 401);
  }

  let body: SendBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const conversationId = body.conversationId?.trim();
  const text = body.text?.trim();
  const attachment = body.attachment;

  if (!conversationId || (!text && !attachment)) {
    return json(
      { error: "conversationId and a message or attachment are required" },
      400
    );
  }

  if (text && text.length > 4096) {
    return json({ error: "Message exceeds 4096 characters" }, 400);
  }

  if (attachment) {
    if (!["image", "document"].includes(attachment.kind)) {
      return json({ error: "Unsupported attachment kind" }, 400);
    }

    if (
      attachment.kind === "image" &&
      !attachment.mimeType.startsWith("image/")
    ) {
      return json({ error: "Invalid image MIME type" }, 400);
    }

    if (
      attachment.kind === "document" &&
      attachment.mimeType !== "application/pdf"
    ) {
      return json({ error: "Only PDF documents are supported" }, 400);
    }

    if (!attachment.name || !attachment.dataBase64) {
      return json({ error: "Attachment data is incomplete" }, 400);
    }

    const estimatedBytes = Math.floor((attachment.dataBase64.length * 3) / 4);
    if (estimatedBytes > 5 * 1024 * 1024) {
      return json({ error: "Attachment exceeds 5 MB" }, 413);
    }

    if ((attachment.caption?.length ?? 0) > 1024) {
      return json({ error: "Attachment caption is too long" }, 400);
    }
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
    return json(
      { error: "Conversation is missing WhatsApp routing data" },
      409
    );
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
  const messagesEndpoint =
    `https://graph.facebook.com/${graphVersion}/${account.phone_number_id}/messages`;

  let metaPayload: Record<string, unknown>;
  let messageType = "text";
  let storedBody = text ?? null;
  let uploadedMediaId: string | null = null;

  if (attachment) {
    const bytes = decodeBase64(attachment.dataBase64);
    const uploadForm = new FormData();
    uploadForm.append("messaging_product", "whatsapp");
    uploadForm.append("type", attachment.mimeType);
    uploadForm.append(
      "file",
      new Blob([bytes], { type: attachment.mimeType }),
      attachment.name
    );

    const uploadResponse = await fetch(
      `https://graph.facebook.com/${graphVersion}/${account.phone_number_id}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        body: uploadForm
      }
    );

    const uploadBody = await uploadResponse.json();

    if (!uploadResponse.ok || !uploadBody?.id) {
      return json(
        {
          error: "Meta rejected the media upload",
          meta: {
            code: uploadBody?.error?.code ?? null,
            message: uploadBody?.error?.message ?? "Unknown media upload error"
          }
        },
        502
      );
    }

    uploadedMediaId = uploadBody.id;
    messageType = attachment.kind;
    storedBody =
      attachment.caption?.trim() || `📎 ${attachment.name}`;

    if (attachment.kind === "image") {
      metaPayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "image",
        image: {
          id: uploadedMediaId,
          ...(attachment.caption?.trim()
            ? { caption: attachment.caption.trim() }
            : {})
        }
      };
    } else {
      metaPayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "document",
        document: {
          id: uploadedMediaId,
          filename: attachment.name,
          ...(attachment.caption?.trim()
            ? { caption: attachment.caption.trim() }
            : {})
        }
      };
    }
  } else {
    metaPayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: {
        preview_url: false,
        body: text
      }
    };
  }

  const metaResponse = await fetch(messagesEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(metaPayload)
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
      message_type: messageType,
      body: storedBody,
      status: "PENDING",
      raw_payload: {
        provider: "meta",
        accepted: true,
        ...(attachment
          ? {
              attachment: {
                media_id: uploadedMediaId,
                name: attachment.name,
                mime_type: attachment.mimeType,
                kind: attachment.kind
              }
            }
          : {})
      },
      created_at: now
    })
    .select(
      "id,direction,message_type,body,status,created_at,sent_at,delivered_at,read_at"
    )
    .single();

  if (insertError) {
    if (whatsappMessageId) {
      const { data: existing } = await client
        .from("messages")
        .select(
          "id,direction,message_type,body,status,created_at,sent_at,delivered_at,read_at"
        )
        .eq("organization_id", conversation.organization_id)
        .eq("whatsapp_message_id", whatsappMessageId)
        .maybeSingle();

      if (existing) {
        return json({
          ok: true,
          whatsappMessageId,
          message: existing,
          recovered: true
        });
      }
    }

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
      last_message_preview: storedBody ?? `[${messageType}]`,
      last_message_direction: "OUTBOUND",
      status: "OPEN"
    })
    .eq("id", conversation.id);

  return json({
    ok: true,
    whatsappMessageId,
    message
  });
});

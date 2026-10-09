import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function verifySignature(req: Request, rawBody: string) {
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  const signature = req.headers.get("x-hub-signature-256");

  if (!appSecret || !signature?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody)
  );

  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return signature === `sha256=${hex}`;
}

function bodyFromMessage(message: Record<string, any>) {
  switch (message.type) {
    case "text":
      return message.text?.body ?? null;
    case "button":
      return message.button?.text ?? null;
    case "interactive":
      return (
        message.interactive?.button_reply?.title ??
        message.interactive?.list_reply?.title ??
        null
      );
    case "image":
      return message.image?.caption ?? null;
    case "document":
      return message.document?.caption ?? message.document?.filename ?? null;
    case "video":
      return message.video?.caption ?? null;
    default:
      return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

    if (
      mode === "subscribe" &&
      verifyToken &&
      token === verifyToken &&
      challenge
    ) {
      return new Response(challenge, { status: 200 });
    }

    return json({ error: "Webhook verification failed" }, 403);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const rawBody = await req.text();

  if (!(await verifySignature(req, rawBody))) {
    return json({ error: "Invalid signature" }, 401);
  }

  const payload = JSON.parse(rawBody);
  const url = Deno.env.get("SUPABASE_URL")!;
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const secretKey = secretKeys ? JSON.parse(secretKeys)["default"] : legacyKey;

  if (!secretKey) {
    return json({ error: "Supabase admin key unavailable" }, 500);
  }

  const admin = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let inserted = 0;
  let statusesUpdated = 0;
  const errors: Array<{ stage: string; message: string }> = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change?.value ?? {};
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: account, error: accountError } = await admin
        .from("whatsapp_accounts")
        .select("id,organization_id")
        .eq("phone_number_id", phoneNumberId)
        .eq("status", "CONNECTED")
        .maybeSingle();

      if (accountError) {
        errors.push({ stage: "account", message: accountError.message });
        continue;
      }
      if (!account) continue;

      const names = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact?.wa_id) {
          names.set(contact.wa_id, contact?.profile?.name ?? "");
        }
      }

      for (const message of value.messages ?? []) {
        const waId = message?.from;
        const whatsappMessageId = message?.id;
        if (!waId || !whatsappMessageId) continue;

        const phone = waId.startsWith("+") ? waId : `+${waId}`;
        const receivedAt = message.timestamp
          ? new Date(Number(message.timestamp) * 1000).toISOString()
          : new Date().toISOString();

        const { data: contact, error: contactError } = await admin
          .from("contacts")
          .upsert(
            {
              organization_id: account.organization_id,
              phone_e164: phone,
              name: names.get(waId) || null,
              source: "whatsapp",
              last_seen_at: receivedAt
            },
            { onConflict: "organization_id,phone_e164" }
          )
          .select("id")
          .single();

        if (contactError || !contact) {
          if (contactError) {
            errors.push({ stage: "contact", message: contactError.message });
          }
          continue;
        }

        let { data: conversation, error: conversationLookupError } = await admin
          .from("conversations")
          .select("id,unread_count")
          .eq("organization_id", account.organization_id)
          .eq("whatsapp_account_id", account.id)
          .eq("contact_id", contact.id)
          .maybeSingle();

        if (conversationLookupError) {
          errors.push({
            stage: "conversation_lookup",
            message: conversationLookupError.message
          });
          continue;
        }

        if (!conversation) {
          const { data: createdConversation, error: createConversationError } =
            await admin
              .from("conversations")
              .insert({
                organization_id: account.organization_id,
                whatsapp_account_id: account.id,
                contact_id: contact.id,
                status: "OPEN",
                unread_count: 0,
                last_message_at: receivedAt,
                last_message_preview: bodyFromMessage(message) ?? `[${message.type ?? "mensagem"}]`,
                last_message_direction: "INBOUND",
                customer_service_window_expires_at: new Date(
                  new Date(receivedAt).getTime() + 24 * 60 * 60 * 1000
                ).toISOString()
              })
              .select("id,unread_count")
              .single();

          if (createConversationError) {
            // Another message may have created the conversation concurrently.
            if (createConversationError.code === "23505") {
              const { data: concurrentConversation, error: recoveryError } =
                await admin
                  .from("conversations")
                  .select("id,unread_count")
                  .eq("organization_id", account.organization_id)
                  .eq("whatsapp_account_id", account.id)
                  .eq("contact_id", contact.id)
                  .maybeSingle();

              if (recoveryError || !concurrentConversation) {
                errors.push({
                  stage: "conversation_recovery",
                  message:
                    recoveryError?.message ??
                    "Conversation conflict could not be recovered"
                });
                continue;
              }

              conversation = concurrentConversation;
            } else {
              errors.push({
                stage: "conversation_insert",
                message: createConversationError.message
              });
              continue;
            }
          } else {
            conversation = createdConversation;
          }
        }

        if (!conversation) continue;

        // Explicit deduplication is used here because whatsapp_message_id has a
        // partial unique index. PostgREST upsert cannot reliably infer that
        // partial index from onConflict.
        const { data: existingMessage, error: dedupeError } = await admin
          .from("messages")
          .select("id")
          .eq("organization_id", account.organization_id)
          .eq("whatsapp_message_id", whatsappMessageId)
          .maybeSingle();

        if (dedupeError) {
          errors.push({ stage: "message_dedupe", message: dedupeError.message });
          continue;
        }

        if (existingMessage) continue;

        const { data: createdMessage, error: messageInsertError } = await admin
          .from("messages")
          .insert({
            organization_id: account.organization_id,
            conversation_id: conversation.id,
            whatsapp_message_id: whatsappMessageId,
            direction: "INBOUND",
            message_type: message.type ?? "unknown",
            body: bodyFromMessage(message),
            status: "DELIVERED",
            raw_payload: message,
            created_at: receivedAt
          })
          .select("id")
          .single();

        if (messageInsertError || !createdMessage) {
          if (messageInsertError) {
            errors.push({
              stage: "message_insert",
              message: messageInsertError.message
            });
          }
          continue;
        }

        inserted += 1;

        const windowExpiresAt = new Date(
          new Date(receivedAt).getTime() + 24 * 60 * 60 * 1000
        ).toISOString();

        const { error: conversationUpdateError } = await admin.rpc(
          "touch_conversation_inbound",
          {
            p_conversation_id: conversation.id,
            p_received_at: receivedAt,
            p_window_expires_at: windowExpiresAt
          }
        );

        if (conversationUpdateError) {
          errors.push({
            stage: "conversation_update",
            message: conversationUpdateError.message
          });
        } else {
          const { error: previewError } = await admin
            .from("conversations")
            .update({
              last_message_preview:
                bodyFromMessage(message) ?? `[${message.type ?? "mensagem"}]`,
              last_message_direction: "INBOUND"
            })
            .eq("id", conversation.id);

          if (previewError) {
            errors.push({
              stage: "conversation_preview_update",
              message: previewError.message
            });
          }
        }
      }

      for (const status of value.statuses ?? []) {
        if (!status?.id || !status?.status) continue;

        const mapped =
          status.status === "sent"
            ? "SENT"
            : status.status === "delivered"
              ? "DELIVERED"
              : status.status === "read"
                ? "READ"
                : status.status === "failed"
                  ? "FAILED"
                  : null;

        if (!mapped) continue;

        const patch: Record<string, any> = { status: mapped };
        const at = status.timestamp
          ? new Date(Number(status.timestamp) * 1000).toISOString()
          : new Date().toISOString();

        if (mapped === "SENT") patch.sent_at = at;
        if (mapped === "DELIVERED") patch.delivered_at = at;
        if (mapped === "READ") patch.read_at = at;

        if (mapped === "FAILED") {
          const err = status.errors?.[0];
          patch.error_code = err?.code ? String(err.code) : null;
          patch.error_message = err?.message ?? err?.title ?? null;
        }

        const { data: changed, error: statusUpdateError } = await admin
          .from("messages")
          .update(patch)
          .eq("organization_id", account.organization_id)
          .eq("whatsapp_message_id", status.id)
          .select("id");

        if (statusUpdateError) {
          errors.push({
            stage: "status_update",
            message: statusUpdateError.message
          });
          continue;
        }

        statusesUpdated += changed?.length ?? 0;

        const { data: broadcastRecipient, error: broadcastLookupError } =
          await admin
            .from("broadcast_recipients")
            .select("id,broadcast_id,status")
            .eq("whatsapp_message_id", status.id)
            .maybeSingle();

        if (broadcastLookupError) {
          errors.push({
            stage: "broadcast_status_lookup",
            message: broadcastLookupError.message
          });
          continue;
        }

        if (broadcastRecipient) {
          const rank: Record<string, number> = {
            PENDING: 0,
            PROCESSING: 0,
            SENT: 1,
            DELIVERED: 2,
            READ: 3,
            FAILED: 4,
            SKIPPED: 4
          };

          const shouldAdvance =
            mapped === "FAILED" ||
            (rank[mapped] ?? 0) >=
              (rank[broadcastRecipient.status] ?? 0);

          if (shouldAdvance) {
            const recipientPatch: Record<string, any> = {
              status: mapped,
              meta_billable:
                typeof status?.pricing?.billable === "boolean"
                  ? status.pricing.billable
                  : null,
              meta_pricing_category:
                status?.pricing?.category ?? null,
              meta_pricing_model:
                status?.pricing?.pricing_model ?? null
            };

            if (mapped === "SENT") {
              recipientPatch.sent_at = at;
            }

            if (mapped === "DELIVERED") {
              recipientPatch.delivered_at = at;
            }

            if (mapped === "READ") {
              recipientPatch.read_at = at;
              recipientPatch.delivered_at = at;
            }

            if (mapped === "FAILED") {
              const err = status.errors?.[0];
              recipientPatch.error_code = err?.code
                ? String(err.code)
                : null;
              recipientPatch.error_message =
                err?.message ?? err?.title ?? null;
            }

            const { error: recipientUpdateError } = await admin
              .from("broadcast_recipients")
              .update(recipientPatch)
              .eq("id", broadcastRecipient.id);

            if (recipientUpdateError) {
              errors.push({
                stage: "broadcast_status_update",
                message: recipientUpdateError.message
              });
            } else {
              const { error: counterError } = await admin.rpc(
                "refresh_broadcast_counters",
                {
                  p_broadcast_id: broadcastRecipient.broadcast_id
                }
              );

              if (counterError) {
                errors.push({
                  stage: "broadcast_counter_refresh",
                  message: counterError.message
                });
              }
            }
          }
        }
      }
    }
  }

  return json({
    received: true,
    inserted,
    statusesUpdated,
    errors: errors.length ? errors : undefined
  });
});

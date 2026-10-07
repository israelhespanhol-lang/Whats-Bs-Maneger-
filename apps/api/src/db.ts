import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function hasDatabaseConfig() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === "false"
          ? false
          : process.env.NODE_ENV === "production"
            ? { rejectUnauthorized: false }
            : undefined
    });
  }

  return pool;
}

export async function pingDatabase() {
  const result = await getPool().query("select now() as now");
  return result.rows[0]?.now as string | Date | undefined;
}

export async function listConversations(organizationId: string, limit = 50) {
  const result = await getPool().query(
    `
      select
        c.id,
        c.status,
        c.unread_count as "unreadCount",
        c.last_message_at as "lastMessageAt",
        c.customer_service_window_expires_at as "windowExpiresAt",
        ct.id as "contactId",
        ct.name as "contactName",
        ct.phone_e164 as "contactPhone",
        ct.avatar_url as "contactAvatarUrl",
        ct.status as "contactStatus",
        lm.body as "lastMessageBody",
        lm.direction as "lastMessageDirection",
        lm.message_type as "lastMessageType",
        u.name as "assigneeName"
      from conversations c
      join contacts ct on ct.id = c.contact_id
      left join organization_members om on om.id = c.assigned_member_id
      left join users u on u.id = om.user_id
      left join lateral (
        select m.body, m.direction, m.message_type
        from messages m
        where m.conversation_id = c.id
        order by m.created_at desc
        limit 1
      ) lm on true
      where c.organization_id = $1
      order by c.last_message_at desc nulls last, c.created_at desc
      limit $2
    `,
    [organizationId, Math.min(Math.max(limit, 1), 100)]
  );

  return result.rows;
}

export async function listMessages(
  organizationId: string,
  conversationId: string,
  limit = 200
) {
  const result = await getPool().query(
    `
      select
        id,
        whatsapp_message_id as "whatsappMessageId",
        direction,
        message_type as "messageType",
        body,
        media_url as "mediaUrl",
        status,
        error_code as "errorCode",
        error_message as "errorMessage",
        sent_at as "sentAt",
        delivered_at as "deliveredAt",
        read_at as "readAt",
        created_at as "createdAt"
      from messages
      where organization_id = $1
        and conversation_id = $2
      order by created_at asc
      limit $3
    `,
    [organizationId, conversationId, Math.min(Math.max(limit, 1), 500)]
  );

  return result.rows;
}

export async function createContact(input: {
  organizationId: string;
  phoneE164: string;
  name?: string | null;
  source?: string | null;
}) {
  const result = await getPool().query(
    `
      insert into contacts (organization_id, phone_e164, name, source)
      values ($1, $2, $3, $4)
      on conflict (organization_id, phone_e164)
      do update set
        name = coalesce(excluded.name, contacts.name),
        source = coalesce(excluded.source, contacts.source)
      returning
        id,
        phone_e164 as "phone",
        name,
        status,
        source,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [input.organizationId, input.phoneE164, input.name ?? null, input.source ?? null]
  );

  return result.rows[0];
}

function messageBody(message: Record<string, any>) {
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

function statusTimestamp(timestamp?: string) {
  if (!timestamp) return null;
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed * 1000);
}

export async function ingestWhatsAppWebhook(payload: Record<string, any>) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  let inboundInserted = 0;
  let statusesUpdated = 0;

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value ?? {};
      const phoneNumberId = value?.metadata?.phone_number_id;

      if (!phoneNumberId) continue;

      const accountResult = await getPool().query(
        `
          select id, organization_id
          from whatsapp_accounts
          where phone_number_id = $1
            and status = 'CONNECTED'
          limit 1
        `,
        [phoneNumberId]
      );

      const account = accountResult.rows[0];
      if (!account) continue;

      const contactsByWaId = new Map<string, string>();
      for (const contact of Array.isArray(value.contacts) ? value.contacts : []) {
        if (contact?.wa_id) {
          contactsByWaId.set(contact.wa_id, contact?.profile?.name ?? "");
        }
      }

      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const waId = message?.from;
        const whatsappMessageId = message?.id;
        if (!waId || !whatsappMessageId) continue;

        const phoneE164 = waId.startsWith("+") ? waId : `+${waId}`;
        const profileName = contactsByWaId.get(waId) || null;
        const receivedAt = statusTimestamp(message?.timestamp) ?? new Date();

        const client = await getPool().connect();
        try {
          await client.query("begin");

          const contactResult = await client.query(
            `
              insert into contacts (
                organization_id,
                phone_e164,
                name,
                source,
                last_seen_at
              )
              values ($1, $2, $3, 'whatsapp', $4)
              on conflict (organization_id, phone_e164)
              do update set
                name = coalesce(excluded.name, contacts.name),
                last_seen_at = excluded.last_seen_at
              returning id
            `,
            [account.organization_id, phoneE164, profileName, receivedAt]
          );

          const contactId = contactResult.rows[0].id;

          const conversationResult = await client.query(
            `
              insert into conversations (
                organization_id,
                whatsapp_account_id,
                contact_id,
                status,
                unread_count,
                last_message_at,
                customer_service_window_expires_at
              )
              values ($1, $2, $3, 'OPEN', 1, $4, $4 + interval '24 hours')
              on conflict (organization_id, whatsapp_account_id, contact_id)
              do update set
                status = 'OPEN',
                unread_count = conversations.unread_count + 1,
                last_message_at = excluded.last_message_at,
                customer_service_window_expires_at = excluded.customer_service_window_expires_at
              returning id
            `,
            [account.organization_id, account.id, contactId, receivedAt]
          );

          const conversationId = conversationResult.rows[0].id;

          const insertResult = await client.query(
            `
              insert into messages (
                organization_id,
                conversation_id,
                whatsapp_message_id,
                direction,
                message_type,
                body,
                status,
                raw_payload,
                created_at
              )
              values ($1, $2, $3, 'INBOUND', $4, $5, 'DELIVERED', $6::jsonb, $7)
              on conflict (organization_id, whatsapp_message_id)
              where whatsapp_message_id is not null
              do nothing
              returning id
            `,
            [
              account.organization_id,
              conversationId,
              whatsappMessageId,
              message?.type ?? "unknown",
              messageBody(message),
              JSON.stringify(message),
              receivedAt
            ]
          );

          if (insertResult.rowCount === 0) {
            await client.query(
              `
                update conversations
                set unread_count = greatest(unread_count - 1, 0)
                where id = $1
              `,
              [conversationId]
            );
          } else {
            inboundInserted += 1;
          }

          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
      }

      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!status?.id || !status?.status) continue;

        const mappedStatus =
          status.status === "sent"
            ? "SENT"
            : status.status === "delivered"
              ? "DELIVERED"
              : status.status === "read"
                ? "READ"
                : status.status === "failed"
                  ? "FAILED"
                  : null;

        if (!mappedStatus) continue;

        const timestamp = statusTimestamp(status.timestamp);
        const error = Array.isArray(status.errors) ? status.errors[0] : null;

        const updateResult = await getPool().query(
          `
            update messages
            set
              status = $1,
              sent_at = case when $1 = 'SENT' then coalesce($2, sent_at, now()) else sent_at end,
              delivered_at = case when $1 = 'DELIVERED' then coalesce($2, delivered_at, now()) else delivered_at end,
              read_at = case when $1 = 'READ' then coalesce($2, read_at, now()) else read_at end,
              error_code = case when $1 = 'FAILED' then $3 else error_code end,
              error_message = case when $1 = 'FAILED' then $4 else error_message end
            where organization_id = $5
              and whatsapp_message_id = $6
          `,
          [
            mappedStatus,
            timestamp,
            error?.code ? String(error.code) : null,
            error?.message ?? error?.title ?? null,
            account.organization_id,
            status.id
          ]
        );

        statusesUpdated += updateResult.rowCount ?? 0;
      }
    }
  }

  return { inboundInserted, statusesUpdated };
}

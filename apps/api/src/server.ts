import { createHmac, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rawBody from "fastify-raw-body";
import {
  createContact,
  hasDatabaseConfig,
  ingestWhatsAppWebhook,
  listConversations,
  listMessages,
  pingDatabase
} from "./db.js";

const app = Fastify({
  logger: {
    redact: [
      "req.headers.authorization",
      "req.headers.x-hub-signature-256",
      "body.entry"
    ]
  }
});

const allowedOrigins = process.env.WEB_ORIGIN
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

await app.register(cors, {
  origin:
    allowedOrigins && allowedOrigins.length > 0
      ? allowedOrigins
      : process.env.NODE_ENV === "production"
        ? false
        : true
});

await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: false,
  runFirst: true
});

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getOrganizationId(request: { headers: Record<string, unknown> }) {
  const header = request.headers["x-organization-id"];
  const candidate =
    (Array.isArray(header) ? header[0] : header) ??
    process.env.DEFAULT_ORGANIZATION_ID;

  if (typeof candidate !== "string" || !uuidPattern.test(candidate)) {
    return null;
  }

  return candidate;
}

function verifyMetaSignature(raw: Buffer | undefined, signature: unknown) {
  const secret = process.env.WHATSAPP_APP_SECRET;

  if (
    !secret ||
    !raw ||
    typeof signature !== "string" ||
    !signature.startsWith("sha256=")
  ) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret)
    .update(raw)
    .digest("hex")}`;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

app.get("/health", async () => {
  if (!hasDatabaseConfig()) {
    return {
      status: "ok",
      service: "whats-manager-api",
      database: "not_configured"
    };
  }

  try {
    await pingDatabase();
    return {
      status: "ok",
      service: "whats-manager-api",
      database: "connected"
    };
  } catch (error) {
    app.log.error({ err: error }, "Database health check failed");
    return {
      status: "degraded",
      service: "whats-manager-api",
      database: "unreachable"
    };
  }
});

app.get("/conversations", async (request, reply) => {
  if (!hasDatabaseConfig()) {
    return reply.code(503).send({ error: "Database is not configured" });
  }

  const organizationId = getOrganizationId(request);
  if (!organizationId) {
    return reply.code(400).send({
      error: "A valid x-organization-id header is required"
    });
  }

  const query = request.query as { limit?: string };
  const limit = Number(query.limit ?? 50);
  const conversations = await listConversations(
    organizationId,
    Number.isFinite(limit) ? limit : 50
  );

  return { conversations };
});

app.get("/conversations/:id/messages", async (request, reply) => {
  if (!hasDatabaseConfig()) {
    return reply.code(503).send({ error: "Database is not configured" });
  }

  const organizationId = getOrganizationId(request);
  if (!organizationId) {
    return reply.code(400).send({
      error: "A valid x-organization-id header is required"
    });
  }

  const params = request.params as { id: string };
  if (!uuidPattern.test(params.id)) {
    return reply.code(400).send({ error: "Invalid conversation id" });
  }

  const query = request.query as { limit?: string };
  const limit = Number(query.limit ?? 200);
  const messages = await listMessages(
    organizationId,
    params.id,
    Number.isFinite(limit) ? limit : 200
  );

  return { messages };
});

app.post("/contacts", async (request, reply) => {
  if (!hasDatabaseConfig()) {
    return reply.code(503).send({ error: "Database is not configured" });
  }

  const organizationId = getOrganizationId(request);
  if (!organizationId) {
    return reply.code(400).send({
      error: "A valid x-organization-id header is required"
    });
  }

  const body = request.body as {
    phone?: string;
    name?: string | null;
    source?: string | null;
  };

  const phone = body?.phone?.trim();
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    return reply.code(400).send({
      error: "phone must use E.164 format, for example +5548999999999"
    });
  }

  const contact = await createContact({
    organizationId,
    phoneE164: phone,
    name: body.name?.trim() || null,
    source: body.source?.trim() || null
  });

  return reply.code(201).send({ contact });
});

app.get("/webhooks/whatsapp", async (request, reply) => {
  const query = request.query as Record<string, string | undefined>;
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return reply.code(200).send(challenge);
  }

  return reply.code(403).send({ error: "Webhook verification failed" });
});

app.post(
  "/webhooks/whatsapp",
  { config: { rawBody: true } },
  async (request, reply) => {
    const raw = (request as typeof request & { rawBody?: Buffer }).rawBody;
    const signature = request.headers["x-hub-signature-256"];

    if (!verifyMetaSignature(raw, signature)) {
      return reply.code(401).send({ error: "Invalid webhook signature" });
    }

    if (!hasDatabaseConfig()) {
      app.log.error("WhatsApp webhook received before database configuration");
      return reply.code(503).send({ error: "Database is not configured" });
    }

    const payload = request.body as Record<string, any>;
    const result = await ingestWhatsAppWebhook(payload);

    app.log.info(
      {
        inboundInserted: result.inboundInserted,
        statusesUpdated: result.statusesUpdated
      },
      "WhatsApp webhook processed"
    );

    return reply.code(200).send({ received: true });
  }
);

const port = Number(process.env.API_PORT ?? 4000);

await app.listen({
  host: "0.0.0.0",
  port
});

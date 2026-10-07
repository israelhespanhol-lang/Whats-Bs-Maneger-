import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true
});

app.get("/health", async () => ({
  status: "ok",
  service: "whats-manager-api"
}));

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

app.post("/webhooks/whatsapp", async (request, reply) => {
  // Próximo marco:
  // 1. validar assinatura X-Hub-Signature-256;
  // 2. normalizar o payload da Meta;
  // 3. persistir contato/conversa/mensagem;
  // 4. publicar atualização em tempo real no dashboard.
  app.log.info({ payload: request.body }, "WhatsApp webhook received");

  return reply.code(200).send({ received: true });
});

const port = Number(process.env.API_PORT ?? 4000);

await app.listen({
  host: "0.0.0.0",
  port
});

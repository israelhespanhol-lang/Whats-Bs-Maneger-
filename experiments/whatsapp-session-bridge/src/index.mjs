/**
 * EXPERIMENTAL linked-device bridge — NOT an official Meta integration.
 * Loopback only; read-only by default; manual sends are separately gated.
 * Requires a WhatsApp Business app to link via QR. Cloud API alone is NOT enough.
 */
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, lstat, chmod } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { normalizeRecipient, formatManualReply, safeMessageText } from "./format.mjs";

process.umask(0o077);
const HOST = "127.0.0.1";
const port = Number(process.env.BRIDGE_PORT || "8787");
const token = process.env.BRIDGE_ADMIN_TOKEN || "";
const connectEnabled = process.env.BRIDGE_ENABLE_CONNECTION === "true";
const sendEnabled = process.env.BRIDGE_ENABLE_SEND === "true";
const allowlist = new Set(
  (process.env.BRIDGE_SEND_ALLOWLIST || "").split(",").map((value) => value.trim())
    .filter(Boolean).map(normalizeRecipient)
);
const sessionDir = process.env.BRIDGE_SESSION_DIR ||
  join(homedir(), ".mais-chat", "wa-session-bridge");

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("BRIDGE_PORT deve estar entre 1024 e 65535");
}
if (token.length < 32) {
  throw new Error("BRIDGE_ADMIN_TOKEN é obrigatório e exige pelo menos 32 caracteres aleatórios");
}
if (sendEnabled && (!connectEnabled || allowlist.size === 0)) {
  throw new Error("Enviar requer BRIDGE_ENABLE_CONNECTION=true e BRIDGE_SEND_ALLOWLIST não vazia");
}

let sock = null;
let state = connectEnabled ? "starting" : "disabled";
let qr = null;
let qrUpdatedAt = 0;
let lastError = null;
let stopping = false;
let connectInFlight = false;
let reconnectTimer = null;
let manualSendInFlight = false;
let lastManualSendAt = 0;
const events = [];
const receivedIds = new Set();

function isAuthorized(req) {
  const supplied = req.headers["x-bridge-token"];
  if (typeof supplied !== "string") return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function respond(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
  res.end(JSON.stringify(body));
}

async function requestJSON(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString("utf8");
    if (Buffer.byteLength(raw) > 8192) {
      throw new Error("Requisição excedeu limite de 8 KiB");
    }
  }
  const data = JSON.parse(raw || "null");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Formato de solicitação inválido");
  }
  return data;
}

async function prepareSessionDir() {
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  const stats = await lstat(sessionDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("BRIDGE_SESSION_DIR deve ser diretório real, sem link simbólico");
  }
  await chmod(sessionDir, 0o700);
}

function retainEvent(message) {
  const id = message?.key?.id;
  const jid = message?.key?.remoteJid;
  if (typeof id !== "string" || typeof jid !== "string" ||
      !jid.endsWith("@s.whatsapp.net") || receivedIds.has(id)) return;
  receivedIds.add(id);
  if (receivedIds.size > 1000) receivedIds.clear();
  events.unshift({
    id,
    number: jid.replace(/@s\.whatsapp\.net$/, ""),
    fromMe: message.key.fromMe === true,
    text: safeMessageText(message),
    receivedAt: new Date().toISOString()
  });
  if (events.length > 100) events.length = 100;
}

async function openSession() {
  if (!connectEnabled || stopping || connectInFlight) return;
  connectInFlight = true;
  state = "connecting";
  try {
    await prepareSessionDir();
    const { state: auth, saveCreds } = await useMultiFileAuthState(sessionDir);
    const candidate = makeWASocket({
      auth,
      browser: Browsers.ubuntu("Mais Chat Lab"),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false
    });
    sock = candidate;
    candidate.ev.on("creds.update", saveCreds);
    candidate.ev.on("messages.upsert", (payload) => {
      if (payload?.type !== "notify") return;
      for (const message of payload.messages || []) retainEvent(message);
    });
    candidate.ev.on("connection.update", (update) => {
      if (sock !== candidate || stopping) return;
      if (update.qr) {
        qr = update.qr;
        qrUpdatedAt = Date.now();
        state = "awaiting_pairing";
      }
      if (update.connection === "open") {
        qr = null;
        state = "connected";
        lastError = null;
      }
      if (update.connection === "close") {
        qr = null;
        sock = null;
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          state = "logged_out";
          lastError = "Sessão revogada: pare o processo e revise o vínculo";
          return;
        }
        state = "reconnecting";
        lastError = "Sessão desconectada; aguardando nova tentativa";
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void openSession();
          }, 8000);
        }
      }
    });
  } catch (error) {
    sock = null;
    qr = null;
    state = "error";
    lastError = "Falha ao criar ou restabelecer a sessão";
    console.error("[bridge] erro técnico ao conectar:", error instanceof Error ? error.message : "desconhecido");
  } finally {
    connectInFlight = false;
  }
}

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/health") {
      return respond(res, 200, {
        ok: true, mode: "experimental", state,
        appLinked: state === "connected",
        canSend: state === "connected" && sendEnabled && allowlist.size > 0,
        binding: "loopback_only"
      });
    }
    if (!isAuthorized(req)) return respond(res, 401, { error: "Acesso negado" });

    if (req.method === "GET" && pathname === "/v1/qr") {
      if (!qr || Date.now() - qrUpdatedAt > 60000) {
        return respond(res, 409, { error: "QR indisponível", state });
      }
      const svg = await QRCode.toString(qr, { type: "svg", margin: 2, width: 300 });
      res.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"
      });
      return res.end(svg);
    }
    if (req.method === "GET" && pathname === "/v1/events") {
      return respond(res, 200, { state, recent: events.slice(0, 100) });
    }
    if (req.method === "POST" && pathname === "/v1/manual-reply") {
      if (!sendEnabled) return respond(res, 403, { error: "Envio desativado neste experimento" });
      if (state !== "connected" || !sock) {
        return respond(res, 409, { error: "Sessão vinculada não está conectada" });
      }
      if (manualSendInFlight || Date.now() - lastManualSendAt < 3000) {
        return respond(res, 429, { error: "Aguarde antes da próxima mensagem" });
      }
      const payload = await requestJSON(req);
      if (payload.intent !== "manual_reply") {
        return respond(res, 422, { error: "Apenas resposta manual individual é permitida" });
      }
      const recipient = normalizeRecipient(payload.to);
      if (!allowlist.has(recipient)) {
        return respond(res, 403, { error: "Destinatário fora da lista de testes permitidos" });
      }
      const body = formatManualReply(payload.agent, payload.text);
      manualSendInFlight = true;
      lastManualSendAt = Date.now();
      try {
        const ack = await sock.sendMessage(recipient + "@s.whatsapp.net", { text: body });
        return respond(res, 200, { ok: true, id: ack?.key?.id ?? null });
      } finally {
        manualSendInFlight = false;
      }
    }
    return respond(res, 404, { error: "Endpoint desconhecido" });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Requisição inválida";
    return respond(res, 400, { error: errorText });
  }
});

server.requestTimeout = 10000;
server.listen(port, HOST, () => {
  console.info("[bridge] laboratório iniciado somente em 127.0.0.1:" + port);
  console.info("[bridge] conexão:", connectEnabled ? "permitida" : "desligada",
    "| envio individual:", sendEnabled ? "restrito a testes" : "desligado");
  if (connectEnabled) void openSession();
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    server.close(() => process.exit(0));
  });
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

function result(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

const safeMime = new Set([
  "image/jpeg","image/png","image/webp","audio/ogg","audio/mpeg","audio/mp4",
  "audio/aac","audio/amr","video/mp4","application/pdf","text/plain",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const maximumBytes = 20 * 1024 * 1024;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return result({ error: "Método inválido." }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return result({ error: "Sessão necessária." }, 401);

  let messageId: string;
  try {
    const body = await request.json();
    messageId = typeof body.messageId === "string" ? body.messageId : "";
  } catch {
    return result({ error: "Solicitação inválida." }, 400);
  }
  if (!/^[a-f0-9-]{36}$/i.test(messageId)) return result({ error: "Identificador de mídia inválido." }, 400);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const metaToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION");
  if (!url || !anon || !metaToken || !graphVersion) return result({ error: "Serviço de mídia indisponível." }, 503);

  const db = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) return result({ error: "Sessão expirada." }, 401);

  const { data: message, error: lookupError } = await db.from("messages")
    .select("id,organization_id,conversation_id,message_type,raw_payload")
    .eq("id", messageId).maybeSingle();
  if (lookupError || !message) return result({ error: "Mídia não encontrada nesta equipe." }, 404);

  const { data: membership } = await db.from("organization_members")
    .select("id").eq("organization_id", message.organization_id)
    .eq("user_id", auth.user.id).maybeSingle();
  if (!membership) return result({ error: "Acesso à mídia não autorizado." }, 403);

  // Only an ID obtained from this organization's stored Meta webhook/upload is used.
  const payload = message.raw_payload as Record<string, any> | null;
  const kind = String(message.message_type || "");
  const embedded = payload?.[kind];
  const mediaId = payload?.attachment?.media_id ?? embedded?.id;
  if (!["image","document","audio","video","sticker"].includes(kind) ||
      typeof mediaId !== "string" || !/^[a-z0-9_-]{4,128}$/i.test(mediaId)) {
    return result({ error: "Este arquivo não possui uma referência de mídia disponível." }, 404);
  }

  const graphHeaders = { Authorization: "Bearer " + metaToken };
  const metadata = await fetch("https://graph.facebook.com/" + encodeURIComponent(graphVersion) + "/" + encodeURIComponent(mediaId), {
    headers: graphHeaders, signal: AbortSignal.timeout(12000)
  });
  if (!metadata.ok) return result({ error: "A Meta não disponibilizou esta mídia. Ela pode ter expirado." }, 404);
  const info = await metadata.json();
  if (typeof info.url !== "string") return result({ error: "URL de mídia inválida." }, 502);

  let mediaUrl: URL;
  try { mediaUrl = new URL(info.url); }
  catch { return result({ error: "Endereço de mídia inválido." }, 502); }
  const host = mediaUrl.hostname.toLowerCase();
  if (mediaUrl.protocol !== "https:" ||
      !(host === "lookaside.fbsbx.com" || host.endsWith(".fbsbx.com") ||
        host === "graph.facebook.com" || host.endsWith(".fbcdn.net") ||
        host.endsWith(".facebook.com"))) {
    return result({ error: "Domínio de mídia não autorizado." }, 502);
  }
  if (typeof info.file_size === "number" && info.file_size > maximumBytes) {
    return result({ error: "Arquivo muito grande para visualização no chat (limite 20 MB)." }, 413);
  }

  const downloaded = await fetch(mediaUrl.toString(), {
    headers: graphHeaders, redirect: "error", signal: AbortSignal.timeout(25000)
  });
  if (!downloaded.ok) return result({ error: "Não foi possível recuperar esta mídia da Meta." }, 502);
  const reportedBytes = Number(downloaded.headers.get("content-length") || "0");
  if (reportedBytes > maximumBytes) return result({ error: "Arquivo excede 20 MB." }, 413);

  const mime = String(info.mime_type || downloaded.headers.get("content-type") || "application/octet-stream")
    .split(";")[0].trim().toLowerCase();
  if (!safeMime.has(mime)) return result({ error: "Formato de mídia não disponível para visualização." }, 415);
  const bytes = await downloaded.arrayBuffer();
  if (bytes.byteLength > maximumBytes) return result({ error: "Arquivo excede 20 MB." }, 413);

  return new Response(bytes, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "attachment"
    }
  });
});

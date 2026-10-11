import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Read/update ONLY the public WhatsApp Business profile picture of the
 * selected connected account. Never writes contacts, users, or messages.
 * The Meta access token and upload handle stay server-side.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function metaError(data: any, fallback: string) {
  const error = data?.error;
  const code = error?.code ? ` (Meta ${error.code})` : "";
  return `${error?.error_user_msg || error?.message || fallback}${code}`;
}

async function metaJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function validatePhotoBytes(bytes: Uint8Array, type: string) {
  if (bytes.byteLength < 4 || bytes.byteLength > MAX_BYTES) return false;
  if (type === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 &&
      bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a
    );
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Método não permitido." }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return reply({ error: "Faça login para gerenciar o perfil comercial." }, 401);
  }

  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const version = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v25.0";
  const appId = Deno.env.get("WHATSAPP_APP_ID") || "app";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

  if (!token || !supabaseUrl || !anonKey) {
    return reply({
      error: "A integração da Meta não está configurada no servidor."
    }, 503);
  }
  if (!/^v\d+\.\d+$/.test(version) || !/^(?:app|\d+)$/.test(appId)) {
    return reply({ error: "Configuração da API da Meta inválida." }, 503);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Envie um pedido JSON válido." }, 400);
  }

  const accountId = typeof body?.accountId === "string" ? body.accountId : "";
  const action = body?.action === "update" ? "update" : body?.action === "get" ? "get" : null;
  if (!action || !/^[0-9a-f-]{36}$/i.test(accountId)) {
    return reply({ error: "Conta ou operação inválida." }, 400);
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userResult, error: authError } = await client.auth.getUser();
  if (authError || !userResult.user) {
    return reply({ error: "Sessão inválida. Faça login novamente." }, 401);
  }

  const { data: account, error: accountError } = await client
    .from("whatsapp_accounts")
    .select("id,organization_id,phone_number_id,display_phone_number,status")
    .eq("id", accountId)
    .maybeSingle();
  if (accountError || !account) {
    return reply({ error: "Este canal não está disponível na sua organização." }, 404);
  }

  const { data: membership, error: membershipError } = await client
    .from("organization_members")
    .select("role")
    .eq("organization_id", account.organization_id)
    .eq("user_id", userResult.user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    return reply({ error: "Você não tem acesso a este canal." }, 403);
  }
  if (action === "update" && !["OWNER", "ADMIN"].includes(membership.role)) {
    return reply({ error: "Somente proprietários e administradores podem alterar a foto comercial." }, 403);
  }
  if (!account.phone_number_id || account.status !== "CONNECTED") {
    return reply({ error: "Conecte o número de WhatsApp antes de alterar sua foto." }, 409);
  }

  const base = `https://graph.facebook.com/${version}`;
  const headers = { Authorization: `Bearer ${token}` };
  const profileEndpoint = `${base}/${account.phone_number_id}/whatsapp_business_profile`;

  async function getProfile() {
    const url = new URL(profileEndpoint);
    url.searchParams.set("fields", "profile_picture_url");
    const response = await fetch(url, { headers });
    const result = await metaJson(response);
    if (!response.ok) {
      return { error: metaError(result, "Não foi possível consultar a foto comercial."), code: response.status };
    }
    return {
      profilePictureUrl: typeof result?.data?.[0]?.profile_picture_url === "string"
        ? result.data[0].profile_picture_url : null,
      phoneNumber: account.display_phone_number || null
    };
  }

  if (action === "get") {
    try {
      const profile = await getProfile();
      if ("error" in profile) return reply({ error: profile.error }, profile.code);
      return reply(profile);
    } catch {
      return reply({ error: "Erro de conexão ao consultar o perfil comercial." }, 502);
    }
  }

  if (body.confirm !== true) {
    return reply({ error: "Confirme a alteração da foto comercial." }, 400);
  }
  const mime = body.mimeType;
  const b64 = body.dataBase64;
  if (
    !IMAGE_TYPES.has(mime) ||
    typeof b64 !== "string" ||
    b64.length === 0 ||
    b64.length > Math.ceil(MAX_BYTES * 4 / 3) + 16
  ) {
    return reply({ error: "Escolha uma imagem JPG ou PNG com até 4 MB." }, 400);
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(b64);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return reply({ error: "Os dados da imagem são inválidos." }, 400);
  }
  if (!validatePhotoBytes(bytes, mime)) {
    return reply({ error: "A imagem não é um JPG/PNG válido ou excede 4 MB." }, 400);
  }

  try {
    // Meta's official Cloud API Postman collection uses /app/uploads.
    // WHATSAPP_APP_ID (numeric) can override the alias if an account needs it.
    const uploadUrl = new URL(`${base}/${appId}/uploads`);
    uploadUrl.searchParams.set("file_length", String(bytes.byteLength));
    uploadUrl.searchParams.set("file_type", mime);
    uploadUrl.searchParams.set("file_name", mime === "image/png" ? "perfil-comercial.png" : "perfil-comercial.jpg");

    const sessionResponse = await fetch(uploadUrl, {
      method: "POST", headers
    });
    const sessionResult = await metaJson(sessionResponse);
    if (!sessionResponse.ok || !sessionResult?.id) {
      return reply({
        error: metaError(sessionResult, "A Meta não iniciou o upload da foto."),
        hint: "Verifique a permissão whatsapp_business_management do token e, se necessário, configure WHATSAPP_APP_ID nos Secrets."
      }, 502);
    }
    const sessionId = String(sessionResult.id);
    if (!/^upload:[A-Za-z0-9.:_+\-?=&%]+$/.test(sessionId)) {
      return reply({ error: "A Meta retornou uma sessão de upload inválida." }, 502);
    }

    const uploadResponse = await fetch(`${base}/${sessionId}`, {
      method: "POST",
      headers: {
        ...headers,
        "file_offset": "0",
        "Content-Type": mime
      },
      body: bytes
    });
    const uploaded = await metaJson(uploadResponse);
    if (!uploadResponse.ok || typeof uploaded?.h !== "string") {
      return reply({
        error: metaError(uploaded, "A Meta não concluiu o upload da imagem.")
      }, 502);
    }

    const applyResponse = await fetch(profileEndpoint, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        profile_picture_handle: uploaded.h
      })
    });
    const applied = await metaJson(applyResponse);
    if (!applyResponse.ok || applied?.success !== true) {
      return reply({
        error: metaError(applied, "A Meta não confirmou a atualização do perfil.")
      }, 502);
    }

    // URL from the Meta API may take time to change; never interpret a
    // temporary stale URL as failure after a successful update.
    let profilePictureUrl: string | null = null;
    try {
      const fresh = await getProfile();
      if ("profilePictureUrl" in fresh) profilePictureUrl = fresh.profilePictureUrl;
    } catch {
      /* Update already accepted by Meta. */
    }

    return reply({
      success: true,
      profilePictureUrl,
      message: "A Meta confirmou a atualização da foto comercial. A nova imagem pode levar alguns minutos para aparecer no WhatsApp."
    });
  } catch {
    return reply({
      error: "Falha de conexão com a Meta ao atualizar a foto comercial."
    }, 502);
  }
});

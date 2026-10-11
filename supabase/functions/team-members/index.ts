import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Role = "OWNER" | "ADMIN" | "AGENT";
type RequestBody = {
  action?: "list" | "invite" | "changeRole" | "remove" | "activate";
  organizationId?: string;
  email?: string;
  name?: string;
  role?: Role;
  memberId?: string;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const uuid = (value: unknown) => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const emailValid = (email: string) => /^[^\s@%]{1,100}@[^\s@%]+\.[^\s@%]+$/.test(email) && email.length <= 254;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return respond({ error: "Método inválido." }, 405);

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return respond({ error: "Faça login para gerenciar a equipe." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceRole) return respond({ error: "O gerenciamento da equipe não está configurado no servidor." }, 503);

  let body: RequestBody;
  try { body = await request.json(); }
  catch { return respond({ error: "Solicitação inválida." }, 400); }

  const action = body?.action;
  if (!["list", "invite", "changeRole", "remove", "activate"].includes(action ?? "")) {
    return respond({ error: "Operação de equipe inválida." }, 400);
  }

  const session = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authResult, error: authError } = await session.auth.getUser();
  if (authError || !authResult.user) return respond({ error: "Sessão inválida. Entre novamente." }, 401);

  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const actingId = authResult.user.id;

  if (action === "activate") {
    const { data: memberRows } = await admin.from("organization_members")
      .select("organization_id").eq("user_id", actingId);
    for (const row of memberRows ?? []) {
      await admin.from("team_invitations").update({ accepted_at: new Date().toISOString() })
        .eq("organization_id", row.organization_id).eq("user_id", actingId).is("accepted_at", null);
    }
    return respond({ ok: true });
  }

  if (!uuid(body?.organizationId)) return respond({ error: "Organização inválida." }, 400);
  const orgId = body.organizationId as string;
  const { data: actor, error: membershipError } = await admin.from("organization_members")
    .select("id,role").eq("organization_id", orgId).eq("user_id", actingId).maybeSingle();
  if (membershipError || !actor) return respond({ error: "Você não pertence a essa equipe." }, 403);
  const actorRole = actor.role as Role;

  if (action === "list") {
    const [membersResult, invitationsResult] = await Promise.all([
      admin.from("organization_members")
        .select("id,user_id,role,created_at,users(name,email)")
        .eq("organization_id", orgId).order("created_at", { ascending: true }),
      admin.from("team_invitations")
        .select("user_id,created_at,accepted_at")
        .eq("organization_id", orgId)
    ]);
    if (membersResult.error || invitationsResult.error) {
      return respond({ error: "Não foi possível carregar os membros da equipe." }, 500);
    }
    const inviteByUser = new Map((invitationsResult.data ?? []).map((x) => [x.user_id, x]));
    const members = (membersResult.data ?? []).map((row) => {
      const user = Array.isArray(row.users) ? row.users[0] : row.users;
      const invite = inviteByUser.get(row.user_id);
      return {
        id: row.id,
        userId: row.user_id,
        name: user?.name || "Usuário",
        email: user?.email || "",
        role: row.role,
        status: invite && !invite.accepted_at ? "PENDING" : "ACTIVE",
        invitedAt: invite?.created_at ?? null
      };
    });
    return respond({ ok: true, members });
  }

  if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
    return respond({ error: "Somente administradores podem gerenciar a equipe." }, 403);
  }

  if (action === "invite") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim().slice(0, 100);
    const role = body.role;
    if (!emailValid(email) || !["AGENT", "ADMIN"].includes(role ?? "")) {
      return respond({ error: "Informe um e-mail válido e a função do atendente." }, 400);
    }
    if (role === "ADMIN" && actorRole !== "OWNER") {
      return respond({ error: "Somente o proprietário pode convidar administradores." }, 403);
    }

    const recentTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentInvites } = await admin.from("team_invitations")
      .select("id", { head: true, count: "exact" })
      .eq("organization_id", orgId).gte("created_at", recentTime);
    if ((recentInvites ?? 0) >= 20) return respond({ error: "Limite de 20 convites por hora. Tente mais tarde." }, 429);

    // Existing Supabase users can be joined without touching their password.
    const { data: existingProfile, error: profileError } = await admin.from("users")
      .select("id").eq("email", email).maybeSingle();
    if (profileError) return respond({ error: "Não foi possível verificar esse e-mail." }, 500);

    let targetId = existingProfile?.id as string | undefined;
    let emailSent = false;

    if (!targetId) {
      const appUrl = Deno.env.get("MAIS_CHAT_APP_URL") || "https://whats-bs-manager.vercel.app";
      const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: appUrl + "/",
        data: name ? { name } : undefined
      });
      if (inviteError || !invite.user) {
        return respond({ error: inviteError?.message || "Não foi possível enviar o convite por e-mail. Verifique o envio de e-mails do Supabase." }, 422);
      }
      targetId = invite.user.id;
      emailSent = true;
    }
    const { data: hasMembership, error: lookupError } = await admin.from("organization_members")
      .select("id").eq("organization_id", orgId).eq("user_id", targetId).maybeSingle();
    if (lookupError) return respond({ error: "Falha ao verificar o usuário convidado." }, 500);
    if (hasMembership) return respond({ error: "Esse e-mail já faz parte da equipe." }, 409);

    const { error: insertError } = await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: targetId,
      role
    });
    if (insertError) return respond({ error: "O convite foi solicitado, mas não foi possível associar o usuário. Tente novamente." }, 500);

    if (emailSent) {
      const { error: statusError } = await admin.from("team_invitations").upsert({
        organization_id: orgId,
        user_id: targetId,
        email,
        role,
        invited_by: actingId,
        accepted_at: null,
        created_at: new Date().toISOString()
      }, { onConflict: "organization_id,user_id" });
      if (statusError) {
        return respond({ ok: true, emailed: true, warning: "Convite enviado, mas não foi possível salvar o status pendente." });
      }
    }
    return respond({
      ok: true,
      emailed: emailSent,
      message: emailSent
        ? "Convite enviado por e-mail. O atendente já está associado à equipe e poderá acessar após autenticar."
        : "Este e-mail já tinha uma conta. O usuário foi adicionado à equipe e pode entrar com suas credenciais."
    });
  }

  if (!uuid(body?.memberId)) return respond({ error: "Membro inválido." }, 400);
  const { data: target } = await admin.from("organization_members")
    .select("id,user_id,role").eq("id", body.memberId).eq("organization_id", orgId).maybeSingle();
  if (!target) return respond({ error: "Membro não encontrado nesta equipe." }, 404);
  if (target.user_id === actingId) return respond({ error: "Não é possível alterar seu próprio acesso aqui." }, 403);
  if (target.role === "OWNER") return respond({ error: "O proprietário não pode ser alterado ou removido." }, 403);
  if (actorRole === "ADMIN" && target.role !== "AGENT") {
    return respond({ error: "Administradores só podem remover atendentes." }, 403);
  }

  if (action === "changeRole") {
    if (actorRole !== "OWNER" || !["AGENT", "ADMIN"].includes(body.role ?? "")) {
      return respond({ error: "Somente o proprietário pode alterar funções de acesso." }, 403);
    }
    const { error } = await admin.from("organization_members").update({ role: body.role })
      .eq("id", target.id).eq("organization_id", orgId);
    if (error) return respond({ error: "Falha ao atualizar a permissão." }, 500);
    await admin.from("team_invitations").update({ role: body.role })
      .eq("organization_id", orgId).eq("user_id", target.user_id);
    return respond({ ok: true, message: "Permissão atualizada." });
  }

  const { error: removeError } = await admin.from("organization_members").delete()
    .eq("id", target.id).eq("organization_id", orgId);
  if (removeError) return respond({ error: "Não foi possível revogar o acesso." }, 500);
  await admin.from("team_invitations").delete()
    .eq("organization_id", orgId).eq("user_id", target.user_id);
  return respond({ ok: true, message: "Acesso revogado. O histórico de conversas permanece preservado." });
});

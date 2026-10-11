"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SectionLayout from "./section-layout";
import { supabase } from "../lib/supabase";
import { useMaisChatContext } from "../lib/use-mais-chat-context";

type Role = "OWNER" | "ADMIN" | "AGENT";
type InviteFeedback = { kind: "success" | "info" | "error"; text: string };
type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: "PENDING" | "ACTIVE";
  invitedAt: string | null;
};
const roleNames: Record<Role, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  AGENT: "Atendente"
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

// HTTP status errors from Supabase Functions keep the JSON error in context,
// instead of in data. Read it to show the useful server message.
async function teamErrorMessage(data: { error?: string } | null, error: unknown, fallback: string) {
  if (data?.error) return data.error;
  if (error && typeof error === "object" && "context" in error) {
    const response = (error as { context?: Response }).context;
    if (response && typeof response.clone === "function") {
      try {
        const payload = await response.clone().json();
        if (typeof payload?.error === "string") return payload.error;
      } catch {
        // Keep a generic error if the server did not return JSON.
      }
    }
  }
  return error instanceof Error ? error.message : fallback;
}

export default function SettingsClient() {
  const ctx = useMaisChatContext();
  const organizationId = ctx.membership?.organization_id ?? null;
  const [members, setMembers] = useState<Member[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<InviteFeedback | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [teamLoading, setTeamLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const canManage = ctx.membership?.role === "OWNER" || ctx.membership?.role === "ADMIN";
  const memberWithEmail = email.trim()
    ? members.find((member) => member.email.trim().toLowerCase() === email.trim().toLowerCase())
    : null;

  const loadMembers = useCallback(async () => {
    if (!organizationId) return;
    setTeamLoading(true);
    const { data, error } = await supabase.functions.invoke("team-members", {
      body: { action: "list", organizationId }
    });
    if (error || !data?.ok) {
      setMembersError(await teamErrorMessage(data, error, "Não foi possível consultar a equipe."));
    } else {
      setMembers((data.members || []) as Member[]);
      setMembersError(null);
    }
    setTeamLoading(false);
  }, [organizationId]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !canManage || working || teamLoading) return;

    if (memberWithEmail) {
      setInviteFeedback({
        kind: "info",
        text: memberWithEmail.status === "PENDING"
          ? "Este endereço já possui um convite pendente. Não foi enviado outro e-mail."
          : "Este endereço já faz parte da equipe. Nenhum novo e-mail foi enviado. Para testar o convite, utilize um endereço que ainda não esteja cadastrado no Mais Chat."
      });
      return;
    }

    setWorking(true);
    setInviteFeedback(null);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("team-members", {
        body: {
          action: "invite", organizationId,
          email: email.trim(), name: name.trim(),
          role: ctx.membership?.role === "OWNER" ? inviteRole : "AGENT"
        }
      });
      if (error || !data?.ok) {
        const detail = await teamErrorMessage(data, error, "Não foi possível processar o convite.");
        setInviteFeedback({ kind: "error", text: detail });
        return;
      }
      setInviteFeedback(data.emailed
        ? {
            kind: data.warning ? "info" : "success",
            text: data.warning || "Convite solicitado ao serviço de e-mail. Verifique a caixa de entrada e o spam do destinatário."
          }
        : {
            kind: "info",
            text: "Essa pessoa já tinha uma conta no Mais Chat. O acesso à equipe foi associado à conta existente, sem envio de um novo e-mail. Ela pode entrar usando seu login atual."
          });
      setEmail("");
      setName("");
      setInviteRole("AGENT");
      await loadMembers();
    } catch (cause) {
      setInviteFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Erro inesperado ao criar o convite."
      });
    } finally {
      setWorking(false);
    }
  }

  async function manageMember(member: Member, action: "changeRole" | "remove", role?: Role) {
    if (!organizationId || !canManage || working) return;
    setWorking(true);
    setMessage(null);
    const { data, error } = await supabase.functions.invoke("team-members", {
      body: { action, organizationId, memberId: member.id, role }
    });
    if (error || !data?.ok) {
      setMessage(await teamErrorMessage(data, error, "Não foi possível alterar o integrante."));
    } else {
      setMessage(data.message || "Equipe atualizada.");
      await loadMembers();
    }
    setRemoveId(null);
    setWorking(false);
  }

  const organization = one(ctx.membership?.organizations ?? null);
  const connected = ctx.account?.status === "CONNECTED";

  return (
    <SectionLayout
      active="settings"
      loading={ctx.loading}
      membership={ctx.membership}
      account={ctx.account}
      userName={ctx.userName}
      unread={ctx.unread}
      error={ctx.error}
      onSignOut={() => void ctx.signOut()}
      eyebrow="ADMINISTRAÇÃO"
      title="Configurações"
      description="Gerencie a operação, a conexão do WhatsApp e os acessos da equipe."
    >
      <div className="settingsOverviewGrid">
        <Link className="settingsHubCard" href="/settings/whatsapp" prefetch>
          <div className="settingsHubIcon">◉</div>
          <div>
            <span>Canal</span>
            <h3>WhatsApp Cloud API</h3>
            <p>
              {connected
                ? `Conectado em ${ctx.account?.display_phone_number || "Mais Viagens"}`
                : "Revisar conexão do WhatsApp"}
            </p>
          </div>
          <strong>→</strong>
        </Link>

        <article className="settingsHubCard staticCard">
          <div className="settingsHubIcon">◇</div>
          <div>
            <span>Organização</span>
            <h3>{organization?.name || "Mais Viagens"}</h3>
            <p>Ambiente isolado para dados, contatos e conversas.</p>
          </div>
          <span className="statePill state-connected">Ativa</span>
        </article>

        <article className="settingsHubCard staticCard">
          <div className="settingsHubIcon">◎</div>
          <div>
            <span>Sessão</span>
            <h3>{ctx.userName}</h3>
            <p>Nível de acesso: {roleNames[ctx.membership?.role || "AGENT"]}</p>
          </div>
          <span className="statePill state-ready">Seguro</span>
        </article>

        <article className="settingsHubCard staticCard">
          <div className="settingsHubIcon">↻</div>
          <div>
            <span>Tempo real</span>
            <h3>Supabase Realtime</h3>
            <p>Conversas, mensagens e contatos sincronizados ao vivo.</p>
          </div>
          <span className="statePill state-connected">Online</span>
        </article>
      </div>

      <div className="settingsDetailGrid">
        <section className="dataCard settingsPanelCard">
          <div className="reportCardHeader">
            <div>
              <p className="eyebrow">EQUIPE</p>
              <h2>Usuários e permissões</h2>
            </div>
            <span>{members.length} integrante{members.length === 1 ? "" : "s"}</span>
          </div>

          <p className="teamHelpText">Cada integrante tem seu próprio login e atende pelo WhatsApp da empresa.</p>

          {canManage && (
            <form className="teamInviteForm" onSubmit={(event) => void invite(event)}>
              <div className="teamInviteTitle">
                <strong>Convidar integrante</strong>
                <span>Envie um convite por e-mail para acessar o Mais Chat.</span>
              </div>
              <div className="teamInviteFields">
                <label>
                  Nome (opcional)
                  <input value={name} onChange={(event) => setName(event.target.value)}
                    placeholder="Nome do atendente" maxLength={100} disabled={working} />
                </label>
                <label>
                  E-mail
                  <input type="email" value={email} onChange={(event) => {
                      setEmail(event.target.value);
                      setInviteFeedback(null);
                    }}
                    placeholder="atendente@empresa.com" required disabled={working} />
                </label>
                <label>
                  Permissão
                  <select value={ctx.membership?.role === "OWNER" ? inviteRole : "AGENT"}
                    onChange={(event) => setInviteRole(event.target.value as "AGENT" | "ADMIN")}
                    disabled={working || ctx.membership?.role !== "OWNER"}>
                    <option value="AGENT">Atendente</option>
                    {ctx.membership?.role === "OWNER" && <option value="ADMIN">Administrador</option>}
                  </select>
                </label>
                <button className="primaryAction" type="submit"
                  disabled={working || teamLoading || !email.trim() || Boolean(memberWithEmail)}>
                  {working ? "Aguarde..." : "Enviar convite"}
                </button>
              </div>
              {memberWithEmail && (
                <p className="teamInviteAlert teamInviteAlertInfo" role="status">
                  {memberWithEmail.status === "PENDING"
                    ? "Este e-mail já tem convite pendente. Não será enviado outro."
                    : "Este usuário já faz parte da equipe. Convite duplicado não gera e-mail."}
                </p>
              )}
              {inviteFeedback && (
                <p className={`teamInviteAlert teamInviteAlert${inviteFeedback.kind === "success" ? "Success" : inviteFeedback.kind === "info" ? "Info" : "Error"}`}
                  role="status">{inviteFeedback.text}</p>
              )}
              <small>Convites para novos usuários são enviados por e-mail. Contas existentes podem ser adicionadas sem novo e-mail; membros atuais não recebem convites duplicados.</small>
            </form>
          )}

          {teamLoading && <p className="teamHelpText">Carregando integrantes...</p>}
          {membersError && (
            <p className="teamInviteAlert teamInviteAlertError" role="alert">
              Não foi possível carregar a equipe: {membersError}
            </p>
          )}
          <div className="memberList teamMemberList">
            {members.map((member) => {
              const mine = member.userId === ctx.userId;
              const removable = canManage && !mine && member.role !== "OWNER" &&
                (ctx.membership?.role === "OWNER" || member.role === "AGENT");
              return (
                <div className="memberRow teamMemberRow" key={member.id}>
                  <div className="miniAvatar">{(member.name || "U").slice(0, 2).toUpperCase()}</div>
                  <div className="teamMemberIdentity">
                    <strong>{member.name} {mine && <small>(você)</small>}</strong>
                    <span>{member.email}</span>
                    <span className={member.status === "PENDING" ? "teamPending" : "teamActive"}>
                      {member.status === "PENDING" ? "Convite pendente" : "Acesso ativo"}
                    </span>
                  </div>
                  <div className="teamMemberActions">
                    {ctx.membership?.role === "OWNER" && !mine && member.role !== "OWNER" ? (
                      <select value={member.role} disabled={working}
                        aria-label={"Função de " + member.name}
                        onChange={(event) => void manageMember(member, "changeRole", event.target.value as Role)}>
                        <option value="AGENT">Atendente</option>
                        <option value="ADMIN">Administrador</option>
                      </select>
                    ) : (
                      <span className="memberRole">{roleNames[member.role]}</span>
                    )}
                    {removable && (removeId === member.id ? (
                      <div className="teamRevokeActions">
                        <button type="button" disabled={working} onClick={() => setRemoveId(null)}>Voltar</button>
                        <button className="teamRevokeConfirm" type="button" disabled={working}
                          onClick={() => void manageMember(member, "remove")}>Revogar acesso</button>
                      </div>
                    ) : (
                      <button type="button" className="teamRemoveButton" disabled={working}
                        onClick={() => setRemoveId(member.id)}>Remover</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="teamHelpText">Remover um usuário revoga o acesso, mas preserva o histórico das conversas.</p>

          {members.length === 0 && (
            <div className="sectionEmpty">
              <strong>Nenhum usuário adicional.</strong>
              <p>Utilize o formulário acima para convidar integrantes.</p>
            </div>
          )}
        </section>

        <section className="dataCard settingsPanelCard">
          <div className="reportCardHeader">
            <div>
              <p className="eyebrow">SAÚDE DO SISTEMA</p>
              <h2>Integrações</h2>
            </div>
          </div>

          <div className="integrationList">
            <div className="integrationRow">
              <div>
                <strong>WhatsApp Business</strong>
                <span>{ctx.account?.verified_name || "Mais Viagens"}</span>
              </div>
              <span className={`statePill ${connected ? "state-connected" : "state-error"}`}>
                {connected ? "Conectado" : ctx.account?.status || "Desconectado"}
              </span>
            </div>
            <div className="integrationRow">
              <div>
                <strong>Supabase</strong>
                <span>Banco, autenticação e realtime</span>
              </div>
              <span className="statePill state-connected">Online</span>
            </div>
            <div className="integrationRow">
              <div>
                <strong>Vercel</strong>
                <span>Frontend de produção</span>
              </div>
              <span className="statePill state-connected">Online</span>
            </div>
          </div>
        </section>
      </div>

      <section className="dataCard securityCard">
        <div>
          <p className="eyebrow">SEGURANÇA</p>
          <h2>Credenciais protegidas</h2>
          <p>
            Tokens da Meta e segredos do webhook permanecem no backend.
            O navegador recebe apenas identificadores públicos necessários para a interface.
          </p>
        </div>
        <Link className="secondaryAction" href="/settings/whatsapp" prefetch>
          Revisar integração →
        </Link>
      </section>

      {message && <div className="sectionNotice" role="status">{message}</div>}
    </SectionLayout>
  );
}

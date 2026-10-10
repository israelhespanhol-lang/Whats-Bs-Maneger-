"use client";

import { useEffect, useState } from "react";
import SectionLayout from "./section-layout";
import { supabase } from "../lib/supabase";
import { useMaisChatContext } from "../lib/use-mais-chat-context";

type Member = {
  id: string;
  role: "OWNER" | "ADMIN" | "AGENT";
  users:
    | { name: string; email: string }
    | { name: string; email: string }[]
    | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default function SettingsClient() {
  const ctx = useMaisChatContext();
  const organizationId = ctx.membership?.organization_id ?? null;
  const [members, setMembers] = useState<Member[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;

    async function loadMembers() {
      const { data, error } = await supabase
        .from("organization_members")
        .select("id,role,users(name,email)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMembers((data ?? []) as Member[]);
    }

    void loadMembers();
  }, [organizationId]);

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
            <p>Nível de acesso: {ctx.membership?.role}</p>
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
            <span>{members.length} usuário{members.length === 1 ? "" : "s"}</span>
          </div>

          <div className="memberList">
            {members.map((member) => {
              const user = one(member.users);
              return (
                <div className="memberRow" key={member.id}>
                  <div className="miniAvatar">
                    {(user?.name || "U").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <strong>{user?.name || "Usuário"}</strong>
                    <span>{user?.email || "Sem e-mail"}</span>
                  </div>
                  <span className="memberRole">{member.role}</span>
                </div>
              );
            })}
          </div>

          {members.length === 0 && (
            <div className="sectionEmpty">
              <strong>Nenhum usuário adicional.</strong>
              <p>Os administradores poderão gerenciar a equipe por aqui.</p>
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
        </a>
      </section>

      {message && <div className="sectionNotice">{message}</div>}
    </SectionLayout>
  );
}

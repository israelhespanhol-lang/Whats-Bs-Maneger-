"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "./theme-toggle";
import { supabase } from "../lib/supabase";

type Membership = {
  organization_id: string;
  role: "OWNER" | "ADMIN" | "AGENT";
  organizations: { name: string; slug: string } | { name: string; slug: string }[] | null;
};

type Contact = {
  id: string;
  name: string | null;
  phone_e164: string;
  status: string;
};

type Conversation = {
  id: string;
  status: string;
  unread_count: number;
  last_message_at: string | null;
  contacts: Contact | Contact[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function initials(name: string | null, phone: string) {
  if (!name) return phone.slice(-2) || "WA";
  return name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function time(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function DashboardClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Usuário");
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? conversations[0] ?? null,
    [conversations, selectedId]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session) {
        router.replace("/login");
        return;
      }

      if (!active) return;

      setUserName(session.user.user_metadata?.name || session.user.email?.split("@")[0] || "Usuário");

      const { data: member, error: memberError } = await supabase
        .from("organization_members")
        .select("organization_id, role, organizations(name,slug)")
        .eq("user_id", session.user.id)
        .limit(1)
        .maybeSingle();

      if (memberError) {
        setError(memberError.message);
        setLoading(false);
        return;
      }

      if (!member) {
        setLoading(false);
        return;
      }

      const typedMember = member as Membership;
      setMembership(typedMember);

      const { data: rows, error: conversationError } = await supabase
        .from("conversations")
        .select("id,status,unread_count,last_message_at,contacts(id,name,phone_e164,status)")
        .eq("organization_id", typedMember.organization_id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);

      if (conversationError) {
        setError(conversationError.message);
      } else {
        const typedRows = (rows ?? []) as Conversation[];
        setConversations(typedRows);
        setSelectedId(typedRows[0]?.id ?? null);
      }

      setLoading(false);
    }

    void load();
    return () => { active = false; };
  }, [router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return <main className="statePage"><div className="stateCard"><div className="brandMark">W</div><h1>Carregando...</h1><p>Validando sessão e organização.</p></div></main>;
  }

  if (!membership) {
    return <main className="statePage"><div className="stateCard"><p className="eyebrow">SEM ORGANIZAÇÃO</p><h1>Acesso criado, mas sem vínculo.</h1><p>Seu usuário ainda não está associado a uma organização.</p>{error && <div className="authMessage">{error}</div>}<button className="detailsButton" onClick={signOut}>Sair</button></div></main>;
  }

  const organization = one(membership.organizations);
  const contact = selected ? one(selected.contacts) : null;
  const unread = conversations.reduce((sum, item) => sum + item.unread_count, 0);

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">W</div>
          <div><strong>Whats BS</strong><span>{organization?.name ?? "Manager"}</span></div>
        </div>

        <nav>
          <button className="navItem active">Conversas <span>{unread}</span></button>
          <button className="navItem">Contatos</button>
          <button className="navItem">Campanhas</button>
          <button className="navItem">Templates</button>
          <button className="navItem">Relatórios</button>
        </nav>

        <div className="sidebarFooter">
          <ThemeToggle />
          <div className="sidebarUser">
            <div className="miniAvatar">{initials(userName, "")}</div>
            <div><strong>{userName}</strong><span>{membership.role}</span></div>
            <button onClick={signOut} title="Sair">↗</button>
          </div>
          <div className="connection disconnected"><i />WhatsApp não conectado</div>
        </div>
      </aside>

      <section className="conversationList">
        <header>
          <div><p className="eyebrow">Caixa de entrada</p><h1>Conversas</h1></div>
          <span className="realDataBadge">Dados reais</span>
        </header>

        <label className="search"><span>⌕</span><input placeholder="Buscar conversa..." /></label>

        <div className="filters">
          <button className="filter active">Todas</button>
          <button className="filter">Não lidas</button>
          <button className="filter">Minhas</button>
        </div>

        <div className="conversationItems">
          {conversations.length === 0 ? (
            <div className="emptyList">
              <div className="emptyIcon">◎</div>
              <strong>Nenhuma conversa ainda</strong>
              <p>Quando o WhatsApp for conectado, as conversas aparecerão aqui.</p>
            </div>
          ) : conversations.map((item) => {
            const itemContact = one(item.contacts);
            const label = itemContact?.name || itemContact?.phone_e164 || "Contato";
            return (
              <button
                type="button"
                className={`conversationItem conversationButton ${selected?.id === item.id ? "selected" : ""}`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="avatar">{initials(itemContact?.name ?? null, itemContact?.phone_e164 ?? "")}</div>
                <div className="conversationCopy">
                  <div className="conversationTop"><strong>{label}</strong><time>{time(item.last_message_at)}</time></div>
                  <p>{item.status}</p>
                </div>
                {item.unread_count > 0 && <span className="badge">{item.unread_count}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="chat">
        {selected && contact ? (
          <>
            <header className="chatHeader">
              <div className="contactIdentity">
                <div className="avatar large">{initials(contact.name, contact.phone_e164)}</div>
                <div><strong>{contact.name || contact.phone_e164}</strong><span>{contact.phone_e164}</span></div>
              </div>
            </header>
            <div className="messages emptyMessages">
              <div className="emptyIcon">◌</div>
              <strong>Histórico pronto para sincronização</strong>
              <p>As mensagens reais aparecerão aqui assim que conectarmos a Meta.</p>
            </div>
            <footer className="composer composerLocked">
              <input placeholder="Conecte o WhatsApp para enviar mensagens" disabled />
              <button className="send" disabled>➤</button>
            </footer>
          </>
        ) : (
          <div className="chatEmpty">
            <div className="emptyIcon largeEmptyIcon">◎</div>
            <h2>Caixa de entrada pronta</h2>
            <p>Os contatos fictícios foram removidos. Este painel agora aguarda dados reais.</p>
          </div>
        )}
      </section>

      <aside className="contactPanel">
        {contact ? (
          <>
            <div className="contactHero">
              <div className="avatar xlarge">{initials(contact.name, contact.phone_e164)}</div>
              <h2>{contact.name || "Contato"}</h2>
              <p>{contact.phone_e164}</p>
            </div>
            <div className="infoBlock"><span className="sectionLabel">STATUS</span><button className="statusPill">{contact.status}</button></div>
            <div className="infoBlock"><span className="sectionLabel">ORGANIZAÇÃO</span><div className="windowCard"><strong>{organization?.name ?? "Whats Manager"}</strong><span>Dados isolados por tenant</span></div></div>
          </>
        ) : (
          <div className="contactEmpty"><p className="eyebrow">CONTATO</p><p>Selecione uma conversa para ver os dados.</p></div>
        )}
      </aside>
    </main>
  );
}

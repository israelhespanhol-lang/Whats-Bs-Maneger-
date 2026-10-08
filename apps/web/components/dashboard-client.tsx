"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "./brand-logo";
import AppSidebar from "./app-sidebar";
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
  customer_service_window_expires_at: string | null;
  contacts: Contact | Contact[] | null;
};

type Message = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  message_type: string;
  body: string | null;
  status: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  optimistic?: boolean;
};

type WhatsAppAccount = {
  id: string;
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
  display_phone_number: string | null;
  verified_name: string | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function initials(name: string | null, phone: string) {
  if (!name) return phone.slice(-2) || "WA";
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function time(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function dateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  if (sameDay) return "Hoje";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short"
  }).format(date);
}

function statusIcon(status: Message["status"]) {
  if (status === "READ") return "✓✓";
  if (status === "DELIVERED") return "✓✓";
  if (status === "SENT") return "✓";
  if (status === "FAILED") return "!";
  return "◷";
}

function windowRemaining(expiresAt: string | null) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Janela encerrada";

  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  return `${hours}h ${minutes}min restantes`;
}

function sortMessages(items: Message[]) {
  return [...items].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function upsertMessage(items: Message[], incoming: Message) {
  const index = items.findIndex((item) => item.id === incoming.id);

  if (index === -1) {
    return sortMessages([...items, incoming]);
  }

  const next = [...items];
  next[index] = { ...next[index], ...incoming, optimistic: false };
  return sortMessages(next);
}

function sortConversations(items: Conversation[]) {
  return [...items].sort((a, b) => {
    const aTime = a.last_message_at
      ? new Date(a.last_message_at).getTime()
      : 0;
    const bTime = b.last_message_at
      ? new Date(b.last_message_at).getTime()
      : 0;
    return bTime - aTime;
  });
}

export default function DashboardClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Usuário");
  const [account, setAccount] = useState<WhatsAppAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const selectedIdRef = useRef<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? conversations[0] ?? null,
    [conversations, selectedId]
  );

  const loadConversations = useCallback(async (organizationId: string) => {
    const { data: rows, error: conversationError } = await supabase
      .from("conversations")
      .select(
        "id,status,unread_count,last_message_at,customer_service_window_expires_at,contacts(id,name,phone_e164,status)"
      )
      .eq("organization_id", organizationId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(100);

    if (conversationError) {
      setError(conversationError.message);
      return;
    }

    const typedRows = (rows ?? []) as Conversation[];
    setConversations(typedRows);
    setSelectedId((current) => {
      const next =
        current && typedRows.some((row) => row.id === current)
          ? current
          : typedRows[0]?.id ?? null;
      selectedIdRef.current = next;
      return next;
    });
  }, []);

  const loadMessages = useCallback(
    async (conversationId: string, options?: { background?: boolean }) => {
      const background = options?.background ?? false;

      if (!background) {
        setMessagesLoading(true);
      }

      const { data: rows, error: messageError } = await supabase
        .from("messages")
        .select("id,direction,message_type,body,status,created_at,sent_at,delivered_at,read_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(500);

      if (messageError) {
        setError(messageError.message);
      } else if (selectedIdRef.current === conversationId) {
        setMessages([...(rows ?? [])].reverse() as Message[]);
      }

      if (!background && selectedIdRef.current === conversationId) {
        setMessagesLoading(false);
      }
    },
    []
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

      setUserName(
        session.user.user_metadata?.name ||
          session.user.email?.split("@")[0] ||
          "Usuário"
      );

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

      const { data: accountData } = await supabase
        .from("whatsapp_accounts")
        .select("id,status,display_phone_number,verified_name")
        .eq("organization_id", typedMember.organization_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      setAccount((accountData ?? null) as WhatsAppAccount | null);
      await loadConversations(typedMember.organization_id);
      setLoading(false);
    }

    void load();

    return () => {
      active = false;
    };
  }, [loadConversations, router]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!messages.length || !shouldAutoScrollRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: messagesLoading ? "auto" : "smooth",
        block: "end"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, messagesLoading]);

  useEffect(() => {
    if (!membership) return;

    const channel = supabase
      .channel(`inbox:${membership.organization_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `organization_id=eq.${membership.organization_id}`
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const removedId = (payload.old as { id?: string })?.id;
            if (removedId) {
              setConversations((current) =>
                current.filter((item) => item.id !== removedId)
              );
            }
            return;
          }

          const changed = payload.new as Partial<Conversation> & { id?: string };
          if (!changed.id) return;

          let known = false;
          setConversations((current) => {
            const index = current.findIndex((item) => item.id === changed.id);
            if (index === -1) return current;

            known = true;
            const next = [...current];
            const isOpen = selectedIdRef.current === changed.id;

            next[index] = {
              ...next[index],
              status: changed.status ?? next[index].status,
              unread_count: isOpen
                ? 0
                : changed.unread_count ?? next[index].unread_count,
              last_message_at:
                changed.last_message_at ?? next[index].last_message_at,
              customer_service_window_expires_at:
                changed.customer_service_window_expires_at ??
                next[index].customer_service_window_expires_at
            };

            return sortConversations(next);
          });

          if (!known || payload.eventType === "INSERT") {
            void loadConversations(membership.organization_id);
          }

          if (
            selectedIdRef.current === changed.id &&
            (changed.unread_count ?? 0) > 0
          ) {
            void supabase
              .from("conversations")
              .update({ unread_count: 0 })
              .eq("id", changed.id);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [membership, loadConversations]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }

    selectedIdRef.current = selectedId;
    shouldAutoScrollRef.current = true;
    setMessages([]);
    void loadMessages(selectedId);

    void supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", selectedId);

    setConversations((current) =>
      current.map((item) =>
        item.id === selectedId ? { ...item, unread_count: 0 } : item
      )
    );

    const channel = supabase
      .channel(`messages:${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedId}`
        },
        (payload) => {
          if (selectedIdRef.current !== selectedId) return;

          if (payload.eventType === "INSERT") {
            const incoming = payload.new as Message;
            setMessages((current) => upsertMessage(current, incoming));
            return;
          }

          if (payload.eventType === "UPDATE") {
            const incoming = payload.new as Message;
            setMessages((current) => upsertMessage(current, incoming));
            return;
          }

          if (payload.eventType === "DELETE") {
            const removedId = (payload.old as { id?: string })?.id;
            if (removedId) {
              setMessages((current) =>
                current.filter((message) => message.id !== removedId)
              );
            }
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId, loadMessages]);

  async function sendMessage() {
    if (!selected || !draft.trim() || sending) return;

    setSending(true);
    setError(null);

    const text = draft.trim();
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      direction: "OUTBOUND",
      message_type: "text",
      body: text,
      status: "PENDING",
      created_at: new Date().toISOString(),
      sent_at: null,
      delivered_at: null,
      read_at: null,
      optimistic: true
    };

    shouldAutoScrollRef.current = true;
    setDraft("");
    setMessages((current) => upsertMessage(current, optimisticMessage));

    const { data, error: sendError } = await supabase.functions.invoke(
      "whatsapp-send",
      {
        body: {
          conversationId: selected.id,
          text
        }
      }
    );

    if (sendError || !data?.message) {
      setMessages((current) =>
        current.map((message) =>
          message.id === optimisticId
            ? { ...message, status: "FAILED", optimistic: false }
            : message
        )
      );
      setError(
        "Não foi possível enviar. Verifique a conexão do WhatsApp e a janela de atendimento."
      );
      setSending(false);
      return;
    }

    const persisted = data.message as Message;
    setMessages((current) => {
      const withoutOptimistic = current.filter(
        (message) => message.id !== optimisticId
      );
      return upsertMessage(withoutOptimistic, persisted);
    });

    setSending(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="statePage">
        <div className="stateCard">
          <BrandLogo className="loadingBrandLogo" />
          <h1>Carregando o Mais Chat...</h1>
          <p>Validando sessão e organização.</p>
        </div>
      </main>
    );
  }

  if (!membership) {
    return (
      <main className="statePage">
        <div className="stateCard">
          <p className="eyebrow">SEM ORGANIZAÇÃO</p>
          <h1>Acesso criado, mas sem vínculo.</h1>
          <p>Seu usuário ainda não está associado a uma organização.</p>
          {error && <div className="authMessage">{error}</div>}
          <button className="detailsButton" onClick={signOut}>Sair</button>
        </div>
      </main>
    );
  }

  const organization = one(membership.organizations);
  const contact = selected ? one(selected.contacts) : null;
  const unread = conversations.reduce((sum, item) => sum + item.unread_count, 0);
  const connected = account?.status === "CONNECTED";
  const windowText = selected
    ? windowRemaining(selected.customer_service_window_expires_at)
    : null;

  return (
    <main className="appShell">
      <AppSidebar
        active="conversations"
        unread={unread}
        userName={userName}
        role={membership.role}
        connected={connected}
        displayPhoneNumber={account?.display_phone_number}
        onSignOut={() => void signOut()}
      />

      <section className="conversationList">
        <header>
          <div>
            <p className="eyebrow">Caixa de entrada</p>
            <h1>Conversas</h1>
          </div>
          <span className="realDataBadge">Realtime</span>
        </header>

        <label className="search">
          <span>⌕</span>
          <input placeholder="Buscar conversa..." />
        </label>

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
              <p>Quando o WhatsApp for conectado, as conversas aparecerão aqui em tempo real.</p>
            </div>
          ) : (
            conversations.map((item) => {
              const itemContact = one(item.contacts);
              const label =
                itemContact?.name ||
                itemContact?.phone_e164 ||
                "Contato";

              return (
                <button
                  type="button"
                  className={`conversationItem conversationButton ${selected?.id === item.id ? "selected" : ""}`}
                  key={item.id}
                  onClick={() => {
                    selectedIdRef.current = item.id;
                    shouldAutoScrollRef.current = true;
                    setSelectedId(item.id);
                  }}
                >
                  <div className="avatar">
                    {initials(itemContact?.name ?? null, itemContact?.phone_e164 ?? "")}
                  </div>
                  <div className="conversationCopy">
                    <div className="conversationTop">
                      <strong>{label}</strong>
                      <time>{time(item.last_message_at)}</time>
                    </div>
                    <p>{item.status === "OPEN" ? "Conversa aberta" : item.status}</p>
                  </div>
                  {item.unread_count > 0 && (
                    <span className="badge">{item.unread_count}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="chat">
        {selected && contact ? (
          <>
            <header className="chatHeader">
              <div className="contactIdentity">
                <div className="avatar large">
                  {initials(contact.name, contact.phone_e164)}
                </div>
                <div>
                  <strong>{contact.name || contact.phone_e164}</strong>
                  <span>{windowText || contact.phone_e164}</span>
                </div>
              </div>
              <div className="chatActions">
                <button title="Buscar">⌕</button>
                <button title="Mais opções">⋯</button>
              </div>
            </header>

            <div
              className="messages"
              ref={messagesContainerRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                const distanceFromBottom =
                  element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight;
                shouldAutoScrollRef.current = distanceFromBottom < 140;
              }}
            >
              {messagesLoading && messages.length === 0 ? (
                <div className="messageState">Carregando mensagens...</div>
              ) : messages.length === 0 ? (
                <div className="emptyMessages">
                  <div className="emptyIcon">◌</div>
                  <strong>Conversa sem mensagens</strong>
                  <p>As mensagens recebidas pelo webhook aparecerão aqui automaticamente.</p>
                </div>
              ) : (
                <>
                  <div className="dayDivider">
                    <span>{dateLabel(messages[0].created_at)}</span>
                  </div>
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`bubble ${message.direction === "INBOUND" ? "incoming" : "outgoing"}`}
                    >
                      {message.body || (
                        <span className="mediaPlaceholder">
                          {message.message_type === "image"
                            ? "Imagem"
                            : message.message_type === "document"
                              ? "Documento"
                              : message.message_type === "audio"
                                ? "Áudio"
                                : message.message_type}
                        </span>
                      )}
                      <small>
                        {time(message.created_at)}
                        {message.direction === "OUTBOUND"
                          ? ` ${statusIcon(message.status)}`
                          : ""}
                      </small>
                    </div>
                  ))}
                  <div ref={messagesEndRef} aria-hidden="true" />
                </>
              )}
            </div>

            <footer className={`composer ${connected ? "" : "composerLocked"}`}>
              <button disabled={!connected || sending}>＋</button>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={
                  !connected
                    ? "Conecte o WhatsApp para enviar mensagens"
                    : windowText === "Janela encerrada"
                      ? "Janela encerrada — use um template aprovado"
                      : "Digite uma mensagem..."
                }
                disabled={!connected || sending || windowText === "Janela encerrada"}
              />
              <button
                className="send"
                onClick={() => void sendMessage()}
                disabled={
                  !connected ||
                  sending ||
                  !draft.trim() ||
                  windowText === "Janela encerrada"
                }
              >
                {sending ? "…" : "➤"}
              </button>
            </footer>
          </>
        ) : (
          <div className="chatEmpty">
            <div className="emptyIcon largeEmptyIcon">◎</div>
            <h2>Caixa de entrada pronta</h2>
            <p>
              O painel está conectado ao Supabase e aguardando a primeira conversa real.
            </p>
          </div>
        )}
      </section>

      <aside className="contactPanel">
        {contact ? (
          <>
            <div className="contactHero">
              <div className="avatar xlarge">
                {initials(contact.name, contact.phone_e164)}
              </div>
              <h2>{contact.name || "Contato"}</h2>
              <p>{contact.phone_e164}</p>
            </div>

            <div className="infoBlock">
              <span className="sectionLabel">STATUS</span>
              <button className="statusPill">{contact.status}</button>
            </div>

            <div className="infoBlock">
              <span className="sectionLabel">JANELA WHATSAPP</span>
              <div className="windowCard">
                <strong>{windowText ?? "Sem janela ativa"}</strong>
                <span>
                  {windowText && windowText !== "Janela encerrada"
                    ? "Atendimento livre dentro da janela"
                    : "Fora da janela, use template aprovado"}
                </span>
              </div>
            </div>

            <div className="infoBlock">
              <span className="sectionLabel">ORGANIZAÇÃO</span>
              <div className="windowCard">
                <strong>{organization?.name ?? "Mais Viagens"}</strong>
                <span>Dados isolados por tenant</span>
              </div>
            </div>
          </>
        ) : (
          <div className="contactEmpty">
            <p className="eyebrow">CONTATO</p>
            <p>Selecione uma conversa para ver os dados.</p>
          </div>
        )}
      </aside>
    </main>
  );
}

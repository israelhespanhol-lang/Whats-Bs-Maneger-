"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "./brand-logo";
import AppSidebar from "./app-sidebar";
import { supabase } from "../lib/supabase";

type Membership = {
  id: string;
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
  whatsapp_account_id: string;
  assigned_member_id: string | null;
  campaign_id: string | null;
  crm_stage_id: string | null;
  status: string;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: "INBOUND" | "OUTBOUND" | null;
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

type ConversationFilter = "NEW" | "MINE" | "ALL";
type ConversationOrder = "RECENT" | "UNREAD_RECENT";

type WhatsAppAccount = {
  id: string;
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
  display_phone_number: string | null;
  verified_name: string | null;
};

type MemberDirectoryRow = {
  id: string;
  users:
    | { name: string; email: string }
    | { name: string; email: string }[]
    | null;
};

type Tag = {
  id: string;
  name: string;
  color: string;
};

type ContactTagRow = {
  contact_id: string;
  tags: Tag | Tag[] | null;
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

function relativeTime(value: string | null) {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60_000));

  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short"
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
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [tagsByContact, setTagsByContact] = useState<Record<string, Tag[]>>({});
  const [messageMatchConversationIds, setMessageMatchConversationIds] =
    useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationFilter, setConversationFilter] =
    useState<ConversationFilter>("NEW");
  const [conversationOrder, setConversationOrder] =
    useState<ConversationOrder>("RECENT");
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  const visibleConversations = useMemo(() => {
    const term = conversationSearch.trim().toLowerCase();

    const filtered = conversations.filter((item) => {
      const itemContact = one(item.contacts);
      const label = `${itemContact?.name ?? ""} ${itemContact?.phone_e164 ?? ""} ${item.last_message_preview ?? ""}`
        .toLowerCase();

      if (
        selectedChannelIds.length > 0 &&
        !selectedChannelIds.includes(item.whatsapp_account_id)
      ) {
        return false;
      }

      if (
        term &&
        !label.includes(term) &&
        !messageMatchConversationIds.has(item.id)
      ) {
        return false;
      }

      if (conversationFilter === "NEW" && item.assigned_member_id !== null) {
        return false;
      }

      if (
        conversationFilter === "MINE" &&
        item.assigned_member_id !== membership?.id
      ) {
        return false;
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      if (conversationOrder === "UNREAD_RECENT") {
        const aUnread = a.unread_count > 0 ? 1 : 0;
        const bUnread = b.unread_count > 0 ? 1 : 0;
        if (aUnread !== bUnread) return bUnread - aUnread;
      }

      return (
        new Date(b.last_message_at ?? 0).getTime() -
        new Date(a.last_message_at ?? 0).getTime()
      );
    });
  }, [
    conversations,
    conversationSearch,
    conversationFilter,
    conversationOrder,
    membership?.id,
    selectedChannelIds,
    messageMatchConversationIds
  ]);

  const conversationCounts = useMemo(
    () => ({
      new: conversations.filter((item) => item.assigned_member_id === null).length,
      mine: conversations.filter(
        (item) => item.assigned_member_id === membership?.id
      ).length,
      all: conversations.length
    }),
    [conversations, membership?.id]
  );

  const displayedMessages = useMemo(() => {
    const term = messageSearch.trim().toLowerCase();
    if (!messageSearchOpen || !term) return messages;

    return messages.filter((message) =>
      (message.body ?? message.message_type).toLowerCase().includes(term)
    );
  }, [messages, messageSearch, messageSearchOpen]);

  const loadConversations = useCallback(async (organizationId: string) => {
    const { data: rows, error: conversationError } = await supabase
      .from("conversations")
      .select(
        "id,whatsapp_account_id,assigned_member_id,campaign_id,crm_stage_id,status,unread_count,last_message_at,last_message_preview,last_message_direction,customer_service_window_expires_at,contacts(id,name,phone_e164,status)"
      )
      .eq("organization_id", organizationId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(300);

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
          : null;
      selectedIdRef.current = next;
      return next;
    });

    const contactIds = typedRows
      .map((row) => one(row.contacts)?.id)
      .filter(Boolean) as string[];

    const [memberResult, tagResult] = await Promise.all([
      supabase
        .from("organization_members")
        .select("id,users(name,email)")
        .eq("organization_id", organizationId),
      contactIds.length
        ? supabase
            .from("contact_tags")
            .select("contact_id,tags(id,name,color)")
            .in("contact_id", contactIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (!memberResult.error) {
      const directory: Record<string, string> = {};
      for (const member of (memberResult.data ?? []) as MemberDirectoryRow[]) {
        const user = one(member.users);
        directory[member.id] = user?.name || user?.email || "Atendente";
      }
      setMemberNames(directory);
    }

    if (!tagResult.error) {
      const map: Record<string, Tag[]> = {};
      for (const row of (tagResult.data ?? []) as ContactTagRow[]) {
        const tag = one(row.tags);
        if (!tag) continue;
        map[row.contact_id] = [...(map[row.contact_id] ?? []), tag];
      }
      setTagsByContact(map);
    }
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
        .select("id, organization_id, role, organizations(name,slug)")
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

      const { data: accountRows } = await supabase
        .from("whatsapp_accounts")
        .select("id,status,display_phone_number,verified_name")
        .eq("organization_id", typedMember.organization_id)
        .order("created_at", { ascending: true });

      const typedAccounts = (accountRows ?? []) as WhatsAppAccount[];
      setAccounts(typedAccounts);
      setAccount(typedAccounts[0] ?? null);
      setSelectedChannelIds(
        typedAccounts
          .filter((item) => item.status === "CONNECTED")
          .map((item) => item.id)
      );

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
    if (!membership) return;

    const term = conversationSearch.trim();
    if (term.length < 2) {
      setMessageMatchConversationIds(new Set());
      return;
    }

    const timeout = window.setTimeout(async () => {
      const { data } = await supabase
        .from("messages")
        .select("conversation_id")
        .eq("organization_id", membership.organization_id)
        .ilike("body", `%${term}%`)
        .limit(200);

      setMessageMatchConversationIds(
        new Set((data ?? []).map((row) => row.conversation_id))
      );
    }, 260);

    return () => window.clearTimeout(timeout);
  }, [conversationSearch, membership]);

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
            next[index] = {
              ...next[index],
              assigned_member_id:
                changed.assigned_member_id ?? next[index].assigned_member_id,
              status: changed.status ?? next[index].status,
              unread_count:
                changed.unread_count ?? next[index].unread_count,
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

  async function markConversationRead() {
    if (!selected || selected.unread_count <= 0) return;

    const conversationId = selected.id;
    const previousUnread = selected.unread_count;

    setConversations((current) =>
      current.map((item) =>
        item.id === conversationId ? { ...item, unread_count: 0 } : item
      )
    );

    const { error: readError } = await supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId);

    if (readError) {
      setConversations((current) =>
        current.map((item) =>
          item.id === conversationId
            ? { ...item, unread_count: previousUnread }
            : item
        )
      );
      setError(readError.message);
    }
  }

  async function updateAssignment(assignToMe: boolean) {
    if (!selected || !membership) return;

    const nextAssignedMemberId = assignToMe ? membership.id : null;
    setActionsOpen(false);

    setConversations((current) =>
      current.map((item) =>
        item.id === selected.id
          ? { ...item, assigned_member_id: nextAssignedMemberId }
          : item
      )
    );

    const { error: assignmentError } = await supabase
      .from("conversations")
      .update({ assigned_member_id: nextAssignedMemberId })
      .eq("id", selected.id);

    if (assignmentError) {
      setError(assignmentError.message);
      await loadConversations(membership.organization_id);
    }
  }

  async function toggleConversationClosed() {
    if (!selected || !membership) return;

    const nextStatus = selected.status === "CLOSED" ? "OPEN" : "CLOSED";
    setActionsOpen(false);

    setConversations((current) =>
      current.map((item) =>
        item.id === selected.id ? { ...item, status: nextStatus } : item
      )
    );

    const { error: statusError } = await supabase
      .from("conversations")
      .update({ status: nextStatus })
      .eq("id", selected.id);

    if (statusError) {
      setError(statusError.message);
      await loadConversations(membership.organization_id);
    }
  }

  async function updateContactStatus(contactId: string, status: string) {
    setConversations((current) =>
      current.map((item) => {
        const currentContact = one(item.contacts);
        if (currentContact?.id !== contactId) return item;

        const nextContact = { ...currentContact, status };
        return { ...item, contacts: nextContact };
      })
    );

    const { error: contactError } = await supabase
      .from("contacts")
      .update({ status })
      .eq("id", contactId);

    if (contactError) {
      setError(contactError.message);
      if (membership) await loadConversations(membership.organization_id);
    }
  }

  async function sendAttachment(file: File) {
    if (!selected || !connected || uploading || sending) return;

    const windowState = windowRemaining(
      selected.customer_service_window_expires_at
    );
    if (windowState === "Janela encerrada") {
      setError("A janela de atendimento está encerrada. Use um template aprovado.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("O anexo deve ter no máximo 5 MB.");
      return;
    }

    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      setError("Por enquanto, envie imagens ou arquivos PDF.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
        reader.readAsDataURL(file);
      });

      const dataBase64 = dataUrl.split(",")[1];
      if (!dataBase64) throw new Error("Arquivo inválido.");

      const caption = draft.trim();
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimisticMessage: Message = {
        id: optimisticId,
        direction: "OUTBOUND",
        message_type: isImage ? "image" : "document",
        body: caption || `📎 ${file.name}`,
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
            attachment: {
              kind: isImage ? "image" : "document",
              name: file.name,
              mimeType: file.type,
              dataBase64,
              caption: caption || undefined
            }
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
        throw new Error("Não foi possível enviar o anexo.");
      }

      const persisted = data.message as Message;
      setMessages((current) =>
        upsertMessage(
          current.filter((message) => message.id !== optimisticId),
          persisted
        )
      );
    } catch (attachmentError) {
      setError(
        attachmentError instanceof Error
          ? attachmentError.message
          : "Não foi possível enviar o anexo."
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
        <header className="flowInboxHeader">
          <div>
            <p className="eyebrow">CAIXA DE ENTRADA</p>
            <h1>Conversas</h1>
            <span className="conversationOrdering">
              Ordenadas por{" "}
              {conversationOrder === "RECENT"
                ? "Mais recentes"
                : "Não lidas (recentes)"}
            </span>
          </div>
          <button
            type="button"
            className="conversationAddButton"
            title="Abrir contatos para iniciar uma conversa"
            onClick={() => router.push("/contacts")}
          >
            ＋
          </button>
        </header>

        <div className="conversationSearchRow">
          <label className="search">
            <span>⌕</span>
            <input
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="Buscar contatos/mensagens..."
            />
          </label>
          <button
            type="button"
            className={`conversationFilterButton ${filterPanelOpen ? "active" : ""}`}
            onClick={() => setFilterPanelOpen((current) => !current)}
            title="Filtros e ordenação"
          >
            ☷
          </button>
        </div>

        {filterPanelOpen && (
          <div className="conversationFilterPanel">
            <label>
              <span>Ordenação</span>
              <select
                value={conversationOrder}
                onChange={(event) =>
                  setConversationOrder(event.target.value as ConversationOrder)
                }
              >
                <option value="RECENT">Mais recentes</option>
                <option value="UNREAD_RECENT">Não lidas (recentes)</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setChannelPickerOpen(true)}
            >
              Canais: {selectedChannelIds.length || "nenhum"}
            </button>
          </div>
        )}

        <div className="filters flowInboxTabs">
          <button
            type="button"
            className={`filter ${conversationFilter === "NEW" ? "active" : ""}`}
            onClick={() => setConversationFilter("NEW")}
          >
            Novos <span>{conversationCounts.new}</span>
          </button>
          <button
            type="button"
            className={`filter ${conversationFilter === "MINE" ? "active" : ""}`}
            onClick={() => setConversationFilter("MINE")}
          >
            Meus <span>{conversationCounts.mine}</span>
          </button>
          <button
            type="button"
            className={`filter ${conversationFilter === "ALL" ? "active" : ""}`}
            onClick={() => setConversationFilter("ALL")}
          >
            Todos <span>{conversationCounts.all}</span>
          </button>
        </div>

        <div className="conversationItems flowConversationItems">
          {visibleConversations.length === 0 ? (
            <div className="emptyList">
              <div className="emptyIcon">◎</div>
              <strong>Nenhuma conversa neste filtro</strong>
              <p>Altere a busca, o canal ou a aba para visualizar outras conversas.</p>
            </div>
          ) : (
            visibleConversations.map((item) => {
              const itemContact = one(item.contacts);
              const label =
                itemContact?.name ||
                itemContact?.phone_e164 ||
                "Contato";
              const assignee = item.assigned_member_id
                ? memberNames[item.assigned_member_id]
                : null;
              const tags = itemContact
                ? tagsByContact[itemContact.id] ?? []
                : [];

              return (
                <button
                  type="button"
                  className={`conversationItem conversationButton flowConversationItem ${selected?.id === item.id ? "selected" : ""}`}
                  key={item.id}
                  onClick={() => {
                    selectedIdRef.current = item.id;
                    shouldAutoScrollRef.current = true;
                    setSelectedId(item.id);
                  }}
                >
                  <div className="conversationAvatarWrap">
                    <div className="avatar">
                      {initials(
                        itemContact?.name ?? null,
                        itemContact?.phone_e164 ?? ""
                      )}
                    </div>
                    <span className={`assigneeMini ${assignee ? "" : "unassigned"}`}>
                      {assignee ? initials(assignee, "") : "N"}
                    </span>
                  </div>

                  <div className="conversationCopy">
                    <div className="conversationTop">
                      <strong>{label}</strong>
                      <time>{relativeTime(item.last_message_at)}</time>
                    </div>

                    <span className="conversationPhone">
                      {itemContact?.phone_e164 ?? ""}
                    </span>

                    <p className="conversationPreview">
                      {item.last_message_direction === "OUTBOUND" ? "Você: " : ""}
                      {item.last_message_preview || "Sem prévia de mensagem"}
                    </p>

                    {tags.length > 0 && (
                      <div className="conversationTags">
                        {tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag.id}
                            style={{
                              borderColor: tag.color,
                              color: tag.color
                            }}
                          >
                            {tag.name}
                          </span>
                        ))}
                        {tags.length > 2 && <span>+{tags.length - 2}</span>}
                      </div>
                    )}
                  </div>

                  {item.unread_count > 0 && (
                    <span className="badge">{item.unread_count}</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <footer className="conversationListFooter">
          <button
            type="button"
            onClick={() => setChannelPickerOpen(true)}
            className="channelSelectorButton"
          >
            <i className={connected ? "online" : ""} />
            <div>
              <strong>
                {selectedChannelIds.length === accounts.length
                  ? "Todos os canais"
                  : `${selectedChannelIds.length} canal(is)`}
              </strong>
              <span>
                {account?.display_phone_number || "Selecionar canais"}
              </span>
            </div>
            <b>⌄</b>
          </button>
        </footer>

        {channelPickerOpen && (
          <div className="channelPickerBackdrop" role="presentation">
            <div className="channelPickerModal" role="dialog" aria-modal="true">
              <div className="channelPickerHeader">
                <div>
                  <p className="eyebrow">CANAIS DE ATENDIMENTO</p>
                  <h3>Selecionar canais</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setChannelPickerOpen(false)}
                >
                  ×
                </button>
              </div>

              <button
                type="button"
                className="channelSelectAll"
                onClick={() =>
                  setSelectedChannelIds(
                    selectedChannelIds.length === accounts.length
                      ? []
                      : accounts.map((item) => item.id)
                  )
                }
              >
                {selectedChannelIds.length === accounts.length
                  ? "Limpar seleção"
                  : "Selecionar todos"}
              </button>

              <div className="channelPickerList">
                {accounts.map((channel) => (
                  <label key={channel.id}>
                    <input
                      type="checkbox"
                      checked={selectedChannelIds.includes(channel.id)}
                      onChange={(event) => {
                        setSelectedChannelIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, channel.id])]
                            : current.filter((id) => id !== channel.id)
                        );
                      }}
                    />
                    <div>
                      <strong>{channel.verified_name || "WhatsApp"}</strong>
                      <span>{channel.display_phone_number || "Sem telefone"}</span>
                    </div>
                    <em className={channel.status === "CONNECTED" ? "connected" : ""}>
                      {channel.status === "CONNECTED" ? "Conectado" : channel.status}
                    </em>
                  </label>
                ))}
              </div>

              <button
                type="button"
                className="primaryAction"
                onClick={() => setChannelPickerOpen(false)}
              >
                Abrir Chat com {selectedChannelIds.length} selecionado(s)
              </button>
            </div>
          </div>
        )}
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
                {selected.unread_count > 0 && (
                  <button
                    type="button"
                    className="markReadButton"
                    title="Marcar conversa como lida"
                    onClick={() => void markConversationRead()}
                  >
                    ✓ <span>Marcar como lida</span>
                  </button>
                )}
                <button
                  type="button"
                  title="Buscar mensagens"
                  className={messageSearchOpen ? "active" : ""}
                  onClick={() => {
                    setMessageSearchOpen((current) => !current);
                    setActionsOpen(false);
                    if (messageSearchOpen) setMessageSearch("");
                  }}
                >
                  ⌕
                </button>
                <div className="chatMenuWrap">
                  <button
                    type="button"
                    title="Mais opções"
                    className={actionsOpen ? "active" : ""}
                    onClick={() => {
                      setActionsOpen((current) => !current);
                      setMessageSearchOpen(false);
                      setMessageSearch("");
                    }}
                  >
                    ⋯
                  </button>
                  {actionsOpen && (
                    <div className="chatActionMenu">
                      {selected.unread_count > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionsOpen(false);
                            void markConversationRead();
                          }}
                        >
                          Marcar como lida
                        </button>
                      )}
                      {selected.assigned_member_id === membership.id ? (
                        <button
                          type="button"
                          onClick={() => void updateAssignment(false)}
                        >
                          Liberar conversa
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void updateAssignment(true)}
                        >
                          Assumir conversa
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void toggleConversationClosed()}
                      >
                        {selected.status === "CLOSED"
                          ? "Reabrir conversa"
                          : "Fechar conversa"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </header>

            {messageSearchOpen && (
              <div className="messageSearchBar">
                <span>⌕</span>
                <input
                  autoFocus
                  value={messageSearch}
                  onChange={(event) => setMessageSearch(event.target.value)}
                  placeholder="Buscar nesta conversa..."
                />
                <span className="messageSearchCount">
                  {messageSearch.trim()
                    ? `${displayedMessages.length} resultado${displayedMessages.length === 1 ? "" : "s"}`
                    : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMessageSearchOpen(false);
                    setMessageSearch("");
                  }}
                  aria-label="Fechar busca"
                >
                  ×
                </button>
              </div>
            )}

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
              ) : displayedMessages.length === 0 ? (
                <div className="emptyMessages">
                  <div className="emptyIcon">◌</div>
                  <strong>
                    {messageSearch.trim()
                      ? "Nenhuma mensagem encontrada"
                      : "Conversa sem mensagens"}
                  </strong>
                  <p>
                    {messageSearch.trim()
                      ? "Tente outro termo de busca."
                      : "As mensagens recebidas pelo webhook aparecerão aqui automaticamente."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="dayDivider">
                    <span>{dateLabel(displayedMessages[0].created_at)}</span>
                  </div>
                  {displayedMessages.map((message) => (
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
              <input
                ref={fileInputRef}
                className="attachmentInput"
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void sendAttachment(file);
                }}
              />
              <button
                type="button"
                title="Enviar imagem ou PDF"
                onClick={() => fileInputRef.current?.click()}
                disabled={
                  !connected ||
                  sending ||
                  uploading ||
                  windowText === "Janela encerrada"
                }
              >
                {uploading ? "…" : "＋"}
              </button>
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
                disabled={
                  !connected ||
                  sending ||
                  uploading ||
                  windowText === "Janela encerrada"
                }
              />
              <button
                className="send"
                onClick={() => void sendMessage()}
                disabled={
                  !connected ||
                  sending ||
                  uploading ||
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
            <h2>Selecione uma conversa</h2>
            <p>
              Escolha uma conversa na barra lateral para começar a visualizar e responder mensagens.
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
              <select
                className="statusPill statusSelectPill"
                value={contact.status}
                onChange={(event) =>
                  void updateContactStatus(contact.id, event.target.value)
                }
                aria-label="Status do contato"
              >
                <option value="LEAD">Lead</option>
                <option value="INTERESTED">Interessado</option>
                <option value="NEGOTIATION">Negociação</option>
                <option value="CUSTOMER">Cliente</option>
                <option value="NOT_INTERESTED">Sem interesse</option>
              </select>
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

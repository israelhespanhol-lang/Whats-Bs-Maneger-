"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import SectionLayout from "./section-layout";
import { supabase } from "../lib/supabase";
import { useMaisChatContext } from "../lib/use-mais-chat-context";

type ViewFilter = "NEW" | "MINE" | "ALL";

type Funnel = {
  id: string;
  name: string;
  is_default: boolean;
};

type Stage = {
  id: string;
  funnel_id: string;
  name: string;
  color: string;
  position: number;
  semantic_key: string | null;
  is_terminal: boolean;
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
  crm_stage_id: string | null;
  campaign_id: string | null;
  status: string;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  contacts: Contact | Contact[] | null;
};

type Member = {
  id: string;
  users:
    | { name: string; email: string }
    | { name: string; email: string }[]
    | null;
};

type Account = {
  id: string;
  verified_name: string | null;
  display_phone_number: string | null;
  status: string;
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

function relativeTime(value: string | null) {
  if (!value) return "sem mensagem";

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

function initials(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const defaultStages = [
  ["Novo", "#5B8DEF", 10, "NEW", false],
  ["Em atendimento", "#7A6FF0", 20, "IN_SERVICE", false],
  ["Interessado", "#18B77A", 30, "INTERESTED", false],
  ["Proposta enviada", "#D5A11E", 40, "PROPOSAL", false],
  ["Pagamento", "#E98239", 50, "PAYMENT", false],
  ["Venda concluída", "#24A148", 60, "WON", true],
  ["Recusado", "#D84C4C", 70, "LOST", true],
  ["Retomar contato", "#8A96A3", 80, "FOLLOW_UP", false]
] as const;

function contactStatusForStage(semanticKey: string | null) {
  if (semanticKey === "INTERESTED") return "INTERESTED";
  if (semanticKey === "WON") return "CUSTOMER";
  if (semanticKey === "LOST") return "NOT_INTERESTED";
  if (
    semanticKey === "IN_SERVICE" ||
    semanticKey === "PROPOSAL" ||
    semanticKey === "PAYMENT" ||
    semanticKey === "FOLLOW_UP"
  ) {
    return "NEGOTIATION";
  }
  return "LEAD";
}

export default function CrmClient() {
  const ctx = useMaisChatContext();
  const organizationId = ctx.membership?.organization_id ?? null;

  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tagsByContact, setTagsByContact] = useState<Record<string, Tag[]>>({});

  const [funnelId, setFunnelId] = useState("");
  const [channelId, setChannelId] = useState("ALL");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("ALL");
  const [search, setSearch] = useState("");
  const [stageSearch, setStageSearch] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [showFunnelForm, setShowFunnelForm] = useState(false);
  const [newFunnelName, setNewFunnelName] = useState("");
  const [showTagForm, setShowTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#A3E635");
  const [message, setMessage] = useState<string | null>(null);

  async function loadCrm() {
    if (!organizationId) return;

    const [
      funnelResult,
      stageResult,
      conversationResult,
      memberResult,
      accountResult
    ] = await Promise.all([
      supabase
        .from("crm_funnels")
        .select("id,name,is_default")
        .eq("organization_id", organizationId)
        .order("is_default", { ascending: false })
        .order("created_at"),
      supabase
        .from("crm_stages")
        .select("id,funnel_id,name,color,position,semantic_key,is_terminal")
        .eq("organization_id", organizationId)
        .order("position"),
      supabase
        .from("conversations")
        .select(
          "id,whatsapp_account_id,assigned_member_id,crm_stage_id,campaign_id,status,unread_count,last_message_at,last_message_preview,contacts(id,name,phone_e164,status)"
        )
        .eq("organization_id", organizationId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1000),
      supabase
        .from("organization_members")
        .select("id,users(name,email)")
        .eq("organization_id", organizationId),
      supabase
        .from("whatsapp_accounts")
        .select("id,verified_name,display_phone_number,status")
        .eq("organization_id", organizationId)
        .order("created_at")
    ]);

    const firstError =
      funnelResult.error ||
      stageResult.error ||
      conversationResult.error ||
      memberResult.error ||
      accountResult.error;

    if (firstError) {
      setMessage(firstError.message);
      return;
    }

    const funnelRows = (funnelResult.data ?? []) as Funnel[];
    setFunnels(funnelRows);
    setStages((stageResult.data ?? []) as Stage[]);
    setConversations((conversationResult.data ?? []) as Conversation[]);
    setMembers((memberResult.data ?? []) as Member[]);
    setAccounts((accountResult.data ?? []) as Account[]);

    setFunnelId((current) => {
      if (current && funnelRows.some((item) => item.id === current)) {
        return current;
      }
      return funnelRows.find((item) => item.is_default)?.id ?? funnelRows[0]?.id ?? "";
    });

    const contactIds = (conversationResult.data ?? [])
      .map((row: any) => one(row.contacts)?.id)
      .filter(Boolean) as string[];

    if (contactIds.length) {
      const { data: contactTagRows } = await supabase
        .from("contact_tags")
        .select("contact_id,tags(id,name,color)")
        .in("contact_id", contactIds);

      const map: Record<string, Tag[]> = {};
      for (const row of (contactTagRows ?? []) as ContactTagRow[]) {
        const tag = one(row.tags);
        if (!tag) continue;
        map[row.contact_id] = [...(map[row.contact_id] ?? []), tag];
      }
      setTagsByContact(map);
    } else {
      setTagsByContact({});
    }
  }

  useEffect(() => {
    if (!organizationId) return;

    void loadCrm();

    const channel = supabase
      .channel(`crm:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `organization_id=eq.${organizationId}`
        },
        () => void loadCrm()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "crm_stages",
          filter: `organization_id=eq.${organizationId}`
        },
        () => void loadCrm()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId]);

  const memberNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const member of members) {
      const user = one(member.users);
      map[member.id] = user?.name || user?.email || "Atendente";
    }
    return map;
  }, [members]);

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();

    return conversations.filter((conversation) => {
      const contact = one(conversation.contacts);
      const label = `${contact?.name ?? ""} ${contact?.phone_e164 ?? ""} ${conversation.last_message_preview ?? ""}`.toLowerCase();

      if (channelId !== "ALL" && conversation.whatsapp_account_id !== channelId) {
        return false;
      }

      if (viewFilter === "NEW" && conversation.assigned_member_id !== null) {
        return false;
      }

      if (
        viewFilter === "MINE" &&
        conversation.assigned_member_id !== ctx.membership?.id
      ) {
        return false;
      }

      if (term && !label.includes(term)) return false;
      return true;
    });
  }, [
    conversations,
    search,
    channelId,
    viewFilter,
    ctx.membership?.id
  ]);

  const funnelStages = useMemo(() => {
    const term = stageSearch.trim().toLowerCase();
    return stages.filter(
      (stage) =>
        stage.funnel_id === funnelId &&
        (!term || stage.name.toLowerCase().includes(term))
    );
  }, [stages, funnelId, stageSearch]);

  const counts = useMemo(
    () => ({
      new: conversations.filter((item) => item.assigned_member_id === null).length,
      mine: conversations.filter(
        (item) => item.assigned_member_id === ctx.membership?.id
      ).length,
      all: conversations.length
    }),
    [conversations, ctx.membership?.id]
  );

  async function moveConversation(conversationId: string, stage: Stage) {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) return;

    const contact = one(conversation.contacts);
    const nextContactStatus = contactStatusForStage(stage.semantic_key);

    setConversations((current) =>
      current.map((item) =>
        item.id === conversationId
          ? { ...item, crm_stage_id: stage.id }
          : item
      )
    );

    const { error } = await supabase
      .from("conversations")
      .update({ crm_stage_id: stage.id })
      .eq("id", conversationId);

    if (error) {
      setMessage(error.message);
      await loadCrm();
      return;
    }

    if (contact && contact.status !== nextContactStatus) {
      await supabase
        .from("contacts")
        .update({ status: nextContactStatus })
        .eq("id", contact.id);
    }
  }

  async function createFunnel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !ctx.userId || !newFunnelName.trim()) return;

    const { data: funnel, error } = await supabase
      .from("crm_funnels")
      .insert({
        organization_id: organizationId,
        name: newFunnelName.trim(),
        is_default: false,
        created_by: ctx.userId
      })
      .select("id")
      .single();

    if (error || !funnel) {
      setMessage(error?.message ?? "Não foi possível criar o funil.");
      return;
    }

    const { error: stagesError } = await supabase.from("crm_stages").insert(
      defaultStages.map(([name, color, position, semantic_key, is_terminal]) => ({
        organization_id: organizationId,
        funnel_id: funnel.id,
        name,
        color,
        position,
        semantic_key,
        is_terminal
      }))
    );

    if (stagesError) {
      setMessage(stagesError.message);
      return;
    }

    setNewFunnelName("");
    setShowFunnelForm(false);
    setFunnelId(funnel.id);
    await loadCrm();
  }

  async function createTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !newTagName.trim()) return;

    const { error } = await supabase.from("tags").insert({
      organization_id: organizationId,
      name: newTagName.trim(),
      color: newTagColor
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setNewTagName("");
    setShowTagForm(false);
    setMessage("Etiqueta criada. Ela já pode ser usada nos contatos.");
  }

  return (
    <SectionLayout
      active="crm"
      loading={ctx.loading}
      membership={ctx.membership}
      account={ctx.account}
      userName={ctx.userName}
      unread={ctx.unread}
      error={ctx.error}
      onSignOut={() => void ctx.signOut()}
      eyebrow="CRM"
      title="Kanban de atendimento"
      description="Etapa comercial, responsável, campanha e etiquetas ficam separados para evitar a mistura observada no sistema de referência."
      actions={
        <div className="crmTopActions">
          <button
            className="secondaryAction"
            onClick={() => setShowTagForm((value) => !value)}
          >
            + Etiqueta
          </button>
          <button
            className="primaryAction"
            onClick={() => setShowFunnelForm((value) => !value)}
          >
            + Novo funil
          </button>
        </div>
      }
    >
      {(showFunnelForm || showTagForm) && (
        <div className="crmQuickForms">
          {showFunnelForm && (
            <form onSubmit={createFunnel}>
              <label>Novo funil</label>
              <input
                value={newFunnelName}
                onChange={(event) => setNewFunnelName(event.target.value)}
                placeholder="Ex.: Grupos internacionais"
                required
              />
              <button className="primaryAction">Criar</button>
            </form>
          )}

          {showTagForm && (
            <form onSubmit={createTag}>
              <label>Nova etiqueta</label>
              <input
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
                placeholder="Ex.: Israel Outubro"
                required
              />
              <input
                className="crmColorInput"
                type="color"
                value={newTagColor}
                onChange={(event) => setNewTagColor(event.target.value)}
                aria-label="Cor da etiqueta"
              />
              <button className="primaryAction">Criar</button>
            </form>
          )}
        </div>
      )}

      <div className="crmControlBar">
        <div className="crmTabs">
          <button
            className={viewFilter === "NEW" ? "active" : ""}
            onClick={() => setViewFilter("NEW")}
          >
            Novos <span>{counts.new}</span>
          </button>
          <button
            className={viewFilter === "MINE" ? "active" : ""}
            onClick={() => setViewFilter("MINE")}
          >
            Meus <span>{counts.mine}</span>
          </button>
          <button
            className={viewFilter === "ALL" ? "active" : ""}
            onClick={() => setViewFilter("ALL")}
          >
            Todos <span>{counts.all}</span>
          </button>
        </div>

        <select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
          <option value="ALL">Todos os canais</option>
          {accounts.map((account) => (
            <option value={account.id} key={account.id}>
              {account.verified_name || account.display_phone_number || "WhatsApp"}
            </option>
          ))}
        </select>

        <select value={funnelId} onChange={(event) => setFunnelId(event.target.value)}>
          {funnels.map((funnel) => (
            <option key={funnel.id} value={funnel.id}>
              {funnel.name}
            </option>
          ))}
        </select>

        <label className="crmSearch">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar chats..."
          />
        </label>

        <label className="crmSearch stageSearch">
          <span>▦</span>
          <input
            value={stageSearch}
            onChange={(event) => setStageSearch(event.target.value)}
            placeholder="Buscar etapas..."
          />
        </label>
      </div>

      <div className="crmKanban">
        {funnelStages.map((stage) => {
          const stageConversations = filteredConversations.filter(
            (conversation) => conversation.crm_stage_id === stage.id
          );

          return (
            <section
              className="crmColumn"
              key={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggingId) {
                  void moveConversation(draggingId, stage);
                  setDraggingId(null);
                }
              }}
            >
              <header style={{ borderTopColor: stage.color }}>
                <div>
                  <i style={{ background: stage.color }} />
                  <strong>{stage.name}</strong>
                </div>
                <span>{stageConversations.length}</span>
              </header>

              <div className="crmColumnActions">
                <button
                  type="button"
                  disabled
                  title="Automação por etapa ainda não está disponível no Mais Chat."
                >
                  Automação — em breve
                </button>
              </div>

              <div className="crmCards">
                {stageConversations.map((conversation) => {
                  const contact = one(conversation.contacts);
                  if (!contact) return null;

                  const assignee = conversation.assigned_member_id
                    ? memberNames[conversation.assigned_member_id]
                    : null;
                  const tags = tagsByContact[contact.id] ?? [];

                  return (
                    <article
                      draggable
                      className="crmCard"
                      key={conversation.id}
                      onDragStart={() => setDraggingId(conversation.id)}
                      onDragEnd={() => setDraggingId(null)}
                    >
                      <div className="crmCardTop">
                        <div className="crmAvatar">
                          {initials(contact.name || contact.phone_e164)}
                        </div>
                        <div>
                          <strong>{contact.name || "Sem nome"}</strong>
                          <span>{contact.phone_e164}</span>
                        </div>
                        <time>{relativeTime(conversation.last_message_at)}</time>
                      </div>

                      <p>{conversation.last_message_preview || "Sem prévia de mensagem."}</p>

                      <div className="crmCardMeta">
                        <span className={assignee ? "assignee" : "unassigned"}>
                          {assignee ? initials(assignee) : "Novo"}
                        </span>

                        {tags.slice(0, 2).map((tag) => (
                          <span
                            className="crmTag"
                            key={tag.id}
                            style={{ borderColor: tag.color, color: tag.color }}
                          >
                            {tag.name}
                          </span>
                        ))}

                        {tags.length > 2 && <span className="crmMoreTags">+{tags.length - 2}</span>}

                        {conversation.unread_count > 0 && (
                          <span className="crmUnread">{conversation.unread_count}</span>
                        )}
                      </div>
                    </article>
                  );
                })}

                {stageConversations.length === 0 && (
                  <div className="crmEmptyColumn">Arraste conversas para esta etapa.</div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {message && <div className="sectionNotice">{message}</div>}
    </SectionLayout>
  );
}

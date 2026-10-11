"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "./brand-logo";
import AppSidebar from "./app-sidebar";
import { supabase } from "../lib/supabase";
import {
  clearMaisChatContextSnapshot,
  getMaisChatContextSnapshot,
  primeMaisChatContextSnapshot
} from "../lib/use-mais-chat-context";

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

type AssignmentEvent = {
  id: string;
  from_member_id: string | null;
  to_member_id: string | null;
  created_at: string;
};
type InternalNote = {
  id: string;
  conversation_id: string;
  body: string;
  created_by_name: string;
  created_at: string;
};
type QuickReply = {
  id: string;
  shortcut: string;
  title: string;
  body: string;
};
type ComposerTool = "notes" | "quick" | "emoji" | null;

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

const MESSAGE_PAGE_SIZE = 80;
const CACHE_LIMIT = 25;
type CachedMessages = { items: Message[]; hasMore: boolean; fetchedAt: number };
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

type CampaignOption = {
  id: string;
  name: string;
  status: string;
};

type CrmStageOption = {
  id: string;
  name: string;
  color: string;
  semantic_key: string | null;
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
  const cachedShell = getMaisChatContextSnapshot();
  const [loading, setLoading] = useState(!cachedShell?.membership);
  const [membership, setMembership] = useState<Membership | null>(
    (cachedShell?.membership as Membership | null) ?? null
  );
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userName, setUserName] = useState(cachedShell?.userName ?? "Usuário");
  const [account, setAccount] = useState<WhatsAppAccount | null>(
    (cachedShell?.account as WhatsAppAccount | null) ?? null
  );
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [channelDraftIds, setChannelDraftIds] = useState<string[]>([]);
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [campaignOptions, setCampaignOptions] = useState<CampaignOption[]>([]);
  const [crmStages, setCrmStages] = useState<CrmStageOption[]>([]);
  const [tagsByContact, setTagsByContact] = useState<Record<string, Tag[]>>({});
  const [messageMatchConversationIds, setMessageMatchConversationIds] =
    useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const messageCacheRef = useRef<Map<string, CachedMessages>>(new Map());
  const conversationsRef = useRef<Conversation[]>([]);
  const inboxRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draft, setDraft] = useState("");
  const [composerTool, setComposerTool] = useState<ComposerTool>(null);
  const [internalNotes, setInternalNotes] = useState<InternalNote[]>([]);
  const [assignmentEvents, setAssignmentEvents] = useState<AssignmentEvent[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickShortcut, setQuickShortcut] = useState("");
  const [quickBody, setQuickBody] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
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
  const [contactPanelOpen, setContactPanelOpen] = useState(true);
  const channelSelectorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const writeMessageCache = useCallback((conversationId: string, items: Message[], hasMore?: boolean) => {
    const cache = messageCacheRef.current;
    const previous = cache.get(conversationId);
    cache.delete(conversationId);
    cache.set(conversationId, {
      items,
      hasMore: hasMore ?? previous?.hasMore ?? false,
      fetchedAt: Date.now()
    });
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);

  const patchSelectedMessages = useCallback((update: (current: Message[]) => Message[]) => {
    setMessages((current) => {
      const next = update(current);
      if (selectedIdRef.current) writeMessageCache(selectedIdRef.current, next);
      return next;
    });
  }, [writeMessageCache]);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  // A small anchored popover, not a fullscreen modal: close on an outside
  // click or Escape, without committing the unsaved draft selection.
  useEffect(() => {
    if (!channelPickerOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (
        channelSelectorRef.current &&
        !channelSelectorRef.current.contains(event.target as Node)
      ) {
        setChannelPickerOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setChannelPickerOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [channelPickerOpen]);


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

  const suggestedQuickReplies = useMemo(() => {
    const term = draft.startsWith("/") ? draft.slice(1).toLowerCase() : "";
    return quickReplies.filter((item) => !term ||
      item.shortcut.includes(term) || item.title.toLowerCase().includes(term)
    ).slice(0, 12);
  }, [draft, quickReplies]);

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
    conversationsRef.current = typedRows;
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
      const cached = messageCacheRef.current.get(conversationId);
      if (!options?.background && !cached) setMessagesLoading(true);
      const { data: rows, error: messageError } = await supabase
        .from("messages")
        .select("id,direction,message_type,body,status,created_at,sent_at,delivered_at,read_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);
      if (messageError) {
        if (selectedIdRef.current === conversationId) setError(messageError.message);
      } else {
        const fetched = [...(rows ?? [])].reverse() as Message[];
        const pending = (messageCacheRef.current.get(conversationId)?.items ?? [])
          .filter((message) => message.optimistic);
        const merged = sortMessages([
          ...fetched,
          ...pending.filter((item) => !fetched.some((row) => row.id === item.id))
        ]);
        const hasMore = fetched.length === MESSAGE_PAGE_SIZE;
        writeMessageCache(conversationId, merged, hasMore);
        if (selectedIdRef.current === conversationId) {
          setMessages((current) => {
            const live = current.filter((item) => !merged.some((server) => server.id === item.id));
            const next = sortMessages([...merged, ...live]);
            writeMessageCache(conversationId, next, hasMore);
            return next;
          });
          setHasOlderMessages(hasMore);
        }
      }
      if (selectedIdRef.current === conversationId) setMessagesLoading(false);
    },
    [writeMessageCache]
  );

  const loadOlderMessages = useCallback(async () => {
    const conversationId = selectedIdRef.current;
    if (!conversationId || olderLoading || !hasOlderMessages) return;
    const oldest = messageCacheRef.current.get(conversationId)?.items
      .filter((message) => !message.optimistic)[0];
    if (!oldest) return;
    setOlderLoading(true);
    shouldAutoScrollRef.current = false;
    const { data, error: historyError } = await supabase
      .from("messages")
      .select("id,direction,message_type,body,status,created_at,sent_at,delivered_at,read_at")
      .eq("conversation_id", conversationId)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE);
    if (selectedIdRef.current === conversationId) {
      if (historyError) setError(historyError.message);
      else {
        const older = [...(data ?? [])].reverse() as Message[];
        const hasMore = older.length === MESSAGE_PAGE_SIZE;
        setMessages((current) => {
          const next = sortMessages([
            ...older.filter((item) => !current.some((present) => present.id === item.id)),
            ...current
          ]);
          writeMessageCache(conversationId, next, hasMore);
          return next;
        });
        setHasOlderMessages(hasMore);
      }
    }
    setOlderLoading(false);
  }, [olderLoading, hasOlderMessages, writeMessageCache]);

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

      const nextUserName =
        session.user.user_metadata?.name ||
        session.user.email?.split("@")[0] ||
        "Usuário";

      setUserName(nextUserName);
      primeMaisChatContextSnapshot({
        userId: session.user.id,
        userName: nextUserName,
        error: null
      });

      const { data: member, error: memberError } = await supabase
        .from("organization_members")
        .select("id, organization_id, role, organizations(name,slug)")
        .eq("user_id", session.user.id)
        .limit(1)
        .maybeSingle();

      if (memberError) {
        setError(memberError.message);
        primeMaisChatContextSnapshot({ error: memberError.message });
        setLoading(false);
        return;
      }

      if (!member) {
        setLoading(false);
        return;
      }

      const typedMember = member as Membership;
      setMembership(typedMember);
      primeMaisChatContextSnapshot({
        membership: typedMember,
        error: null
      });

      const { data: accountRows } = await supabase
        .from("whatsapp_accounts")
        .select("id,status,display_phone_number,verified_name")
        .eq("organization_id", typedMember.organization_id)
        .order("created_at", { ascending: true });

      const typedAccounts = (accountRows ?? []) as WhatsAppAccount[];
      const nextAccount = typedAccounts[0] ?? null;
      setAccounts(typedAccounts);
      setAccount(nextAccount);
      primeMaisChatContextSnapshot({ account: nextAccount });
      setSelectedChannelIds(
        typedAccounts
          .filter((item) => item.status === "CONNECTED")
          .map((item) => item.id)
      );

      const [campaignResult, stageResult, tagCatalogResult] = await Promise.all([
        supabase
          .from("campaigns")
          .select("id,name,status")
          .eq("organization_id", typedMember.organization_id)
          .neq("status", "ARCHIVED")
          .order("created_at", { ascending: false }),
        supabase
          .from("crm_stages")
          .select("id,name,color,semantic_key")
          .eq("organization_id", typedMember.organization_id)
          .order("position"),
        supabase
          .from("tags")
          .select("id,name,color")
          .eq("organization_id", typedMember.organization_id)
          .order("name")
      ]);

      if (!campaignResult.error) {
        setCampaignOptions((campaignResult.data ?? []) as CampaignOption[]);
      }
      if (!stageResult.error) {
        setCrmStages((stageResult.data ?? []) as CrmStageOption[]);
      }
      if (!tagCatalogResult.error) {
        setAllTags((tagCatalogResult.data ?? []) as Tag[]);
      }

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

    primeMaisChatContextSnapshot({
      membership,
      account,
      userName,
      unread: conversations.reduce(
        (sum, item) => sum + Number(item.unread_count ?? 0),
        0
      ),
      error
    });
  }, [membership, account, userName, conversations, error]);

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

          const known = conversationsRef.current.some((item) => item.id === changed.id);
          if (!known) {
            if (inboxRefreshTimerRef.current) clearTimeout(inboxRefreshTimerRef.current);
            inboxRefreshTimerRef.current = setTimeout(() => {
              void loadConversations(membership.organization_id);
              inboxRefreshTimerRef.current = null;
            }, 350);
            return;
          }
          setConversations((current) => sortConversations(current.map((item) => {
            if (item.id !== changed.id) return item;
            return {
              ...item,
              assigned_member_id: changed.assigned_member_id === undefined ? item.assigned_member_id : changed.assigned_member_id,
              campaign_id: changed.campaign_id === undefined ? item.campaign_id : changed.campaign_id,
              crm_stage_id: changed.crm_stage_id === undefined ? item.crm_stage_id : changed.crm_stage_id,
              status: changed.status ?? item.status,
              unread_count: changed.unread_count ?? item.unread_count,
              last_message_at: changed.last_message_at === undefined ? item.last_message_at : changed.last_message_at,
              last_message_preview: changed.last_message_preview === undefined ? item.last_message_preview : changed.last_message_preview,
              last_message_direction: changed.last_message_direction === undefined ? item.last_message_direction : changed.last_message_direction,
              customer_service_window_expires_at: changed.customer_service_window_expires_at === undefined
                ? item.customer_service_window_expires_at
                : changed.customer_service_window_expires_at
            };
          })));

        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      if (inboxRefreshTimerRef.current) {
        clearTimeout(inboxRefreshTimerRef.current);
        inboxRefreshTimerRef.current = null;
      }
    };
  }, [membership, loadConversations]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setHasOlderMessages(false);
      return;
    }

    selectedIdRef.current = selectedId;
    shouldAutoScrollRef.current = true;
    const cached = messageCacheRef.current.get(selectedId);
    setMessages(cached?.items ?? []);
    setHasOlderMessages(cached?.hasMore ?? false);
    setMessagesLoading(!cached);
    if (!cached || Date.now() - cached.fetchedAt > 20_000) {
      void loadMessages(selectedId, { background: Boolean(cached) });
    }

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
            patchSelectedMessages((current) => upsertMessage(current, incoming));
            return;
          }

          if (payload.eventType === "UPDATE") {
            const incoming = payload.new as Message;
            patchSelectedMessages((current) => upsertMessage(current, incoming));
            return;
          }

          if (payload.eventType === "DELETE") {
            const removedId = (payload.old as { id?: string })?.id;
            if (removedId) {
              patchSelectedMessages((current) =>
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
  }, [selectedId, loadMessages, patchSelectedMessages]);

  useEffect(() => {
    if (!membership) return;
    let active = true;
    async function loadQuickReplies() {
      const { data } = await supabase.from("team_quick_replies")
        .select("id,shortcut,title,body")
        .eq("organization_id", membership!.organization_id).order("shortcut");
      if (active) setQuickReplies((data ?? []) as QuickReply[]);
    }
    void loadQuickReplies();
    const channel = supabase.channel(`quick-replies:${membership.organization_id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "team_quick_replies",
        filter: `organization_id=eq.${membership.organization_id}`
      }, () => void loadQuickReplies()).subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [membership]);

  useEffect(() => {
    if (!selectedId) { setAssignmentEvents([]); return; }
    let live = true;
    async function loadAssignments() {
      const { data } = await supabase.from("conversation_assignment_history")
        .select("id,from_member_id,to_member_id,created_at")
        .eq("conversation_id", selectedId).order("created_at", { ascending: false }).limit(20);
      if (live) setAssignmentEvents((data ?? []) as AssignmentEvent[]);
    }
    void loadAssignments();
    const channel = supabase.channel(`assignment-events:${selectedId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "conversation_assignment_history",
        filter: `conversation_id=eq.${selectedId}`
      }, () => void loadAssignments()).subscribe();
    return () => { live = false; void supabase.removeChannel(channel); };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) { setInternalNotes([]); return; }
    let active = true;
    async function loadNotes() {
      const { data } = await supabase.from("conversation_internal_notes")
        .select("id,conversation_id,body,created_by_name,created_at")
        .eq("conversation_id", selectedId).order("created_at", { ascending: false }).limit(50);
      if (active) setInternalNotes((data ?? []) as InternalNote[]);
    }
    void loadNotes();
    const channel = supabase.channel(`internal-notes:${selectedId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "conversation_internal_notes",
        filter: `conversation_id=eq.${selectedId}`
      }, () => void loadNotes()).subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [selectedId]);

  async function saveInternalNote() {
    if (!selected || !membership || !noteDraft.trim() || noteSaving) return;
    setNoteSaving(true);
    const noteText = noteDraft.trim();
    const { data, error: noteError } = await supabase.from("conversation_internal_notes")
      .insert({
        organization_id: membership.organization_id,
        conversation_id: selected.id,
        created_by_member_id: membership.id,
        created_by_name: userName,
        body: noteText
      }).select("id,conversation_id,body,created_by_name,created_at").single();
    if (noteError) setError("Não foi possível salvar a nota: " + noteError.message);
    else {
      if (data && selectedIdRef.current === selected.id) {
        setInternalNotes((current) => [data as InternalNote, ...current.filter((note) => note.id !== data.id)]);
      }
      setNoteDraft("");
    }
    setNoteSaving(false);
  }

  async function saveQuickReply() {
    if (!membership || quickSaving || !quickTitle.trim() || !quickBody.trim()) return;
    const shortcut = quickShortcut.trim().toLowerCase().replace(/^\//, "");
    if (!/^[a-z0-9_-]{2,30}$/.test(shortcut)) {
      setError("O atalho deve ter de 2 a 30 caracteres: letras minúsculas, números, - ou _.");
      return;
    }
    setQuickSaving(true);
    const { data, error: quickError } = await supabase.from("team_quick_replies")
      .insert({
        organization_id: membership.organization_id,
        created_by_member_id: membership.id,
        created_by_name: userName,
        title: quickTitle.trim(),
        shortcut,
        body: quickBody.trim()
      }).select("id,shortcut,title,body").single();
    if (quickError) setError("Não foi possível salvar a resposta rápida: " + quickError.message);
    else {
      setQuickReplies((items) => [...items.filter((item) => item.id !== data.id), data as QuickReply].sort((a,b) => a.shortcut.localeCompare(b.shortcut)));
      setQuickTitle("");
      setQuickShortcut("");
      setQuickBody("");
    }
    setQuickSaving(false);
  }

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

    const nextStatus = selected.status === "RESOLVED" ? "OPEN" : "RESOLVED";
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

  async function updateConversationAssignee(memberId: string) {
    if (!selected || !membership) return;

    const next = memberId || null;
    setConversations((current) =>
      current.map((item) =>
        item.id === selected.id
          ? { ...item, assigned_member_id: next }
          : item
      )
    );

    const { error: assignmentError } = await supabase
      .from("conversations")
      .update({ assigned_member_id: next })
      .eq("id", selected.id);

    if (assignmentError) {
      setError(assignmentError.message);
      await loadConversations(membership.organization_id);
    }
  }

  async function updateConversationCampaign(campaignId: string) {
    if (!selected || !membership) return;

    const next = campaignId || null;
    setConversations((current) =>
      current.map((item) =>
        item.id === selected.id ? { ...item, campaign_id: next } : item
      )
    );

    const { error: campaignError } = await supabase
      .from("conversations")
      .update({ campaign_id: next })
      .eq("id", selected.id);

    if (campaignError) {
      setError(campaignError.message);
      await loadConversations(membership.organization_id);
    }
  }

  async function updateConversationStage(stageId: string) {
    if (!selected || !membership || !contact) return;

    const next = stageId || null;
    setConversations((current) =>
      current.map((item) =>
        item.id === selected.id ? { ...item, crm_stage_id: next } : item
      )
    );

    const { error: stageError } = await supabase
      .from("conversations")
      .update({ crm_stage_id: next })
      .eq("id", selected.id);

    if (stageError) {
      setError(stageError.message);
      await loadConversations(membership.organization_id);
      return;
    }

    const stage = crmStages.find((item) => item.id === next);
    const mappedStatus =
      stage?.semantic_key === "INTERESTED"
        ? "INTERESTED"
        : stage?.semantic_key === "WON"
          ? "CUSTOMER"
          : stage?.semantic_key === "LOST"
            ? "NOT_INTERESTED"
            : stage?.semantic_key &&
                ["IN_SERVICE", "PROPOSAL", "PAYMENT", "FOLLOW_UP"].includes(
                  stage.semantic_key
                )
              ? "NEGOTIATION"
              : "LEAD";

    if (stage) {
      await updateContactStatus(contact.id, mappedStatus);
    }
  }

  async function toggleContactTag(tag: Tag) {
    if (!contact) return;

    const current = tagsByContact[contact.id] ?? [];
    const exists = current.some((item) => item.id === tag.id);

    setTagsByContact((all) => ({
      ...all,
      [contact.id]: exists
        ? current.filter((item) => item.id !== tag.id)
        : [...current, tag]
    }));

    const result = exists
      ? await supabase
          .from("contact_tags")
          .delete()
          .eq("contact_id", contact.id)
          .eq("tag_id", tag.id)
      : await supabase.from("contact_tags").insert({
          contact_id: contact.id,
          tag_id: tag.id
        });

    if (result.error) {
      setError(result.error.message);
      if (membership) await loadConversations(membership.organization_id);
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
    clearMaisChatContextSnapshot();
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
  const contactTags = contact ? tagsByContact[contact.id] ?? [] : [];
  const currentAssignee = selected?.assigned_member_id
    ? memberNames[selected.assigned_member_id] ?? "Atendente"
    : "Não atribuído";
  const unread = conversations.reduce((sum, item) => sum + item.unread_count, 0);
  const connected = account?.status === "CONNECTED";
  const windowText = selected
    ? windowRemaining(selected.customer_service_window_expires_at)
    : null;

  return (
    <main className={`appShell ${contactPanelOpen ? "" : "contactPanelClosed"}`}>
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
              onClick={() => {
                setChannelDraftIds(selectedChannelIds);
                setChannelPickerOpen(true);
                setFilterPanelOpen(false);
              }}
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
          <div className="channelSelectorAnchor" ref={channelSelectorRef}>
            <button
              type="button"
              aria-expanded={channelPickerOpen}
              aria-controls="channel-picker-menu"
              aria-haspopup="dialog"
              className={`channelSelectorButton ${channelPickerOpen ? "active" : ""}`}
              onClick={() => {
                if (channelPickerOpen) {
                  setChannelPickerOpen(false);
                } else {
                  setChannelDraftIds(selectedChannelIds);
                  setChannelPickerOpen(true);
                  setFilterPanelOpen(false);
                }
              }}
            >
              <span className="channelSelectorSymbol" aria-hidden="true">◉</span>
              <i className={connected ? "online" : ""} />
              <div>
                <strong>
                  {selectedChannelIds.length === accounts.length
                    ? "Todos os canais"
                    : selectedChannelIds.length === 1
                      ? accounts.find((item) => item.id === selectedChannelIds[0])
                          ?.verified_name || "1 canal selecionado"
                      : `${selectedChannelIds.length} canais selecionados`}
                </strong>
                <span>
                  {selectedChannelIds.length === 1
                    ? accounts.find((item) => item.id === selectedChannelIds[0])
                        ?.display_phone_number || "WhatsApp"
                    : `${selectedChannelIds.length} de ${accounts.length} canais`}
                </span>
              </div>
              <b aria-hidden="true">{channelPickerOpen ? "⌃" : "⌄"}</b>
            </button>

            {channelPickerOpen && (
              <div
                id="channel-picker-menu"
                className="channelDropdown"
                role="dialog"
                aria-label="Selecionar canais de atendimento"
                aria-modal="false"
              >
                <button
                  type="button"
                  className={`channelDropdownAll ${channelDraftIds.length === accounts.length && accounts.length > 0 ? "selected" : ""}`}
                  onClick={() => {
                    setChannelDraftIds(accounts.map((item) => item.id));
                  }}
                >
                  <span className="channelDropdownStack" aria-hidden="true">▱</span>
                  <span>Todos os canais</span>
                  {channelDraftIds.length === accounts.length && accounts.length > 0 && (
                    <span className="channelDropdownCheck" aria-hidden="true">✓</span>
                  )}
                </button>

                <div className="channelDropdownList">
                  {accounts.length === 0 ? (
                    <p className="channelDropdownEmpty">Nenhum canal cadastrado.</p>
                  ) : (
                    accounts.map((channel) => {
                      const chosen = channelDraftIds.includes(channel.id);
                      const unreadCount = conversations
                        .filter((conversation) => conversation.whatsapp_account_id === channel.id)
                        .reduce((sum, conversation) => sum + Number(conversation.unread_count || 0), 0);
                      return (
                        <button
                          type="button"
                          key={channel.id}
                          className={`channelDropdownItem ${chosen ? "selected" : ""}`}
                          aria-pressed={chosen}
                          onClick={() => {
                            setChannelDraftIds((current) =>
                              current.includes(channel.id)
                                ? current.filter((id) => id !== channel.id)
                                : [...current, channel.id]
                            );
                          }}
                        >
                          <span className="channelDropdownIcon" aria-hidden="true">WA</span>
                          <span
                            className={`channelDropdownStatus ${channel.status === "CONNECTED" ? "connected" : ""}`}
                            aria-label={channel.status === "CONNECTED" ? "Conectado" : "Desconectado"}
                          />
                          <span className="channelDropdownDetails">
                            <strong>{channel.verified_name || "WhatsApp API"}</strong>
                            <small>{channel.display_phone_number || "Sem número"}</small>
                          </span>
                          {unreadCount > 0 && (
                            <span className="channelDropdownUnread" aria-label={`${unreadCount} não lidas`}>
                              {unreadCount > 99 ? "99+" : unreadCount}
                            </span>
                          )}
                          {chosen && <span className="channelDropdownTick" aria-hidden="true">✓</span>}
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="channelDropdownActions">
                  <button
                    type="button"
                    className="channelDropdownCancel"
                    onClick={() => setChannelPickerOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="channelDropdownApply"
                    disabled={channelDraftIds.length === 0}
                    onClick={() => {
                      setSelectedChannelIds([...channelDraftIds]);
                      setChannelPickerOpen(false);
                    }}
                  >
                    Aplicar ({channelDraftIds.length})
                  </button>
                </div>
              </div>
            )}
          </div>
        </footer>
      </section>

      <section className={messageSearchOpen && selected && contact ? "chat chatWithSearch" : "chat"}>
        {selected && contact ? (
          <>
            <header className="chatHeader flowLikeChatHeader">
              <div className="contactIdentity contactIdentityRich">
                <div className="avatar large">
                  {initials(contact.name, contact.phone_e164)}
                </div>
                <div className="contactIdentityCopy">
                  <strong>{contact.name || contact.phone_e164}</strong>
                  <span>{contact.phone_e164}</span>
                  <div className="chatHeaderTags">
                    {contactTags.slice(0, 2).map((tag) => (
                      <span
                        key={tag.id}
                        style={{ borderColor: tag.color, color: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))}
                    {contactTags.length > 2 && <span>+{contactTags.length - 2}</span>}
                  </div>
                </div>
              </div>
              <div className="chatActions flowLikeChatActions">
                <button
                  type="button"
                  title="Buscar mensagens"
                  className={messageSearchOpen ? "iconAction active" : "iconAction"}
                  onClick={() => {
                    setMessageSearchOpen((current) => !current);
                    setActionsOpen(false);
                    if (messageSearchOpen) setMessageSearch("");
                  }}
                >
                  ⌕
                </button>
                {selected.unread_count > 0 && (
                  <button
                    type="button"
                    className="headerAction successAction"
                    title="Marcar conversa como lida"
                    onClick={() => void markConversationRead()}
                  >
                    ✓ <span>Marcar como lida</span>
                  </button>
                )}
                <button
                  type="button"
                  className="headerAction warningAction"
                  onClick={() => setContactPanelOpen(true)}
                  title="Gerenciar etiquetas"
                >
                  ◇ <span>Etiquetas</span>
                </button>
                <button
                  type="button"
                  className="headerAction dangerAction"
                  onClick={() => void toggleConversationClosed()}
                  title={selected.status === "RESOLVED" ? "Reabrir conversa" : "Arquivar conversa"}
                >
                  ▣ <span>{selected.status === "RESOLVED" ? "Reabrir" : "Arquivar"}</span>
                </button>
                <select
                  className="headerAssigneeSelect"
                  value={selected.assigned_member_id ?? ""}
                  onChange={(event) => void updateConversationAssignee(event.target.value)}
                  aria-label="Responsável pela conversa"
                  title={currentAssignee}
                >
                  <option value="">Não atribuído</option>
                  {Object.entries(memberNames).map(([id, name]) => (
                    <option value={id} key={id}>{name}</option>
                  ))}
                </select>
                {!contactPanelOpen && (
                  <button
                    type="button"
                    className="iconAction"
                    title="Abrir informações do contato"
                    onClick={() => setContactPanelOpen(true)}
                  >
                    ◫
                  </button>
                )}
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
                        {selected.status === "RESOLVED"
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
              {hasOlderMessages && !messageSearch.trim() && (
                <div className="messageHistoryLoad">
                  <button type="button" className="detailsButton"
                    onClick={() => void loadOlderMessages()} disabled={olderLoading}>
                    {olderLoading ? "Buscando histórico..." : "Carregar mensagens anteriores"}
                  </button>
                </div>
              )}
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

            <footer className={`composer flowLikeComposer ${connected ? "" : "composerLocked"}`}>
              {(composerTool === "notes" || composerTool === "quick" || composerTool === "emoji" || draft.startsWith("/")) && (
                <div className="chatUtilityPopover" role="region" aria-label="Ferramentas de atendimento">
                  <div className="chatUtilityHeader">
                    <strong>{composerTool === "notes" ? "Notas internas" : composerTool === "emoji" ? "Emojis" : "Respostas rápidas da equipe"}</strong>
                    <button type="button" aria-label="Fechar ferramentas" onClick={() => { setComposerTool(null); if (draft.startsWith("/")) setDraft(""); }}>×</button>
                  </div>
                  {composerTool === "notes" ? (
                    <div className="chatUtilityContent">
                      <p className="chatUtilityHelp">Visível apenas para atendentes. Não é enviado ao cliente.</p>
                      <div className="chatNotesList">
                        {internalNotes.length === 0 ? <small>Nenhuma nota interna ainda.</small> :
                          internalNotes.map((note) => (
                            <div className="chatInternalNote" key={note.id}>
                              <strong>{note.created_by_name} · {time(note.created_at)}</strong>
                              <p>{note.body}</p>
                            </div>
                          ))}
                      </div>
                      <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="Escreva uma observação para a equipe..." maxLength={4000} rows={3}/>
                      <button type="button" className="chatUtilityPrimary" disabled={!noteDraft.trim() || noteSaving}
                        onClick={() => void saveInternalNote()}>
                        {noteSaving ? "Salvando..." : "Salvar nota interna"}
                      </button>
                    </div>
                  ) : composerTool === "emoji" ? (
                    <div className="chatEmojiGrid">
                      {["😀","😊","😉","😍","🙏","👍","✅","🎉","✨","❤️","📌","📅","💬","👋","💚","☀️"].map((emoji) => (
                        <button type="button" key={emoji} onClick={() => { setDraft((text) => text + emoji); setComposerTool(null); }}
                          aria-label={`Inserir ${emoji}`}>{emoji}</button>
                      ))}
                    </div>
                  ) : (
                    <div className="chatUtilityContent">
                      <p className="chatUtilityHelp">Selecione uma resposta ou digite /atalho no campo de mensagem. Nada é enviado automaticamente.</p>
                      <div className="chatQuickReplyList">
                        {suggestedQuickReplies.length === 0 ? <small>Nenhuma resposta encontrada. Cadastre uma abaixo.</small> :
                          suggestedQuickReplies.map((reply) => (
                            <button type="button" key={reply.id} onClick={() => { setDraft(reply.body); setComposerTool(null); }}>
                              <strong>/{reply.shortcut} — {reply.title}</strong>
                              <span>{reply.body}</span>
                            </button>
                          ))}
                      </div>
                      <div className="chatQuickReplyCreate">
                        <strong>Nova resposta rápida compartilhada</strong>
                        <div className="chatQuickReplyFields">
                          <input value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)}
                            placeholder="Título" maxLength={100} aria-label="Título da resposta" />
                          <input value={quickShortcut} onChange={(e) => setQuickShortcut(e.target.value)}
                            placeholder="Atalho, ex.: saudacao" maxLength={30} aria-label="Atalho da resposta" />
                        </div>
                        <textarea value={quickBody} onChange={(e) => setQuickBody(e.target.value)}
                          placeholder="Texto da resposta" rows={2} maxLength={4096}/>
                        <button type="button" className="chatUtilityPrimary"
                          disabled={quickSaving || !quickTitle.trim() || !quickShortcut.trim() || !quickBody.trim()}
                          onClick={() => void saveQuickReply()}>
                          {quickSaving ? "Salvando..." : "Criar resposta"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
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
              <div className="composerToolbar">
                <div className="composerToolbarGroup">
                  <button
                    type="button"
                    className="composerToolButton"
                    title="Notas privadas para a equipe"
                    onClick={() => setComposerTool((tool) => tool === "notes" ? null : "notes")}
                  >
                    ▤ <span>Anotação interna</span>
                  </button>
                  <button
                    type="button"
                    className="composerToolButton"
                    onClick={() => router.push("/templates")}
                    title="Abrir templates"
                  >
                    ▧ <span>Templates</span>
                  </button>
                </div>
                <div className="composerToolbarGroup composerToolbarEnd">
                  <button
                    type="button"
                    className="composerToolButton"
                    title="Enviar imagem ou PDF"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={
                      !connected ||
                      sending ||
                      uploading ||
                      windowText === "Janela encerrada"
                    }
                  >
                    ⌕ <span>{uploading ? "Enviando..." : "Anexos"}</span>
                  </button>
                  <button
                    type="button"
                    className="composerToolButton"
                    title="Respostas rápidas compartilhadas"
                    onClick={() => setComposerTool((tool) => tool === "quick" ? null : "quick")}
                  >
                    ⚡ <span>Atalhos</span>
                  </button>
                  <button
                    type="button"
                    className="composerToolButton"
                    disabled
                    title="Avaliações ainda não estão habilitadas."
                  >
                    ☆ <span>Enviar avaliação</span>
                  </button>
                  <button
                    type="button"
                    className="composerToolButton compactTool"
                    disabled
                    title="Mais ações em breve."
                  >
                    •••
                  </button>
                </div>
              </div>
              <div className="composerInputRow">
                <button
                  type="button"
                  className="emojiButton"
                  title="Inserir emoji"
                  onClick={() => setComposerTool((tool) => tool === "emoji" ? null : "emoji")}
                >
                  ☺
                </button>
                <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (draft.startsWith("/") && suggestedQuickReplies.length) {
                      setDraft(suggestedQuickReplies[0].body);
                      setComposerTool(null);
                    } else {
                      void sendMessage();
                    }
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
              </div>
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

      <aside className={`contactPanel ${contactPanelOpen ? "" : "contactPanelHidden"}`}>
        {contact ? (
          <>
            <div className="contactPanelHeader">
              <strong>Informações do Contato</strong>
              <button
                type="button"
                onClick={() => setContactPanelOpen(false)}
                aria-label="Fechar informações do contato"
              >
                ×
              </button>
            </div>
            <div className="contactHero">
              <div className="avatar xlarge">
                {initials(contact.name, contact.phone_e164)}
              </div>
              <h2>{contact.name || "Contato"}</h2>
              <p>{contact.phone_e164}</p>
              <div className="contactHeroActions">
                <a href={`tel:${contact.phone_e164}`}>☎ <span>Ligar</span></a>
                <a
                  href={`https://wa.me/${contact.phone_e164.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  ◉ <span>WhatsApp</span>
                </a>
                <button type="button" disabled title="Mais ações em breve">⋮</button>
              </div>
            </div>

            <div className="contactSearchBox">
              <span>⌕</span>
              <input placeholder="Buscar no Mais Chat..." />
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

            <div className="infoBlock crmInspectorBlock">
              <span className="sectionLabel">RESPONSÁVEL</span>
              <select
                className="inspectorSelect"
                value={selected?.assigned_member_id ?? ""}
                onChange={(event) =>
                  void updateConversationAssignee(event.target.value)
                }
              >
                <option value="">Não atribuído</option>
                {Object.entries(memberNames).map(([id, name]) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="infoBlock crmInspectorBlock">
              <span className="sectionLabel">HISTÓRICO DE TRANSFERÊNCIAS</span>
              <div className="teamAssignmentHistory">
                {assignmentEvents.length === 0 ? (
                  <small>Nenhuma transferência registrada ainda.</small>
                ) : assignmentEvents.slice(0, 8).map((item) => (
                  <div className="teamAssignmentEvent" key={item.id}>
                    <strong>{item.to_member_id ? memberNames[item.to_member_id] || "Atendente" : "Fila de novos"}</strong>
                    <small>{item.from_member_id ? `Antes: ${memberNames[item.from_member_id] || "Atendente"}` : "Atribuição inicial"} · {dateLabel(item.created_at)} {time(item.created_at)}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="infoBlock crmInspectorBlock">
              <span className="sectionLabel">ETAPA COMERCIAL</span>
              <select
                className="inspectorSelect"
                value={selected?.crm_stage_id ?? ""}
                onChange={(event) =>
                  void updateConversationStage(event.target.value)
                }
              >
                <option value="">Sem etapa</option>
                {crmStages.map((stage) => (
                  <option value={stage.id} key={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="infoBlock crmInspectorBlock">
              <span className="sectionLabel">CAMPANHA / GRUPO</span>
              <select
                className="inspectorSelect"
                value={selected?.campaign_id ?? ""}
                onChange={(event) =>
                  void updateConversationCampaign(event.target.value)
                }
              >
                <option value="">Sem campanha</option>
                {campaignOptions.map((campaign) => (
                  <option value={campaign.id} key={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="infoBlock crmInspectorBlock">
              <div className="inspectorLabelRow">
                <span className="sectionLabel">ETIQUETAS</span>
                <button
                  type="button"
                  className="inspectorManageButton"
                  onClick={() => router.push("/crm")}
                >
                  Gerenciar
                </button>
              </div>
              <div className="inspectorTags">
                {allTags.length === 0 ? (
                  <span className="emptyInspectorText">Nenhuma etiqueta criada.</span>
                ) : (
                  allTags.slice(0, 12).map((tag) => {
                    const active = (tagsByContact[contact.id] ?? []).some(
                      (item) => item.id === tag.id
                    );
                    return (
                      <button
                        type="button"
                        key={tag.id}
                        className={active ? "active" : ""}
                        style={{
                          borderColor: tag.color,
                          color: tag.color
                        }}
                        onClick={() => void toggleContactTag(tag)}
                      >
                        {active ? "✓ " : "+ "}
                        {tag.name}
                      </button>
                    );
                  })
                )}
              </div>
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

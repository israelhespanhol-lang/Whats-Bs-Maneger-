"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabase";

export type MaisChatMembership = {
  id: string;
  organization_id: string;
  role: "OWNER" | "ADMIN" | "AGENT";
  organizations:
    | { name: string; slug: string }
    | { name: string; slug: string }[]
    | null;
};

export type MaisChatAccount = {
  id: string;
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
  display_phone_number: string | null;
  verified_name: string | null;
};

export type MaisChatContextSnapshot = {
  membership: MaisChatMembership | null;
  account: MaisChatAccount | null;
  userName: string;
  userId: string | null;
  unread: number;
  error: string | null;
};

let cachedSnapshot: MaisChatContextSnapshot | null = null;

export function getMaisChatContextSnapshot() {
  return cachedSnapshot;
}

export function primeMaisChatContextSnapshot(
  patch: Partial<MaisChatContextSnapshot>
) {
  const base: MaisChatContextSnapshot = cachedSnapshot ?? {
    membership: null,
    account: null,
    userName: "Usuário",
    userId: null,
    unread: 0,
    error: null
  };

  cachedSnapshot = {
    ...base,
    ...patch
  };

  return cachedSnapshot;
}

export function useMaisChatContext() {
  const router = useRouter();
  const initial = getMaisChatContextSnapshot();
  const [loading, setLoading] = useState(!initial?.membership);
  const [membership, setMembership] = useState<MaisChatMembership | null>(
    initial?.membership ?? null
  );
  const [account, setAccount] = useState<MaisChatAccount | null>(
    initial?.account ?? null
  );
  const [userName, setUserName] = useState(initial?.userName ?? "Usuário");
  const [userId, setUserId] = useState<string | null>(initial?.userId ?? null);
  const [unread, setUnread] = useState(initial?.unread ?? 0);
  const [error, setError] = useState<string | null>(initial?.error ?? null);

  const refreshUnread = useCallback(async (organizationId: string) => {
    const { data } = await supabase
      .from("conversations")
      .select("unread_count")
      .eq("organization_id", organizationId);

    const nextUnread = (data ?? []).reduce(
      (sum, item) => sum + Number(item.unread_count ?? 0),
      0
    );

    setUnread(nextUnread);
    primeMaisChatContextSnapshot({ unread: nextUnread });
  }, []);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

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

      setUserId(session.user.id);
      setUserName(nextUserName);
      primeMaisChatContextSnapshot({
        userId: session.user.id,
        userName: nextUserName,
        error: null
      });

      const { data: member, error: memberError } = await supabase
        .from("organization_members")
        .select("id,organization_id,role,organizations(name,slug)")
        .eq("user_id", session.user.id)
        .limit(1)
        .maybeSingle();

      if (memberError || !member) {
        const nextError = memberError?.message ?? "Usuário sem organização.";
        setError(nextError);
        primeMaisChatContextSnapshot({ error: nextError });
        setLoading(false);
        return;
      }

      const typedMember = member as MaisChatMembership;
      setMembership(typedMember);
      primeMaisChatContextSnapshot({
        membership: typedMember,
        error: null
      });

      const { data: accountData } = await supabase
        .from("whatsapp_accounts")
        .select("id,status,display_phone_number,verified_name")
        .eq("organization_id", typedMember.organization_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!active) return;

      const nextAccount = (accountData ?? null) as MaisChatAccount | null;
      setAccount(nextAccount);
      primeMaisChatContextSnapshot({ account: nextAccount });
      await refreshUnread(typedMember.organization_id);

      channel = supabase
        .channel(`shell:${typedMember.organization_id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "conversations",
            filter: `organization_id=eq.${typedMember.organization_id}`
          },
          () => {
            void refreshUnread(typedMember.organization_id);
          }
        )
        .subscribe();

      setLoading(false);
    }

    void load();

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refreshUnread, router]);

  async function signOut() {
    cachedSnapshot = null;
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return {
    loading,
    membership,
    account,
    userName,
    userId,
    unread,
    error,
    signOut
  };
}

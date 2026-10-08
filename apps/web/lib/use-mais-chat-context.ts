"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabase";

export type MaisChatMembership = {
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

export function useMaisChatContext() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<MaisChatMembership | null>(null);
  const [account, setAccount] = useState<MaisChatAccount | null>(null);
  const [userName, setUserName] = useState("Usuário");
  const [userId, setUserId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refreshUnread = useCallback(async (organizationId: string) => {
    const { data } = await supabase
      .from("conversations")
      .select("unread_count")
      .eq("organization_id", organizationId);

    setUnread(
      (data ?? []).reduce(
        (sum, item) => sum + Number(item.unread_count ?? 0),
        0
      )
    );
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

      setUserId(session.user.id);
      setUserName(
        session.user.user_metadata?.name ||
          session.user.email?.split("@")[0] ||
          "Usuário"
      );

      const { data: member, error: memberError } = await supabase
        .from("organization_members")
        .select("organization_id,role,organizations(name,slug)")
        .eq("user_id", session.user.id)
        .limit(1)
        .maybeSingle();

      if (memberError || !member) {
        setError(memberError?.message ?? "Usuário sem organização.");
        setLoading(false);
        return;
      }

      const typedMember = member as MaisChatMembership;
      setMembership(typedMember);

      const { data: accountData } = await supabase
        .from("whatsapp_accounts")
        .select("id,status,display_phone_number,verified_name")
        .eq("organization_id", typedMember.organization_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!active) return;

      setAccount((accountData ?? null) as MaisChatAccount | null);
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

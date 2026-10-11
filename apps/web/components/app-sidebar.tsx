"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import BrandLogo from "./brand-logo";
import ThemeToggle from "./theme-toggle";

export type SidebarSection =
  | "conversations"
  | "contacts"
  | "crm"
  | "campaigns"
  | "broadcasts"
  | "templates"
  | "reports"
  | "team"
  | "settings";

type Props = {
  active: SidebarSection;
  unread: number;
  userName: string;
  role: string;
  memberId?: string;
  organizationId?: string;
  connected: boolean;
  displayPhoneNumber?: string | null;
  onSignOut: () => void;
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const groups: Array<{
  label: string;
  items: Array<{
    id: SidebarSection;
    label: string;
    href: string;
    icon: string;
  }>;
}> = [
  {
    label: "Atendimento",
    items: [
      { id: "conversations", label: "Conversas", href: "/", icon: "◉" },
      { id: "crm", label: "CRM Kanban", href: "/crm", icon: "▦" },
      { id: "contacts", label: "Contatos", href: "/contacts", icon: "◎" }
    ]
  },
  {
    label: "Operação",
    items: [
      { id: "campaigns", label: "Campanhas", href: "/campaigns", icon: "◇" },
      { id: "broadcasts", label: "Disparos", href: "/broadcasts", icon: "➤" },
      { id: "templates", label: "Templates", href: "/templates", icon: "▤" }
    ]
  },
  {
    label: "Gestão",
    items: [
      { id: "reports", label: "Relatórios", href: "/reports", icon: "⌁" },
      { id: "team", label: "Equipe e filas", href: "/team", icon: "♙" },
      { id: "settings", label: "Configurações", href: "/settings", icon: "⚙" }
    ]
  }
];

export default function AppSidebar({
  active,
  unread,
  userName,
  role,
  memberId,
  organizationId,
  connected,
  displayPhoneNumber,
  onSignOut
}: Props) {
  const [availability, setAvailability] = useState<"AVAILABLE"|"AWAY"|"OFFLINE">("OFFLINE");
  const [savingPresence, setSavingPresence] = useState(false);
  const [presenceError, setPresenceError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberId || !organizationId) return;
    let live = true;
    let currentStatus: "AVAILABLE"|"AWAY"|"OFFLINE" = "OFFLINE";
    void supabase.from("team_member_presence").select("status").eq("member_id",memberId)
      .maybeSingle().then(({ data }) => {
        if (!live) return;
        if (data?.status === "AVAILABLE" || data?.status === "AWAY") {
          currentStatus = data.status;
          setAvailability(data.status);
        }
      });
    const timer = window.setInterval(() => {
      if (!live || currentStatus === "OFFLINE") return;
      void supabase.from("team_member_presence").upsert({
        member_id:memberId,organization_id:organizationId,status:currentStatus
      },{onConflict:"member_id"}).then(() => undefined);
    }, 45_000);
    const handlePresence = (event: Event) => {
      const value=(event as CustomEvent<string>).detail;
      if(value==="AVAILABLE"||value==="AWAY"||value==="OFFLINE") currentStatus=value;
    };
    window.addEventListener("mais-chat-presence",handlePresence);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("mais-chat-presence",handlePresence);
    };
  }, [memberId,organizationId]);

  async function changePresence(value: "AVAILABLE"|"AWAY"|"OFFLINE") {
    if(!memberId||!organizationId||savingPresence)return;
    setSavingPresence(true);setPresenceError(null);
    const {error}=await supabase.from("team_member_presence").upsert({
      member_id:memberId,organization_id:organizationId,status:value
    },{onConflict:"member_id"});
    if(error)setPresenceError("Falha ao atualizar disponibilidade");
    else{
      setAvailability(value);
      window.dispatchEvent(new CustomEvent("mais-chat-presence",{detail:value}));
    }
    setSavingPresence(false);
  }
  return (
    <aside className="sidebar">
      <div className="brand brandWithLogo">
        <BrandLogo className="brandLogo" />
        <span className="productName">Mais Chat</span>
      </div>

      <nav className="sidebarNav">
        {groups.filter((group) => role !== "AGENT" || group.label !== "Operação").map((group) => (
          <div className="sidebarNavGroup" key={group.label}>
            <span className="sidebarNavLabel">{group.label}</span>
            {group.items.map((item) => (
              <Link
                key={item.id}
                className={`navItem ${active === item.id ? "active" : ""}`}
                href={item.href}
                prefetch
              >
                <i className="navIcon" aria-hidden="true">{item.icon}</i>
                <span className="navLabel">{item.label}</span>
                {item.id === "conversations" && unread > 0 && (
                  <span className="navBadge">{unread}</span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebarFooter">
        <ThemeToggle />
        {memberId && organizationId && (
          <div className="teamPresenceSwitcher">
            <label htmlFor="teamPresenceStatus">Sua disponibilidade</label>
            <select id="teamPresenceStatus" value={availability}
              disabled={savingPresence} onChange={(event) => void changePresence(event.target.value as "AVAILABLE"|"AWAY"|"OFFLINE")}>
              <option value="AVAILABLE">● Disponível para receber</option>
              <option value="AWAY">◐ Ausente</option>
              <option value="OFFLINE">○ Indisponível</option>
            </select>
            {presenceError && <small role="alert">{presenceError}</small>}
          </div>
        )}
        <div className="sidebarUser">
          <div className="miniAvatar">{initials(userName)}</div>
          <div>
            <strong>{userName}</strong>
            <span>{role}</span>
          </div>
          <button onClick={onSignOut} title="Sair">↗</button>
        </div>
        <div className={`connection ${connected ? "" : "disconnected"}`}>
          <i />
          {connected
            ? displayPhoneNumber || "WhatsApp conectado"
            : "WhatsApp não conectado"}
        </div>
      </div>
    </aside>
  );
}

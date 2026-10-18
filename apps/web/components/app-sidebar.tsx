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

function SidebarIcon({ name }: { name: SidebarSection }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: 1.8,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true as const };
  switch (name) {
    case "conversations": return <svg {...common}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3H13a8.48 8.48 0 0 1 8 8v.5Z"/></svg>;
    case "crm": return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16M5.5 8h1M11.5 12h1M17.5 8h1"/></svg>;
    case "contacts": return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.1a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/></svg>;
    case "campaigns": return <svg {...common}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>;
    case "broadcasts": return <svg {...common}><path d="m22 2-7 20-4-9-9-4Z M22 2 11 13"/></svg>;
    case "templates": return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg>;
    case "reports": return <svg {...common}><path d="M3 3v18h18M7 16v-4M12 16V7M17 16v-7"/></svg>;
    case "team": return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/></svg>;
    case "settings": return <svg {...common}><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2 2-.06-.06A1.65 1.65 0 0 0 15.9 18.5a1.65 1.65 0 0 0-1 .7L14 21h-4l-.9-1.8a1.65 1.65 0 0 0-2.83-.38L6.2 19l-2-2 .06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.7-1L2 13v-2l1.9-.9a1.65 1.65 0 0 0 .7-1 1.65 1.65 0 0 0-.33-1.82L4.2 7l2-2 .06.06A1.65 1.65 0 0 0 8.1 5.4a1.65 1.65 0 0 0 1-.7L10 3h4l.9 1.7a1.65 1.65 0 0 0 1 .7 1.65 1.65 0 0 0 1.82-.34L17.8 5l2 2-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 .7 1L22 11v2l-1.9.9a1.65 1.65 0 0 0-.7 1.1Z"/></svg>;
  }
}

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
      { id: "conversations", label: "Suporte", href: "/", icon: "◉" },
      { id: "crm", label: "CRM Kanban", href: "/crm", icon: "▦" },
      { id: "contacts", label: "Contatos", href: "/contacts", icon: "◎" }
    ]
  },
  {
    label: "Operação",
    items: [
      { id: "campaigns", label: "Campanhas", href: "/campaigns", icon: "◇" },
      { id: "broadcasts", label: "COEX · Disparos", href: "/broadcasts", icon: "➤" },
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
  const [collapsed, setCollapsed] = useState(false);

  // The root script applies the saved preference before first paint, so
  // navigation across modules does not expand the sidebar for a frame.
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebarCollapsed === "true");
  }, []);

  function setSidebarCollapsed(next: boolean) {
    setCollapsed(next);
    document.documentElement.dataset.sidebarCollapsed = String(next);
    try {
      window.localStorage.setItem("mais-chat-sidebar-collapsed", String(next));
    } catch {
      // Keep the current session functional when storage is blocked.
    }
  }

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
    <aside className={`sidebar ${collapsed ? "sidebarCollapsed" : ""}`}>
      <div className="sidebarTopBar">
        <div className="brand brandWithLogo">
          <BrandLogo className="brandLogo" />
          <span className="sidebarCompactBrand" aria-label="Mais Viagens">
            <BrandLogo className="sidebarCompactLogo" alt="Mais Viagens" />
          </span>
          {!collapsed && <span className="productName">Mais Chat</span>}
        </div>
        <button
          className="sidebarCollapseButton"
          type="button"
          onClick={() => setSidebarCollapsed(!collapsed)}
          aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? (
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M10 6 16 12l-6 6M4 4v16" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16M15 9l-3 3 3 3" />
            </svg>
          )}
        </button>
      </div>

      <nav className="sidebarNav">
        {groups.filter((group) => role !== "AGENT" || group.label !== "Operação").map((group) => (
          <div className="sidebarNavGroup" key={group.label}>
            {!collapsed && <span className="sidebarNavLabel">{group.label}</span>}
            {group.items.map((item) => (
              <Link
                key={item.id}
                className={`navItem ${active === item.id ? "active" : ""}`}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active === item.id ? "page" : undefined}
                prefetch
              >
                <span className="navIcon" aria-hidden="true"><SidebarIcon name={item.id} /></span>
                {!collapsed && <span className="navLabel">{item.label}</span>}
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
          <button
            type="button"
            className="sidebarPresenceShortcut"
            onClick={() => setSidebarCollapsed(false)}
            title="Expandir menu para alterar disponibilidade"
            aria-label="Expandir menu para alterar disponibilidade"
          >
            <span className={`sidebarPresenceDot sidebarPresenceDot--${availability.toLowerCase()}`} aria-hidden="true" />
          </button>
        )}
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

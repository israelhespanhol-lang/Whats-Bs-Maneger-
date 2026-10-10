"use client";

import Link from "next/link";
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
  | "settings";

type Props = {
  active: SidebarSection;
  unread: number;
  userName: string;
  role: string;
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
      { id: "settings", label: "Configurações", href: "/settings", icon: "⚙" }
    ]
  }
];

export default function AppSidebar({
  active,
  unread,
  userName,
  role,
  connected,
  displayPhoneNumber,
  onSignOut
}: Props) {
  return (
    <aside className="sidebar">
      <div className="brand brandWithLogo">
        <BrandLogo className="brandLogo" />
        <span className="productName">Mais Chat</span>
      </div>

      <nav className="sidebarNav">
        {groups.map((group) => (
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

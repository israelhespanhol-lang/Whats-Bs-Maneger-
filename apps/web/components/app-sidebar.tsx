"use client";

import BrandLogo from "./brand-logo";
import ThemeToggle from "./theme-toggle";

export type SidebarSection =
  | "conversations"
  | "contacts"
  | "campaigns"
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

const items: Array<{
  id: SidebarSection;
  label: string;
  href: string;
}> = [
  { id: "conversations", label: "Conversas", href: "/" },
  { id: "contacts", label: "Contatos", href: "/contacts" },
  { id: "campaigns", label: "Campanhas", href: "/campaigns" },
  { id: "templates", label: "Templates", href: "/templates" },
  { id: "reports", label: "Relatórios", href: "/reports" },
  { id: "settings", label: "Configurações", href: "/settings" }
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

      <nav>
        {items.map((item) => (
          <a
            key={item.id}
            className={`navItem ${active === item.id ? "active" : ""}`}
            href={item.href}
          >
            {item.label}
            {item.id === "conversations" && unread > 0 && <span>{unread}</span>}
          </a>
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

"use client";

import type { ReactNode } from "react";
import AppSidebar, { type SidebarSection } from "./app-sidebar";
import BrandLogo from "./brand-logo";
import type {
  MaisChatAccount,
  MaisChatMembership
} from "../lib/use-mais-chat-context";

type Props = {
  active: SidebarSection;
  loading: boolean;
  membership: MaisChatMembership | null;
  account: MaisChatAccount | null;
  userName: string;
  unread: number;
  error?: string | null;
  onSignOut: () => void;
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
};

export default function SectionLayout({
  active,
  loading,
  membership,
  account,
  userName,
  unread,
  error,
  onSignOut,
  eyebrow,
  title,
  description,
  actions,
  children
}: Props) {
  if (loading) {
    return (
      <main className="statePage">
        <div className="stateCard">
          <BrandLogo className="loadingBrandLogo" />
          <h1>Carregando o Mais Chat...</h1>
          <p>Preparando sua área de trabalho.</p>
        </div>
      </main>
    );
  }

  if (!membership) {
    return (
      <main className="statePage">
        <div className="stateCard">
          <p className="eyebrow">SEM ORGANIZAÇÃO</p>
          <h1>Não foi possível abrir esta área.</h1>
          <p>{error || "Seu usuário ainda não está associado a uma organização."}</p>
          <button className="detailsButton" onClick={onSignOut}>Sair</button>
        </div>
      </main>
    );
  }

  return (
    <main className="sectionAppShell">
      <AppSidebar
        active={active}
        unread={unread}
        userName={userName}
        role={membership.role}
        connected={account?.status === "CONNECTED"}
        displayPhoneNumber={account?.display_phone_number}
        onSignOut={onSignOut}
      />
      <section className="sectionWorkspace">
        <header className="sectionHeader">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p className="sectionDescription">{description}</p>
          </div>
          {actions && <div className="sectionActions">{actions}</div>}
        </header>
        <div className="sectionBody">{children}</div>
      </section>
    </main>
  );
}

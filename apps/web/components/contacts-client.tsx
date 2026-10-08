"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import SectionLayout from "./section-layout";
import { supabase } from "../lib/supabase";
import { useMaisChatContext } from "../lib/use-mais-chat-context";

type ContactStatus =
  | "LEAD"
  | "INTERESTED"
  | "NEGOTIATION"
  | "CUSTOMER"
  | "NOT_INTERESTED";

type Contact = {
  id: string;
  name: string | null;
  phone_e164: string;
  status: ContactStatus;
  source: string | null;
  last_seen_at: string | null;
  created_at: string;
};

const statusLabels: Record<ContactStatus, string> = {
  LEAD: "Lead",
  INTERESTED: "Interessado",
  NEGOTIATION: "Negociação",
  CUSTOMER: "Cliente",
  NOT_INTERESTED: "Sem interesse"
};

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55")) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

function formatDate(value: string | null) {
  if (!value) return "Sem interação";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default function ContactsClient() {
  const ctx = useMaisChatContext();
  const organizationId = ctx.membership?.organization_id ?? null;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ContactStatus>("ALL");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [newStatus, setNewStatus] = useState<ContactStatus>("LEAD");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadContacts() {
    if (!organizationId) return;

    const { data, error } = await supabase
      .from("contacts")
      .select("id,name,phone_e164,status,source,last_seen_at,created_at")
      .eq("organization_id", organizationId)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      setMessage(error.message);
      return;
    }

    setContacts((data ?? []) as Contact[]);
  }

  useEffect(() => {
    if (!organizationId) return;

    void loadContacts();

    const channel = supabase
      .channel(`contacts:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contacts",
          filter: `organization_id=eq.${organizationId}`
        },
        () => void loadContacts()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return contacts.filter((contact) => {
      if (statusFilter !== "ALL" && contact.status !== statusFilter) return false;
      if (!term) return true;
      return (
        contact.name?.toLowerCase().includes(term) ||
        contact.phone_e164.includes(term)
      );
    });
  }, [contacts, search, statusFilter]);

  const stats = useMemo(
    () => ({
      total: contacts.length,
      interested: contacts.filter((item) => item.status === "INTERESTED").length,
      negotiation: contacts.filter((item) => item.status === "NEGOTIATION").length,
      customers: contacts.filter((item) => item.status === "CUSTOMER").length
    }),
    [contacts]
  );

  async function createContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;

    const normalized = normalizePhone(phone);
    if (normalized.length < 11) {
      setMessage("Informe um número de WhatsApp válido.");
      return;
    }

    setSaving(true);
    setMessage(null);

    const { error } = await supabase.from("contacts").insert({
      organization_id: organizationId,
      name: name.trim() || null,
      phone_e164: normalized,
      status: newStatus,
      source: "manual"
    });

    setSaving(false);

    if (error) {
      setMessage(
        error.code === "23505"
          ? "Este número já está cadastrado."
          : error.message
      );
      return;
    }

    setName("");
    setPhone("");
    setNewStatus("LEAD");
    setShowForm(false);
    setMessage("Contato adicionado com sucesso.");
    await loadContacts();
  }

  async function updateStatus(id: string, status: ContactStatus) {
    setContacts((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item))
    );

    const { error } = await supabase
      .from("contacts")
      .update({ status })
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      await loadContacts();
    }
  }

  return (
    <SectionLayout
      active="contacts"
      loading={ctx.loading}
      membership={ctx.membership}
      account={ctx.account}
      userName={ctx.userName}
      unread={ctx.unread}
      error={ctx.error}
      onSignOut={() => void ctx.signOut()}
      eyebrow="CRM"
      title="Contatos"
      description="Centralize clientes, leads e oportunidades que conversam com a Mais Viagens."
      actions={
        <button className="primaryAction" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Fechar" : "+ Novo contato"}
        </button>
      }
    >
      {showForm && (
        <form className="inlineCreateCard" onSubmit={createContact}>
          <div>
            <label>Nome</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome do contato"
            />
          </div>
          <div>
            <label>WhatsApp</label>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(48) 99999-9999"
              required
            />
          </div>
          <div>
            <label>Status</label>
            <select
              value={newStatus}
              onChange={(event) => setNewStatus(event.target.value as ContactStatus)}
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </div>
          <button className="primaryAction" disabled={saving}>
            {saving ? "Salvando..." : "Adicionar"}
          </button>
        </form>
      )}

      <div className="metricGrid">
        <article className="metricCard">
          <span>Total</span>
          <strong>{stats.total}</strong>
          <small>contatos cadastrados</small>
        </article>
        <article className="metricCard">
          <span>Interessados</span>
          <strong>{stats.interested}</strong>
          <small>pediram mais informações</small>
        </article>
        <article className="metricCard">
          <span>Em negociação</span>
          <strong>{stats.negotiation}</strong>
          <small>oportunidades abertas</small>
        </article>
        <article className="metricCard">
          <span>Clientes</span>
          <strong>{stats.customers}</strong>
          <small>convertidos</small>
        </article>
      </div>

      <section className="dataCard">
        <div className="dataToolbar">
          <label className="sectionSearch">
            <span>⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou telefone..."
            />
          </label>
          <select
            className="sectionSelect"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "ALL" | ContactStatus)
            }
          >
            <option value="ALL">Todos os status</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="tableWrap">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Contato</th>
                <th>WhatsApp</th>
                <th>Status</th>
                <th>Origem</th>
                <th>Última interação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <strong>{contact.name || "Sem nome"}</strong>
                  </td>
                  <td>{contact.phone_e164}</td>
                  <td>
                    <select
                      className="statusSelect"
                      value={contact.status}
                      onChange={(event) =>
                        void updateStatus(
                          contact.id,
                          event.target.value as ContactStatus
                        )
                      }
                    >
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option value={value} key={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td>{contact.source || "—"}</td>
                  <td>{formatDate(contact.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="sectionEmpty">
            <strong>Nenhum contato encontrado.</strong>
            <p>Ajuste os filtros ou adicione um novo contato.</p>
          </div>
        )}
      </section>

      {message && <div className="sectionNotice">{message}</div>}
    </SectionLayout>
  );
}

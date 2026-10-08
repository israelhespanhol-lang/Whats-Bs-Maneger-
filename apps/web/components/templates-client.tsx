"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import SectionLayout from "./section-layout";
import { supabase } from "../lib/supabase";
import { useMaisChatContext } from "../lib/use-mais-chat-context";

type TemplateStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "ARCHIVED";
type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION" | "SERVICE";

type Template = {
  id: string;
  name: string;
  category: TemplateCategory;
  language: string;
  body: string;
  status: TemplateStatus;
  meta_template_name: string | null;
  created_at: string;
  updated_at: string;
};

const categoryLabels: Record<TemplateCategory, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
  SERVICE: "Atendimento"
};

const statusLabels: Record<TemplateStatus, string> = {
  DRAFT: "Rascunho",
  PENDING: "Em análise",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  ARCHIVED: "Arquivado"
};

export default function TemplatesClient() {
  const ctx = useMaisChatContext();
  const organizationId = ctx.membership?.organization_id ?? null;
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("MARKETING");
  const [statusFilter, setStatusFilter] = useState<"ALL" | TemplateStatus>("ALL");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadTemplates() {
    if (!organizationId) return;

    const { data, error } = await supabase
      .from("message_templates")
      .select("id,name,category,language,body,status,meta_template_name,created_at,updated_at")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }

    setTemplates((data ?? []) as Template[]);
  }

  useEffect(() => {
    if (!organizationId) return;
    void loadTemplates();

    const channel = supabase
      .channel(`templates:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_templates",
          filter: `organization_id=eq.${organizationId}`
        },
        () => void loadTemplates()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return templates.filter((template) => {
      if (statusFilter !== "ALL" && template.status !== statusFilter) return false;
      if (!term) return true;
      return (
        template.name.toLowerCase().includes(term) ||
        template.body.toLowerCase().includes(term)
      );
    });
  }, [templates, search, statusFilter]);

  const approved = templates.filter((item) => item.status === "APPROVED").length;
  const drafts = templates.filter((item) => item.status === "DRAFT").length;

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !ctx.userId) return;

    if (!name.trim() || !body.trim()) {
      setMessage("Nome e conteúdo são obrigatórios.");
      return;
    }

    setSaving(true);
    setMessage(null);

    const cleanName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const { error } = await supabase.from("message_templates").insert({
      organization_id: organizationId,
      name: cleanName,
      category,
      language: "pt_BR",
      body: body.trim(),
      status: "DRAFT",
      created_by: ctx.userId
    });

    setSaving(false);

    if (error) {
      setMessage(
        error.code === "23505"
          ? "Já existe um template com esse nome."
          : error.message
      );
      return;
    }

    setName("");
    setBody("");
    setCategory("MARKETING");
    setShowForm(false);
    setMessage("Template salvo como rascunho.");
    await loadTemplates();
  }

  async function archiveTemplate(id: string) {
    const { error } = await supabase
      .from("message_templates")
      .update({ status: "ARCHIVED" })
      .eq("id", id);

    if (error) setMessage(error.message);
  }

  async function duplicateTemplate(template: Template) {
    if (!organizationId || !ctx.userId) return;

    const suffix = Date.now().toString().slice(-5);
    const { error } = await supabase.from("message_templates").insert({
      organization_id: organizationId,
      name: `${template.name}_copia_${suffix}`,
      category: template.category,
      language: template.language,
      body: template.body,
      status: "DRAFT",
      created_by: ctx.userId
    });

    if (error) setMessage(error.message);
  }

  return (
    <SectionLayout
      active="templates"
      loading={ctx.loading}
      membership={ctx.membership}
      account={ctx.account}
      userName={ctx.userName}
      unread={ctx.unread}
      error={ctx.error}
      onSignOut={() => void ctx.signOut()}
      eyebrow="MENSAGENS"
      title="Templates"
      description="Organize mensagens reutilizáveis e mantenha a biblioteca pronta para aprovação e campanhas."
      actions={
        <button className="primaryAction" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Fechar" : "+ Novo template"}
        </button>
      }
    >
      {showForm && (
        <form className="templateCreateCard" onSubmit={createTemplate}>
          <div className="formRow">
            <div>
              <label>Nome interno</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ex: lembrete_viagem"
                required
              />
            </div>
            <div>
              <label>Categoria</label>
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as TemplateCategory)
                }
              >
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label>Mensagem</label>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={5}
              placeholder="Digite o conteúdo do template..."
              required
            />
            <small className="fieldHint">
              Use variáveis como {"{{1}}"} apenas quando o template também existir na Meta.
            </small>
          </div>
          <button className="primaryAction" disabled={saving}>
            {saving ? "Salvando..." : "Salvar rascunho"}
          </button>
        </form>
      )}

      <div className="metricGrid">
        <article className="metricCard">
          <span>Total</span><strong>{templates.length}</strong><small>na biblioteca</small>
        </article>
        <article className="metricCard">
          <span>Aprovados</span><strong>{approved}</strong><small>prontos para uso</small>
        </article>
        <article className="metricCard">
          <span>Rascunhos</span><strong>{drafts}</strong><small>em preparação</small>
        </article>
        <article className="metricCard">
          <span>Idioma</span><strong>PT-BR</strong><small>padrão atual</small>
        </article>
      </div>

      <section className="dataCard">
        <div className="dataToolbar">
          <label className="sectionSearch">
            <span>⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar templates..."
            />
          </label>
          <select
            className="sectionSelect"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "ALL" | TemplateStatus)
            }
          >
            <option value="ALL">Todos os status</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="templateGrid">
          {filtered.map((template) => (
            <article className="templateCard" key={template.id}>
              <div className="templateCardTop">
                <div>
                  <span className="templateCategory">{categoryLabels[template.category]}</span>
                  <h3>{template.name}</h3>
                </div>
                <span className={`statePill state-${template.status.toLowerCase()}`}>
                  {statusLabels[template.status]}
                </span>
              </div>
              <p>{template.body}</p>
              <div className="templateMeta">
                <span>{template.language}</span>
                {template.meta_template_name && <span>Meta: {template.meta_template_name}</span>}
              </div>
              <div className="cardActions">
                <button onClick={() => void duplicateTemplate(template)}>Duplicar</button>
                {template.status !== "ARCHIVED" && (
                  <button onClick={() => void archiveTemplate(template.id)}>Arquivar</button>
                )}
              </div>
            </article>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="sectionEmpty">
            <strong>Nenhum template encontrado.</strong>
            <p>Crie o primeiro rascunho para começar sua biblioteca.</p>
          </div>
        )}
      </section>

      <div className="sectionInfo">
        <strong>Importante</strong>
        <p>
          A biblioteca interna não publica templates automaticamente na Meta.
          A aprovação oficial continua sendo feita no WhatsApp Manager.
        </p>
      </div>

      {message && <div className="sectionNotice">{message}</div>}
    </SectionLayout>
  );
}

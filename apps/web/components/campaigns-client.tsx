"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import SectionLayout from "./section-layout";
import { supabase } from "../lib/supabase";
import { useMaisChatContext } from "../lib/use-mais-chat-context";

type CampaignStatus = "DRAFT" | "READY" | "PAUSED" | "COMPLETED" | "ARCHIVED";
type ContactStatus =
  | "LEAD"
  | "INTERESTED"
  | "NEGOTIATION"
  | "CUSTOMER"
  | "NOT_INTERESTED";

type Campaign = {
  id: string;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  template_id: string | null;
  audience_status: ContactStatus[];
  audience_count: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  scheduled_at: string | null;
  notes: string | null;
  created_at: string;
};

type Template = {
  id: string;
  name: string;
  status: string;
};

const campaignLabels: Record<CampaignStatus, string> = {
  DRAFT: "Rascunho",
  READY: "Pronta",
  PAUSED: "Pausada",
  COMPLETED: "Concluída",
  ARCHIVED: "Arquivada"
};

const audienceLabels: Record<ContactStatus, string> = {
  LEAD: "Leads",
  INTERESTED: "Interessados",
  NEGOTIATION: "Em negociação",
  CUSTOMER: "Clientes",
  NOT_INTERESTED: "Sem interesse"
};

function pct(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

export default function CampaignsClient() {
  const ctx = useMaisChatContext();
  const organizationId = ctx.membership?.organization_id ?? null;
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [audience, setAudience] = useState<ContactStatus[]>(["LEAD"]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadCampaigns() {
    if (!organizationId) return;

    const [{ data: campaignRows, error }, { data: templateRows }] = await Promise.all([
      supabase
        .from("campaigns")
        .select(
          "id,name,objective,status,template_id,audience_status,audience_count,sent_count,delivered_count,read_count,replied_count,scheduled_at,notes,created_at"
        )
        .eq("organization_id", organizationId)
        .neq("status", "ARCHIVED")
        .order("created_at", { ascending: false }),
      supabase
        .from("message_templates")
        .select("id,name,status")
        .eq("organization_id", organizationId)
        .order("name")
    ]);

    if (error) {
      setMessage(error.message);
      return;
    }

    setCampaigns((campaignRows ?? []) as Campaign[]);
    setTemplates((templateRows ?? []) as Template[]);
  }

  useEffect(() => {
    if (!organizationId) return;

    void loadCampaigns();

    const channel = supabase
      .channel(`campaigns:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campaigns",
          filter: `organization_id=eq.${organizationId}`
        },
        () => void loadCampaigns()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId]);

  const totals = useMemo(
    () => ({
      total: campaigns.length,
      ready: campaigns.filter((item) => item.status === "READY").length,
      paused: campaigns.filter((item) => item.status === "PAUSED").length,
      sent: campaigns.reduce((sum, item) => sum + item.sent_count, 0)
    }),
    [campaigns]
  );

  function toggleAudience(status: ContactStatus) {
    setAudience((current) => {
      if (current.includes(status)) {
        const next = current.filter((item) => item !== status);
        return next.length ? next : current;
      }
      return [...current, status];
    });
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !ctx.userId) return;

    setSaving(true);
    setMessage(null);

    const { count, error: countError } = await supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("status", audience);

    if (countError) {
      setMessage(countError.message);
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("campaigns").insert({
      organization_id: organizationId,
      name: name.trim(),
      objective: objective.trim() || null,
      status: "DRAFT",
      template_id: templateId || null,
      audience_status: audience,
      audience_count: count ?? 0,
      created_by: ctx.userId
    });

    setSaving(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setName("");
    setObjective("");
    setTemplateId("");
    setAudience(["LEAD"]);
    setShowForm(false);
    setMessage("Campanha criada como rascunho. Nenhuma mensagem foi enviada.");
    await loadCampaigns();
  }

  async function setCampaignStatus(id: string, status: CampaignStatus) {
    const { error } = await supabase
      .from("campaigns")
      .update({ status })
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(
      status === "READY"
        ? "Campanha marcada como pronta. Isso não dispara mensagens automaticamente."
        : "Status atualizado."
    );
  }

  return (
    <SectionLayout
      active="campaigns"
      loading={ctx.loading}
      membership={ctx.membership}
      account={ctx.account}
      userName={ctx.userName}
      unread={ctx.unread}
      error={ctx.error}
      onSignOut={() => void ctx.signOut()}
      eyebrow="OPERAÇÃO"
      title="Campanhas"
      description="Planeje públicos, templates e etapas sem perder controle sobre os disparos."
      actions={
        <button className="primaryAction" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Fechar" : "+ Nova campanha"}
        </button>
      }
    >
      <div className="safetyBanner">
        <strong>Disparo seguro</strong>
        <span>
          Criar, preparar ou pausar uma campanha aqui não envia mensagens.
          O envio continua exigindo uma ação manual e explícita.
        </span>
      </div>

      {showForm && (
        <form className="campaignCreateCard" onSubmit={createCampaign}>
          <div className="formRow">
            <div>
              <label>Nome da campanha</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Grupo Israel Novembro"
                required
              />
            </div>
            <div>
              <label>Template</label>
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                <option value="">Sem template definido</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {template.status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label>Objetivo</label>
            <input
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Ex.: reativar interessados e organizar retorno humano"
            />
          </div>

          <div>
            <label>Público por status</label>
            <div className="audiencePicker">
              {(Object.keys(audienceLabels) as ContactStatus[]).map((status) => (
                <button
                  type="button"
                  key={status}
                  className={audience.includes(status) ? "selected" : ""}
                  onClick={() => toggleAudience(status)}
                >
                  {audienceLabels[status]}
                </button>
              ))}
            </div>
          </div>

          <button className="primaryAction" disabled={saving}>
            {saving ? "Criando..." : "Criar rascunho"}
          </button>
        </form>
      )}

      <div className="metricGrid">
        <article className="metricCard">
          <span>Campanhas</span><strong>{totals.total}</strong><small>ativas no painel</small>
        </article>
        <article className="metricCard">
          <span>Prontas</span><strong>{totals.ready}</strong><small>aguardando ação manual</small>
        </article>
        <article className="metricCard">
          <span>Pausadas</span><strong>{totals.paused}</strong><small>sem operação</small>
        </article>
        <article className="metricCard">
          <span>Mensagens</span><strong>{totals.sent}</strong><small>registradas nas campanhas</small>
        </article>
      </div>

      <div className="campaignGrid">
        {campaigns.map((campaign) => {
          const template = templates.find((item) => item.id === campaign.template_id);

          return (
            <article className="campaignCard" key={campaign.id}>
              <div className="campaignCardTop">
                <div>
                  <span className={`statePill state-${campaign.status.toLowerCase()}`}>
                    {campaignLabels[campaign.status]}
                  </span>
                  <h3>{campaign.name}</h3>
                  <p>{campaign.objective || "Sem objetivo informado."}</p>
                </div>
                <strong className="campaignAudience">{campaign.audience_count}</strong>
              </div>

              <div className="campaignAudienceLabels">
                {campaign.audience_status.map((status) => (
                  <span key={status}>{audienceLabels[status]}</span>
                ))}
              </div>

              <div className="campaignStats">
                <div><span>Enviadas</span><strong>{campaign.sent_count}</strong></div>
                <div><span>Entregues</span><strong>{pct(campaign.delivered_count, campaign.sent_count)}</strong></div>
                <div><span>Lidas</span><strong>{pct(campaign.read_count, campaign.sent_count)}</strong></div>
                <div><span>Respostas</span><strong>{pct(campaign.replied_count, campaign.sent_count)}</strong></div>
              </div>

              <div className="campaignMeta">
                <span>Template: {template?.name || "não definido"}</span>
                <span>Público estimado: {campaign.audience_count}</span>
              </div>

              <div className="cardActions">
                {campaign.status === "DRAFT" && (
                  <button onClick={() => void setCampaignStatus(campaign.id, "READY")}>
                    Marcar como pronta
                  </button>
                )}
                {campaign.status === "READY" && (
                  <button onClick={() => void setCampaignStatus(campaign.id, "PAUSED")}>
                    Pausar
                  </button>
                )}
                {campaign.status === "PAUSED" && (
                  <button onClick={() => void setCampaignStatus(campaign.id, "READY")}>
                    Retomar preparação
                  </button>
                )}
                {campaign.status !== "COMPLETED" && (
                  <button onClick={() => void setCampaignStatus(campaign.id, "COMPLETED")}>
                    Concluir
                  </button>
                )}
                <button onClick={() => void setCampaignStatus(campaign.id, "ARCHIVED")}>
                  Arquivar
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {campaigns.length === 0 && (
        <div className="sectionEmpty standaloneEmpty">
          <strong>Nenhuma campanha criada.</strong>
          <p>Monte o primeiro rascunho para organizar público e template.</p>
        </div>
      )}

      {message && <div className="sectionNotice">{message}</div>}
    </SectionLayout>
  );
}

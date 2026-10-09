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

type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

type Template = {
  id: string;
  name: string;
  category: TemplateCategory;
  status: "APPROVED";
  body: string;
};

type PricingRate = {
  category: TemplateCategory;
  unit_cost_brl: number;
};

type BroadcastStatus =
  | "DRAFT"
  | "READY"
  | "SENDING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELED";

type Broadcast = {
  id: string;
  name: string;
  template_id: string;
  category: TemplateCategory;
  audience_status: ContactStatus[];
  audience_count: number;
  status: BroadcastStatus;
  unit_cost_brl: number;
  estimated_cost_brl: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  created_at: string;
  message_templates:
    | { name: string }
    | { name: string }[]
    | null;
};

type AudienceContact = {
  id: string;
  phone_e164: string;
};

const audienceLabels: Record<ContactStatus, string> = {
  LEAD: "Leads",
  INTERESTED: "Interessados",
  NEGOTIATION: "Em negociação",
  CUSTOMER: "Clientes",
  NOT_INTERESTED: "Sem interesse"
};

const categoryLabels: Record<TemplateCategory, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação"
};

const statusLabels: Record<BroadcastStatus, string> = {
  DRAFT: "Rascunho",
  READY: "Pronto",
  SENDING: "Enviando",
  PAUSED: "Pausado",
  COMPLETED: "Concluído",
  CANCELED: "Cancelado"
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(Number.isFinite(value) ? value : 0);
}

function percent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

export default function BroadcastsClient() {
  const ctx = useMaisChatContext();
  const organizationId = ctx.membership?.organization_id ?? null;

  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [rates, setRates] = useState<Record<TemplateCategory, number>>({
    MARKETING: 0,
    UTILITY: 0,
    AUTHENTICATION: 0
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [audience, setAudience] = useState<ContactStatus[]>(["LEAD"]);
  const [audienceCount, setAudienceCount] = useState(0);
  const [counting, setCounting] = useState(false);
  const [rateInput, setRateInput] = useState("0");
  const [optInConfirmed, setOptInConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadData() {
    if (!organizationId) return;

    const [broadcastResult, templateResult, rateResult] = await Promise.all([
      supabase
        .from("broadcasts")
        .select(
          "id,name,template_id,category,audience_status,audience_count,status,unit_cost_brl,estimated_cost_brl,sent_count,delivered_count,read_count,failed_count,created_at,message_templates(name)"
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("message_templates")
        .select("id,name,category,status,body")
        .eq("organization_id", organizationId)
        .eq("status", "APPROVED")
        .in("category", ["MARKETING", "UTILITY", "AUTHENTICATION"])
        .order("name"),
      supabase
        .from("whatsapp_pricing_rates")
        .select("category,unit_cost_brl")
        .eq("organization_id", organizationId)
    ]);

    const error =
      broadcastResult.error || templateResult.error || rateResult.error;

    if (error) {
      setMessage(error.message);
      return;
    }

    setBroadcasts((broadcastResult.data ?? []) as Broadcast[]);
    setTemplates((templateResult.data ?? []) as Template[]);

    const nextRates: Record<TemplateCategory, number> = {
      MARKETING: 0,
      UTILITY: 0,
      AUTHENTICATION: 0
    };

    for (const row of (rateResult.data ?? []) as PricingRate[]) {
      nextRates[row.category] = Number(row.unit_cost_brl ?? 0);
    }

    setRates(nextRates);
  }

  useEffect(() => {
    if (!organizationId) return;

    void loadData();

    const channel = supabase
      .channel(`broadcasts:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "broadcasts",
          filter: `organization_id=eq.${organizationId}`
        },
        () => void loadData()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId]);

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === templateId) ?? null,
    [templates, templateId]
  );

  const selectedRate = Number(rateInput.replace(",", ".")) || 0;
  const estimatedCost = audienceCount * selectedRate;

  useEffect(() => {
    if (!selectedTemplate) {
      setRateInput("0");
      return;
    }

    setRateInput(String(rates[selectedTemplate.category] ?? 0));
  }, [selectedTemplate?.id, rates]);

  async function refreshAudienceCount() {
    if (!organizationId || audience.length === 0) {
      setAudienceCount(0);
      return;
    }

    setCounting(true);

    const { count, error } = await supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("status", audience);

    setCounting(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setAudienceCount(count ?? 0);
  }

  useEffect(() => {
    void refreshAudienceCount();
  }, [organizationId, audience.join("|")]);

  function toggleAudience(status: ContactStatus) {
    setAudience((current) => {
      if (current.includes(status)) {
        const next = current.filter((item) => item !== status);
        return next.length ? next : current;
      }

      return [...current, status];
    });
  }

  async function fetchAudienceContacts() {
    if (!organizationId) return [] as AudienceContact[];

    const rows: AudienceContact[] = [];
    const pageSize = 1000;
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("contacts")
        .select("id,phone_e164")
        .eq("organization_id", organizationId)
        .in("status", audience)
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const page = (data ?? []) as AudienceContact[];
      rows.push(...page);

      if (page.length < pageSize) break;
      from += pageSize;

      if (rows.length >= 10000) break;
    }

    return rows;
  }

  async function createBroadcast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organizationId || !ctx.userId || !selectedTemplate) return;

    if (!name.trim()) {
      setMessage("Informe um nome para o disparo.");
      return;
    }

    if (!optInConfirmed) {
      setMessage(
        "Confirme que os destinatários autorizaram o recebimento de mensagens no WhatsApp."
      );
      return;
    }

    if (selectedRate < 0) {
      setMessage("A tarifa não pode ser negativa.");
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const contacts = await fetchAudienceContacts();

      if (contacts.length === 0) {
        setMessage("Nenhum contato encontrado para este público.");
        setSaving(false);
        return;
      }

      await supabase.from("whatsapp_pricing_rates").upsert(
        {
          organization_id: organizationId,
          category: selectedTemplate.category,
          unit_cost_brl: selectedRate,
          updated_by: ctx.userId
        },
        { onConflict: "organization_id,category" }
      );

      const { data: broadcast, error: broadcastError } = await supabase
        .from("broadcasts")
        .insert({
          organization_id: organizationId,
          name: name.trim(),
          template_id: selectedTemplate.id,
          category: selectedTemplate.category,
          audience_status: audience,
          audience_count: contacts.length,
          status: "READY",
          unit_cost_brl: selectedRate,
          estimated_cost_brl: contacts.length * selectedRate,
          opt_in_confirmed: true,
          created_by: ctx.userId
        })
        .select("id")
        .single();

      if (broadcastError || !broadcast) {
        throw broadcastError ?? new Error("Não foi possível criar o disparo.");
      }

      const recipients = contacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        phone_e164: contact.phone_e164,
        status: "PENDING",
        estimated_cost_brl: selectedRate
      }));

      for (let index = 0; index < recipients.length; index += 500) {
        const batch = recipients.slice(index, index + 500);
        const { error: recipientError } = await supabase
          .from("broadcast_recipients")
          .insert(batch);

        if (recipientError) throw recipientError;
      }

      setRates((current) => ({
        ...current,
        [selectedTemplate.category]: selectedRate
      }));
      setName("");
      setTemplateId("");
      setAudience(["LEAD"]);
      setOptInConfirmed(false);
      setShowForm(false);
      setMessage(
        `Disparo preparado com ${contacts.length} destinatário(s). Nenhuma mensagem foi enviada automaticamente.`
      );

      await loadData();
    } catch (createError) {
      setMessage(
        createError instanceof Error
          ? createError.message
          : "Não foi possível preparar o disparo."
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: BroadcastStatus) {
    const { error } = await supabase
      .from("broadcasts")
      .update({
        status,
        ...(status === "COMPLETED"
          ? { completed_at: new Date().toISOString() }
          : {})
      })
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Status do disparo atualizado.");
  }

  const totals = useMemo(() => {
    const active = broadcasts.filter(
      (item) => item.status !== "CANCELED"
    );

    return {
      broadcasts: active.length,
      recipients: active.reduce(
        (sum, item) => sum + item.audience_count,
        0
      ),
      plannedCost: active.reduce(
        (sum, item) => sum + Number(item.estimated_cost_brl ?? 0),
        0
      ),
      consumedCost: active.reduce(
        (sum, item) =>
          sum + item.sent_count * Number(item.unit_cost_brl ?? 0),
        0
      )
    };
  }, [broadcasts]);

  return (
    <SectionLayout
      active="broadcasts"
      loading={ctx.loading}
      membership={ctx.membership}
      account={ctx.account}
      userName={ctx.userName}
      unread={ctx.unread}
      error={ctx.error}
      onSignOut={() => void ctx.signOut()}
      eyebrow="WHATSAPP"
      title="Disparos"
      description="Prepare envios em massa com template aprovado, público definido e acompanhamento de custo estimado."
      actions={
        <button
          className="primaryAction"
          onClick={() => setShowForm((current) => !current)}
        >
          {showForm ? "Fechar" : "+ Novo disparo"}
        </button>
      }
    >
      <div className="broadcastSafetyBanner">
        <div>
          <strong>Controle manual de envio</strong>
          <span>
            Preparar um disparo não envia mensagens. A lista fica pronta para revisão e execução explícita.
          </span>
        </div>
        <span className="statePill state-ready">Sem envio automático</span>
      </div>

      {showForm && (
        <form className="broadcastCreateCard" onSubmit={createBroadcast}>
          <div className="broadcastFormGrid">
            <div className="builderField">
              <label>Nome do disparo</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Reativação Israel Outubro"
                required
              />
            </div>

            <div className="builderField">
              <label>Template aprovado</label>
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                required
              >
                <option value="">Selecione...</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {categoryLabels[template.category]}
                  </option>
                ))}
              </select>
              {templates.length === 0 && (
                <small>
                  Nenhum template aprovado. Envie um template para aprovação primeiro.
                </small>
              )}
            </div>
          </div>

          <div className="builderField">
            <label>Público</label>
            <div className="audiencePicker">
              {(Object.keys(audienceLabels) as ContactStatus[]).map(
                (status) => (
                  <button
                    type="button"
                    key={status}
                    className={audience.includes(status) ? "selected" : ""}
                    onClick={() => toggleAudience(status)}
                  >
                    {audienceLabels[status]}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="broadcastCostPanel">
            <div className="broadcastCostMetric">
              <span>Destinatários</span>
              <strong>{counting ? "…" : audienceCount}</strong>
              <small>contatos no público atual</small>
            </div>

            <div className="broadcastRateField">
              <label>
                Tarifa de referência
                {selectedTemplate && (
                  <span>{categoryLabels[selectedTemplate.category]}</span>
                )}
              </label>
              <div>
                <span>R$</span>
                <input
                  inputMode="decimal"
                  value={rateInput}
                  onChange={(event) => setRateInput(event.target.value)}
                  placeholder="0,0000"
                />
              </div>
              <small>valor estimado por mensagem</small>
            </div>

            <div className="broadcastCostMetric highlighted">
              <span>Custo estimado</span>
              <strong>{money(estimatedCost)}</strong>
              <small>{audienceCount} × {money(selectedRate)}</small>
            </div>
          </div>

          <label className="broadcastConsent">
            <input
              type="checkbox"
              checked={optInConfirmed}
              onChange={(event) => setOptInConfirmed(event.target.checked)}
            />
            <span>
              Confirmo que estes contatos autorizaram receber mensagens da Mais Viagens pelo WhatsApp.
            </span>
          </label>

          <div className="broadcastFormFooter">
            <div>
              <strong>Resumo</strong>
              <span>
                {audienceCount} destinatário(s) · {money(estimatedCost)} estimados
              </span>
            </div>
            <button
              className="primaryAction"
              disabled={
                saving ||
                !selectedTemplate ||
                !optInConfirmed ||
                audienceCount === 0
              }
            >
              {saving ? "Preparando..." : "Preparar disparo"}
            </button>
          </div>
        </form>
      )}

      <div className="metricGrid">
        <article className="metricCard">
          <span>Disparos</span>
          <strong>{totals.broadcasts}</strong>
          <small>não cancelados</small>
        </article>
        <article className="metricCard">
          <span>Destinatários</span>
          <strong>{totals.recipients}</strong>
          <small>somados nos disparos</small>
        </article>
        <article className="metricCard">
          <span>Custo planejado</span>
          <strong>{money(totals.plannedCost)}</strong>
          <small>estimativa total</small>
        </article>
        <article className="metricCard">
          <span>Custo consumido</span>
          <strong>{money(totals.consumedCost)}</strong>
          <small>estimado pelas mensagens enviadas</small>
        </article>
      </div>

      <section className="dataCard">
        <div className="broadcastListHeader">
          <div>
            <p className="eyebrow">HISTÓRICO</p>
            <h2>Disparos preparados</h2>
          </div>
          <span>{broadcasts.length} registro(s)</span>
        </div>

        <div className="broadcastList">
          {broadcasts.map((broadcast) => {
            const template = one(broadcast.message_templates);
            const unitCost = Number(broadcast.unit_cost_brl ?? 0);
            const consumed = broadcast.sent_count * unitCost;
            const remaining = Math.max(
              0,
              Number(broadcast.estimated_cost_brl ?? 0) - consumed
            );

            return (
              <article className="broadcastRow" key={broadcast.id}>
                <div className="broadcastRowTop">
                  <div>
                    <div className="broadcastTitleLine">
                      <h3>{broadcast.name}</h3>
                      <span
                        className={`statePill state-${broadcast.status.toLowerCase()}`}
                      >
                        {statusLabels[broadcast.status]}
                      </span>
                    </div>
                    <p>
                      Template: <strong>{template?.name || "—"}</strong> ·{" "}
                      {categoryLabels[broadcast.category]}
                    </p>
                  </div>

                  <div className="broadcastCostBadge">
                    <span>Estimado</span>
                    <strong>{money(Number(broadcast.estimated_cost_brl))}</strong>
                  </div>
                </div>

                <div className="broadcastProgressGrid">
                  <div>
                    <span>Público</span>
                    <strong>{broadcast.audience_count}</strong>
                  </div>
                  <div>
                    <span>Enviadas</span>
                    <strong>{broadcast.sent_count}</strong>
                  </div>
                  <div>
                    <span>Entregues</span>
                    <strong>
                      {percent(broadcast.delivered_count, broadcast.sent_count)}
                    </strong>
                  </div>
                  <div>
                    <span>Lidas</span>
                    <strong>
                      {percent(broadcast.read_count, broadcast.sent_count)}
                    </strong>
                  </div>
                  <div>
                    <span>Falhas</span>
                    <strong>{broadcast.failed_count}</strong>
                  </div>
                </div>

                <div className="broadcastCostBreakdown">
                  <div>
                    <span>Tarifa usada</span>
                    <strong>{money(unitCost)}</strong>
                  </div>
                  <div>
                    <span>Custo consumido</span>
                    <strong>{money(consumed)}</strong>
                  </div>
                  <div>
                    <span>Saldo previsto</span>
                    <strong>{money(remaining)}</strong>
                  </div>
                </div>

                <div className="broadcastRowFooter">
                  <div className="campaignAudienceLabels">
                    {broadcast.audience_status.map((status) => (
                      <span key={status}>{audienceLabels[status]}</span>
                    ))}
                  </div>

                  <div className="cardActions">
                    {broadcast.status === "READY" && (
                      <button
                        onClick={() =>
                          void updateStatus(broadcast.id, "PAUSED")
                        }
                      >
                        Pausar
                      </button>
                    )}
                    {broadcast.status === "PAUSED" && (
                      <button
                        onClick={() =>
                          void updateStatus(broadcast.id, "READY")
                        }
                      >
                        Retomar
                      </button>
                    )}
                    {!["COMPLETED", "CANCELED"].includes(
                      broadcast.status
                    ) && (
                      <button
                        onClick={() =>
                          void updateStatus(broadcast.id, "CANCELED")
                        }
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {broadcasts.length === 0 && (
          <div className="sectionEmpty">
            <strong>Nenhum disparo preparado.</strong>
            <p>
              Crie o primeiro para visualizar público, tarifa e custo antes do envio.
            </p>
          </div>
        )}
      </section>

      <div className="sectionInfo">
        <strong>Sobre os valores</strong>
        <p>
          O painel usa a tarifa de referência que você informar e mostra custos estimados. A fatura oficial continua sendo a da Meta/BSP.
        </p>
      </div>

      {message && <div className="sectionNotice">{message}</div>}
    </SectionLayout>
  );
}

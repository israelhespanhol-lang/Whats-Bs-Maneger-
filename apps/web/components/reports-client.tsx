"use client";

import { useEffect, useMemo, useState } from "react";
import SectionLayout from "./section-layout";
import { supabase } from "../lib/supabase";
import { useMaisChatContext } from "../lib/use-mais-chat-context";

type PerfEvent = {
  operation: "INBOX_LOAD" | "MESSAGE_LOAD" | "SEND_MESSAGE";
  duration_ms: number;
  cache_hit: boolean;
  created_at: string;
};

type Contact = { status: string; created_at: string };
type Conversation = { status: string; unread_count: number; created_at: string };
type Message = {
  direction: "INBOUND" | "OUTBOUND";
  status: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  created_at: string;
};

function percent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function ReportsClient() {
  const ctx = useMaisChatContext();
  const organizationId = ctx.membership?.organization_id ?? null;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [performanceEvents, setPerformanceEvents] = useState<PerfEvent[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;

    async function load() {
      setLoadingData(true);

      const [contactResult, conversationResult, messageResult] = await Promise.all([
        supabase
          .from("contacts")
          .select("status,created_at")
          .eq("organization_id", organizationId)
          .limit(5000),
        supabase
          .from("conversations")
          .select("status,unread_count,created_at")
          .eq("organization_id", organizationId)
          .limit(5000),
        supabase
          .from("messages")
          .select("direction,status,created_at")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(5000)
      ]);

      const error =
        contactResult.error || conversationResult.error || messageResult.error;

      if (error) {
        setMessage(error.message);
      } else {
        setContacts((contactResult.data ?? []) as Contact[]);
        setConversations((conversationResult.data ?? []) as Conversation[]);
        setMessages((messageResult.data ?? []) as Message[]);
      }

      setLoadingData(false);
    }

    void load();
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId || ctx.membership?.role === "AGENT") return;
    let alive = true;
    async function loadPerformance() {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data, error } = await supabase.from("client_performance_events")
        .select("operation,duration_ms,cache_hit,created_at")
        .eq("organization_id", organizationId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (alive && !error) setPerformanceEvents((data ?? []) as PerfEvent[]);
    }
    void loadPerformance();
    return () => { alive = false; };
  }, [organizationId, ctx.membership?.role]);

  const performanceSummary = useMemo(() => {
    const summarise = (type: PerfEvent["operation"]) => {
      const values = performanceEvents
        .filter((item) => item.operation === type)
        .map((item) => item.duration_ms)
        .sort((a,b) => a-b);
      if (!values.length) return { count: 0, median: null as number | null, p95: null as number | null };
      return {
        count: values.length,
        median: values[Math.floor((values.length-1)*0.5)],
        p95: values[Math.floor((values.length-1)*0.95)]
      };
    };
    return {
      inbox: summarise("INBOX_LOAD"),
      messages: summarise("MESSAGE_LOAD"),
      send: summarise("SEND_MESSAGE")
    };
  }, [performanceEvents]);

  const metrics = useMemo(() => {
    const outbound = messages.filter((item) => item.direction === "OUTBOUND");
    const inbound = messages.filter((item) => item.direction === "INBOUND");
    const delivered = outbound.filter((item) =>
      ["DELIVERED", "READ"].includes(item.status)
    ).length;
    const read = outbound.filter((item) => item.status === "READ").length;
    const failed = outbound.filter((item) => item.status === "FAILED").length;

    return {
      contacts: contacts.length,
      conversations: conversations.length,
      open: conversations.filter((item) => item.status === "OPEN").length,
      inbound: inbound.length,
      outbound: outbound.length,
      delivered,
      read,
      failed,
      deliveryRate: percent(delivered, outbound.length),
      readRate: percent(read, outbound.length),
      responseRatio: percent(inbound.length, outbound.length || inbound.length)
    };
  }, [contacts, conversations, messages]);

  const funnel = useMemo(() => {
    const keys = [
      ["LEAD", "Leads"],
      ["INTERESTED", "Interessados"],
      ["NEGOTIATION", "Negociação"],
      ["CUSTOMER", "Clientes"],
      ["NOT_INTERESTED", "Sem interesse"]
    ] as const;

    return keys.map(([key, label]) => ({
      key,
      label,
      count: contacts.filter((item) => item.status === key).length
    }));
  }, [contacts]);

  const activity = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      return {
        key: dayKey(date),
        label: new Intl.DateTimeFormat("pt-BR", { weekday: "short" })
          .format(date)
          .replace(".", ""),
        inbound: 0,
        outbound: 0
      };
    });

    const map = new Map(days.map((day) => [day.key, day]));

    for (const item of messages) {
      const key = dayKey(new Date(item.created_at));
      const day = map.get(key);
      if (!day) continue;
      if (item.direction === "INBOUND") day.inbound += 1;
      if (item.direction === "OUTBOUND") day.outbound += 1;
    }

    return days;
  }, [messages]);

  const activityMax = Math.max(
    1,
    ...activity.flatMap((item) => [item.inbound, item.outbound])
  );

  return (
    <SectionLayout
      active="reports"
      loading={ctx.loading}
      membership={ctx.membership}
      account={ctx.account}
      userName={ctx.userName}
      unread={ctx.unread}
      error={ctx.error}
      onSignOut={() => void ctx.signOut()}
      eyebrow="ANÁLISE"
      title="Relatórios"
      description="Acompanhe volume, entrega, leitura, conversas e evolução da base com dados reais."
    >
      {loadingData ? (
        <div className="sectionLoading">Calculando indicadores...</div>
      ) : (
        <>
          <div className="metricGrid">
            <article className="metricCard">
              <span>Conversas</span>
              <strong>{metrics.conversations}</strong>
              <small>{metrics.open} abertas agora</small>
            </article>
            <article className="metricCard">
              <span>Mensagens recebidas</span>
              <strong>{metrics.inbound}</strong>
              <small>entradas pelo WhatsApp</small>
            </article>
            <article className="metricCard">
              <span>Taxa de entrega</span>
              <strong>{metrics.deliveryRate}</strong>
              <small>{metrics.delivered} entregues</small>
            </article>
            <article className="metricCard">
              <span>Taxa de leitura</span>
              <strong>{metrics.readRate}</strong>
              <small>{metrics.read} mensagens lidas</small>
            </article>
          </div>

          {ctx.membership?.role !== "AGENT" && (
            <section className="dataCard reportCard">
              <div className="reportCardHeader">
                <div>
                  <p className="eyebrow">OBSERVABILIDADE · ÚLTIMAS 24 HORAS</p>
                  <h2>Velocidade real do Mais Chat</h2>
                  <p className="sectionDescription">Amostragem discreta de 25% das operações, sem coletar conteúdo ou telefone dos clientes.</p>
                </div>
              </div>
              <div className="metricGrid">
                {([
                  ["Abertura do inbox", performanceSummary.inbox],
                  ["Carregamento de mensagens", performanceSummary.messages],
                  ["Tempo de envio à API", performanceSummary.send]
                ] as const).map(([label, stats]) => (
                  <article className="metricCard" key={label}>
                    <span>{label}</span>
                    <strong>{stats.median === null ? "—" : `${stats.median} ms`}</strong>
                    <small>{stats.p95 === null
                      ? "Aguardando amostras"
                      : `Mediana · P95: ${stats.p95} ms · ${stats.count} amostra(s)`}</small>
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className="reportGrid">
            <section className="dataCard reportCard">
              <div className="reportCardHeader">
                <div>
                  <p className="eyebrow">ÚLTIMOS 7 DIAS</p>
                  <h2>Movimento de mensagens</h2>
                </div>
                <div className="reportLegend">
                  <span><i className="legendInbound" /> Recebidas</span>
                  <span><i className="legendOutbound" /> Enviadas</span>
                </div>
              </div>

              <div className="activityChart">
                {activity.map((day) => (
                  <div className="activityDay" key={day.key}>
                    <div className="activityBars">
                      <span
                        className="activityBar inboundBar"
                        style={{ height: `${Math.max(4, (day.inbound / activityMax) * 100)}%` }}
                        title={`${day.inbound} recebidas`}
                      />
                      <span
                        className="activityBar outboundBar"
                        style={{ height: `${Math.max(4, (day.outbound / activityMax) * 100)}%` }}
                        title={`${day.outbound} enviadas`}
                      />
                    </div>
                    <strong>{day.label}</strong>
                    <small>{day.inbound + day.outbound}</small>
                  </div>
                ))}
              </div>
            </section>

            <section className="dataCard reportCard">
              <div className="reportCardHeader">
                <div>
                  <p className="eyebrow">FUNIL</p>
                  <h2>Base de contatos</h2>
                </div>
                <strong>{metrics.contacts}</strong>
              </div>

              <div className="funnelList">
                {funnel.map((item) => (
                  <div className="funnelRow" key={item.key}>
                    <div>
                      <span>{item.label}</span>
                      <strong>{item.count}</strong>
                    </div>
                    <div className="funnelTrack">
                      <span
                        style={{
                          width: `${Math.max(
                            item.count ? 4 : 0,
                            (item.count / Math.max(1, metrics.contacts)) * 100
                          )}%`
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="metricGrid compactMetrics">
            <article className="metricCard">
              <span>Enviadas</span><strong>{metrics.outbound}</strong><small>saídas registradas</small>
            </article>
            <article className="metricCard">
              <span>Falhas</span><strong>{metrics.failed}</strong><small>envios com erro</small>
            </article>
            <article className="metricCard">
              <span>Relação de resposta</span><strong>{metrics.responseRatio}</strong><small>entradas versus saídas</small>
            </article>
            <article className="metricCard">
              <span>Não lidas</span><strong>{ctx.unread}</strong><small>pendentes na caixa</small>
            </article>
          </div>
        </>
      )}

      {message && <div className="sectionNotice">{message}</div>}
    </SectionLayout>
  );
}

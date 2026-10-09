"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
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
  header_text: string | null;
};

type PricingRate = {
  category: TemplateCategory;
  unit_cost_brl: number;
  market: string;
  currency: string;
  source: string;
  fetched_at: string | null;
  tier_list: Array<{
    min_volume: number;
    max_volume: number;
    quote: string;
  }>;
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
  actual_cost_brl: number | null;
  started_at: string | null;
  completed_at: string | null;
  whatsapp_account_id: string | null;
  campaign_id: string | null;
  source_type: string;
  excluded_count: number;
  campaigns: { name: string } | { name: string }[] | null;
  whatsapp_accounts:
    | { verified_name: string | null; display_phone_number: string | null }
    | { verified_name: string | null; display_phone_number: string | null }[]
    | null;
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
  name: string | null;
};

type Account = {
  id: string;
  verified_name: string | null;
  display_phone_number: string | null;
  status: string;
};

type CampaignOption = {
  id: string;
  name: string;
};

type BroadcastRecipientDetail = {
  id: string;
  contact_id: string | null;
  recipient_name: string | null;
  phone_e164: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  exclude_reason: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
};

type Tag = {
  id: string;
  name: string;
  color: string;
};

type SourceType = "CRM_STATUS" | "TAG" | "FILE";

type ImportedRow = {
  rowNumber: number;
  values: Record<string, string>;
};

type ReviewRecipient = {
  key: string;
  contactId: string | null;
  name: string | null;
  phone: string;
  rawPhone: string;
  rowNumber: number | null;
  rawData: Record<string, string>;
  eligible: boolean;
  reason: string | null;
};

type VariableMapping = {
  source: "CONTACT_NAME" | "CONTACT_PHONE" | "COLUMN" | "FIXED";
  value: string;
};

type RecipientMetaStats = {
  billable: number;
  metaReported: number;
  actualCost: number | null;
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

function variableNumbers(value: string | null | undefined) {
  if (!value) return [];
  return [...new Set(
    [...value.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]))
  )].sort((a, b) => a - b);
}

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }

  if (digits.length < 12 || digits.length > 15) return null;
  return `+${digits}`;
}

export default function BroadcastsClient() {
  const ctx = useMaisChatContext();
  const organizationId = ctx.membership?.organization_id ?? null;

  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [recipientMetaStats, setRecipientMetaStats] =
    useState<Record<string, RecipientMetaStats>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [rates, setRates] = useState<Record<TemplateCategory, number>>({
    MARKETING: 0,
    UTILITY: 0,
    AUTHENTICATION: 0
  });

  const [showForm, setShowForm] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("CRM_STATUS");
  const [templateId, setTemplateId] = useState("");
  const [audience, setAudience] = useState<ContactStatus[]>(["LEAD"]);
  const [selectedTagId, setSelectedTagId] = useState("");
  const [fileName, setFileName] = useState("");
  const [firstRowHeader, setFirstRowHeader] = useState(true);
  const [rawSheetRows, setRawSheetRows] = useState<unknown[][]>([]);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [importedRows, setImportedRows] = useState<ImportedRow[]>([]);
  const [phoneColumn, setPhoneColumn] = useState("");
  const [nameColumn, setNameColumn] = useState("");
  const [variableMappings, setVariableMappings] =
    useState<Record<string, VariableMapping>>({});
  const [reviewRecipients, setReviewRecipients] = useState<ReviewRecipient[]>([]);
  const [reviewReady, setReviewReady] = useState(false);
  const [audienceCount, setAudienceCount] = useState(0);
  const [counting, setCounting] = useState(false);
  const [pricingSyncing, setPricingSyncing] = useState(false);
  const [pricingFetchedAt, setPricingFetchedAt] = useState<string | null>(null);
  const [optInConfirmed, setOptInConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingBroadcastId, setSendingBroadcastId] = useState<string | null>(null);
  const [expandedBroadcastId, setExpandedBroadcastId] = useState<string | null>(null);
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [detailsByBroadcast, setDetailsByBroadcast] =
    useState<Record<string, BroadcastRecipientDetail[]>>({});
  const [responseRates, setResponseRates] =
    useState<Record<string, { responses: number; base: number; rate: number }>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function syncPricing(force = false) {
    setPricingSyncing(true);

    const { data, error } = await supabase.functions.invoke(
      "whatsapp-pricing-sync",
      {
        body: { force }
      }
    );

    setPricingSyncing(false);

    if (error || !data?.ok) {
      setMessage(
        data?.error ||
          error?.message ||
          "Não foi possível consultar a tarifa oficial da Meta."
      );
      return false;
    }

    const metaRates = (data.rates ?? []) as Array<{
      category: string;
      unit_cost_brl: number;
      fetched_at?: string | null;
    }>;

    setRates((current) => {
      const next = { ...current };

      for (const row of metaRates) {
        if (
          row.category === "MARKETING" ||
          row.category === "UTILITY" ||
          row.category === "AUTHENTICATION"
        ) {
          next[row.category] = Number(row.unit_cost_brl ?? 0);
        }
      }

      return next;
    });

    setPricingFetchedAt(data.fetchedAt ?? new Date().toISOString());
    return true;
  }

  async function loadData() {
    if (!organizationId) return;

    const [
      broadcastResult,
      templateResult,
      rateResult,
      accountResult,
      campaignResult,
      tagResult
    ] = await Promise.all([
      supabase
        .from("broadcasts")
        .select(
          "id,name,template_id,category,audience_status,audience_count,status,unit_cost_brl,estimated_cost_brl,actual_cost_brl,started_at,completed_at,whatsapp_account_id,campaign_id,source_type,excluded_count,sent_count,delivered_count,read_count,failed_count,created_at,message_templates(name),campaigns(name),whatsapp_accounts(verified_name,display_phone_number)"
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("message_templates")
        .select("id,name,category,status,body,header_text")
        .eq("organization_id", organizationId)
        .eq("status", "APPROVED")
        .in("category", ["MARKETING", "UTILITY", "AUTHENTICATION"])
        .order("name"),
      supabase
        .from("whatsapp_pricing_rates")
        .select("category,unit_cost_brl,market,currency,source,fetched_at,tier_list")
        .eq("organization_id", organizationId),
      supabase
        .from("whatsapp_accounts")
        .select("id,verified_name,display_phone_number,status")
        .eq("organization_id", organizationId)
        .order("created_at"),
      supabase
        .from("campaigns")
        .select("id,name")
        .eq("organization_id", organizationId)
        .neq("status", "ARCHIVED")
        .order("created_at", { ascending: false }),
      supabase
        .from("tags")
        .select("id,name,color")
        .eq("organization_id", organizationId)
        .order("name")
    ]);

    const error =
      broadcastResult.error ||
      templateResult.error ||
      rateResult.error ||
      accountResult.error ||
      campaignResult.error ||
      tagResult.error;

    if (error) {
      setMessage(error.message);
      return;
    }

    const broadcastRows = (broadcastResult.data ?? []) as Broadcast[];
    setBroadcasts(broadcastRows);
    setTemplates((templateResult.data ?? []) as Template[]);
    const accountRows = (accountResult.data ?? []) as Account[];
    setAccounts(accountRows);
    setCampaigns((campaignResult.data ?? []) as CampaignOption[]);
    setTags((tagResult.data ?? []) as Tag[]);
    setChannelId((current) =>
      current && accountRows.some((item) => item.id === current)
        ? current
        : accountRows.find((item) => item.status === "CONNECTED")?.id ??
          accountRows[0]?.id ??
          ""
    );

    if (broadcastRows.length) {
      const { data: recipientRows } = await supabase
        .from("broadcast_recipients")
        .select(
          "broadcast_id,meta_billable,meta_pricing_category,meta_pricing_model,actual_cost_brl"
        )
        .in(
          "broadcast_id",
          broadcastRows.map((item) => item.id)
        );

      const stats: Record<string, RecipientMetaStats> = {};
      for (const row of recipientRows ?? []) {
        const current = stats[row.broadcast_id] ?? {
          billable: 0,
          metaReported: 0,
          actualCost: null
        };

        if (row.meta_billable === true) current.billable += 1;
        if (
          row.meta_billable !== null ||
          row.meta_pricing_category ||
          row.meta_pricing_model
        ) {
          current.metaReported += 1;
        }

        if (row.actual_cost_brl !== null) {
          current.actualCost =
            (current.actualCost ?? 0) + Number(row.actual_cost_brl);
        }

        stats[row.broadcast_id] = current;
      }

      setRecipientMetaStats(stats);
    } else {
      setRecipientMetaStats({});
    }

    const nextRates: Record<TemplateCategory, number> = {
      MARKETING: 0,
      UTILITY: 0,
      AUTHENTICATION: 0
    };

    let newestFetchedAt: string | null = null;

    for (const row of (rateResult.data ?? []) as PricingRate[]) {
      nextRates[row.category] = Number(row.unit_cost_brl ?? 0);

      if (
        row.fetched_at &&
        (!newestFetchedAt ||
          new Date(row.fetched_at).getTime() >
            new Date(newestFetchedAt).getTime())
      ) {
        newestFetchedAt = row.fetched_at;
      }
    }

    setRates(nextRates);
    setPricingFetchedAt(newestFetchedAt);
  }

  useEffect(() => {
    if (!organizationId) return;

    void (async () => {
      await syncPricing(false);
      await loadData();
    })();

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

  const headerVariables = useMemo(
    () => variableNumbers(selectedTemplate?.header_text),
    [selectedTemplate?.header_text]
  );

  const bodyVariables = useMemo(
    () => variableNumbers(selectedTemplate?.body),
    [selectedTemplate?.body]
  );

  const selectedRate = selectedTemplate
    ? Number(rates[selectedTemplate.category] ?? 0)
    : 0;

  const estimatedCost = audienceCount * selectedRate;

  function resetWizard() {
    setWizardStep(1);
    setName("");
    setSourceType("CRM_STATUS");
    setCampaignId("");
    setTemplateId("");
    setAudience(["LEAD"]);
    setSelectedTagId("");
    setFileName("");
    setFirstRowHeader(true);
    setRawSheetRows([]);
    setFileHeaders([]);
    setImportedRows([]);
    setPhoneColumn("");
    setNameColumn("");
    setVariableMappings({});
    setReviewRecipients([]);
    setReviewReady(false);
    setAudienceCount(0);
    setOptInConfirmed(false);
    setMessage(null);
  }

  function closeWizard() {
    setShowForm(false);
    resetWizard();
  }

  function openWizard() {
    resetWizard();
    const connectedAccount =
      accounts.find((item) => item.status === "CONNECTED") ?? accounts[0];
    if (connectedAccount) setChannelId(connectedAccount.id);
    setShowForm(true);
  }

  async function verifyQuality() {
    const channel = accounts.find((item) => item.id === channelId);

    if (!name.trim()) {
      setMessage("Defina um nome para identificar este disparo.");
      return;
    }

    if (!channel) {
      setMessage("Selecione um canal de atendimento.");
      return;
    }

    if (channel.status !== "CONNECTED") {
      setMessage("O canal selecionado não está conectado.");
      return;
    }

    if (templates.length === 0) {
      setMessage(
        "O canal está conectado, mas não há templates aprovados disponíveis para o disparo."
      );
      return;
    }

    setMessage(
      `Verificação concluída: canal conectado e ${templates.length} template(s) aprovado(s) disponível(is). Nenhuma mensagem foi enviada.`
    );
  }

  function rebuildImportedRows(rows: unknown[][], hasHeader: boolean) {
    if (!rows.length) {
      setFileHeaders([]);
      setImportedRows([]);
      setPhoneColumn("");
      setNameColumn("");
      return;
    }

    const maxColumns = Math.max(
      1,
      ...rows.map((row) => (Array.isArray(row) ? row.length : 0))
    );

    const headerRow = hasHeader ? rows[0] ?? [] : [];
    const used = new Set<string>();

    const headers = Array.from({ length: maxColumns }, (_, index) => {
      let base = hasHeader
        ? String(headerRow[index] ?? "").trim()
        : `Coluna ${index + 1}`;

      if (!base) base = `Coluna ${index + 1}`;

      let label = base;
      let suffix = 2;
      while (used.has(label)) {
        label = `${base} ${suffix}`;
        suffix += 1;
      }
      used.add(label);
      return label;
    });

    const dataRows = (hasHeader ? rows.slice(1) : rows)
      .filter((row) =>
        Array.isArray(row) && row.some((value) => String(value ?? "").trim())
      )
      .map((row, index) => {
        const values: Record<string, string> = {};
        headers.forEach((header, columnIndex) => {
          values[header] = String(row[columnIndex] ?? "").trim();
        });

        return {
          rowNumber: index + (hasHeader ? 2 : 1),
          values
        };
      });

    setFileHeaders(headers);
    setImportedRows(dataRows);

    setPhoneColumn((current) => {
      if (current && headers.includes(current)) return current;
      return (
        headers.find((header) =>
          /(whats|telefone|phone|celular|fone)/i.test(header)
        ) ??
        headers[0] ??
        ""
      );
    });

    setNameColumn((current) => {
      if (current && headers.includes(current)) return current;
      return headers.find((header) => /(nome|name)/i.test(header)) ?? "";
    });
  }

  useEffect(() => {
    rebuildImportedRows(rawSheetRows, firstRowHeader);
  }, [firstRowHeader, rawSheetRows]);

  async function handleRecipientFile(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (!extension || !["csv", "xlsx", "xls"].includes(extension)) {
      setMessage("Use uma planilha .csv, .xlsx ou .xls.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setMessage("A planilha deve ter no máximo 8 MB.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.SheetNames[0];

      if (!firstSheet) {
        setMessage("A planilha não contém nenhuma aba.");
        return;
      }

      const rows = XLSX.utils.sheet_to_json<unknown[]>(
        workbook.Sheets[firstSheet],
        {
          header: 1,
          defval: "",
          raw: false
        }
      );

      setFileName(file.name);
      setRawSheetRows(rows);
      setReviewReady(false);
      setMessage(
        `Planilha carregada: ${Math.max(
          0,
          rows.length - (firstRowHeader ? 1 : 0)
        )} linha(s) de dados.`
      );
    } catch {
      setMessage("Não foi possível ler esta planilha.");
    }
  }

  async function refreshAudienceCount() {
    if (!organizationId) {
      setAudienceCount(0);
      return;
    }

    if (sourceType === "FILE") {
      setAudienceCount(importedRows.length);
      return;
    }

    setCounting(true);

    if (sourceType === "TAG") {
      if (!selectedTagId) {
        setAudienceCount(0);
        setCounting(false);
        return;
      }

      const { count, error } = await supabase
        .from("contact_tags")
        .select("contact_id", { count: "exact", head: true })
        .eq("tag_id", selectedTagId);

      setCounting(false);

      if (error) {
        setMessage(error.message);
        return;
      }

      setAudienceCount(count ?? 0);
      return;
    }

    if (audience.length === 0) {
      setAudienceCount(0);
      setCounting(false);
      return;
    }

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
  }, [
    organizationId,
    sourceType,
    selectedTagId,
    importedRows.length,
    audience.join("|")
  ]);

  useEffect(() => {
    setReviewReady(false);
  }, [
    sourceType,
    selectedTagId,
    phoneColumn,
    nameColumn,
    importedRows.length,
    templateId,
    audience.join("|"),
    JSON.stringify(variableMappings)
  ]);

  useEffect(() => {
    if (!selectedTemplate) {
      setVariableMappings({});
      return;
    }

    const next: Record<string, VariableMapping> = {};

    for (const number of headerVariables) {
      next[`header:${number}`] = {
        source: number === 1 ? "CONTACT_NAME" : "FIXED",
        value: ""
      };
    }

    for (const number of bodyVariables) {
      next[`body:${number}`] = {
        source: number === 1 ? "CONTACT_NAME" : "FIXED",
        value: ""
      };
    }

    setVariableMappings(next);
  }, [templateId]);

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

    if (sourceType === "TAG") {
      if (!selectedTagId) return [];

      const { data: tagRows, error: tagError } = await supabase
        .from("contact_tags")
        .select("contact_id")
        .eq("tag_id", selectedTagId);

      if (tagError) throw tagError;

      const ids = [...new Set((tagRows ?? []).map((row) => row.contact_id))];
      if (!ids.length) return [];

      const rows: AudienceContact[] = [];

      for (let index = 0; index < ids.length; index += 500) {
        const batch = ids.slice(index, index + 500);
        const { data, error } = await supabase
          .from("contacts")
          .select("id,phone_e164,name")
          .eq("organization_id", organizationId)
          .in("id", batch);

        if (error) throw error;
        rows.push(...((data ?? []) as AudienceContact[]));
      }

      return rows;
    }

    const rows: AudienceContact[] = [];
    const pageSize = 1000;
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("contacts")
        .select("id,phone_e164,name")
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

  function resolveMapping(
    mapping: VariableMapping | undefined,
    recipient: ReviewRecipient
  ) {
    if (!mapping) return "";

    if (mapping.source === "CONTACT_NAME") {
      return recipient.name?.trim() ?? "";
    }

    if (mapping.source === "CONTACT_PHONE") {
      return recipient.phone;
    }

    if (mapping.source === "COLUMN") {
      return String(recipient.rawData[mapping.value] ?? "").trim();
    }

    return mapping.value.trim();
  }

  function variablesForRecipient(recipient: ReviewRecipient) {
    return {
      header: headerVariables.map((number) =>
        resolveMapping(variableMappings[`header:${number}`], recipient)
      ),
      body: bodyVariables.map((number) =>
        resolveMapping(variableMappings[`body:${number}`], recipient)
      )
    };
  }

  async function buildReview() {
    if (!selectedTemplate) {
      setMessage("Selecione um template aprovado.");
      return false;
    }

    const candidates: ReviewRecipient[] = [];

    if (sourceType === "FILE") {
      if (!phoneColumn) {
        setMessage("Selecione a coluna que contém os telefones.");
        return false;
      }

      const seen = new Set<string>();

      for (const row of importedRows) {
        const rawPhone = row.values[phoneColumn] ?? "";
        const phone = normalizePhone(rawPhone);
        const nameValue = nameColumn
          ? String(row.values[nameColumn] ?? "").trim()
          : "";

        let eligible = Boolean(phone);
        let reason: string | null = null;

        if (!phone) {
          eligible = false;
          reason = "Número inválido";
        } else if (seen.has(phone)) {
          eligible = false;
          reason = "Duplicado na planilha";
        } else {
          seen.add(phone);
        }

        candidates.push({
          key: `file-${row.rowNumber}`,
          contactId: null,
          name: nameValue || null,
          phone: phone ?? rawPhone.trim(),
          rawPhone,
          rowNumber: row.rowNumber,
          rawData: row.values,
          eligible,
          reason
        });
      }
    } else {
      const contacts = await fetchAudienceContacts();
      const seen = new Set<string>();

      for (const contact of contacts) {
        const phone = normalizePhone(contact.phone_e164);

        let eligible = Boolean(phone);
        let reason: string | null = null;

        if (!phone) {
          eligible = false;
          reason = "Número inválido";
        } else if (seen.has(phone)) {
          eligible = false;
          reason = "Duplicado";
        } else {
          seen.add(phone);
        }

        candidates.push({
          key: contact.id,
          contactId: contact.id,
          name: contact.name,
          phone: phone ?? contact.phone_e164,
          rawPhone: contact.phone_e164,
          rowNumber: null,
          rawData: {
            Nome: contact.name ?? "",
            Telefone: contact.phone_e164
          },
          eligible,
          reason
        });
      }
    }

    for (const candidate of candidates) {
      if (!candidate.eligible) continue;

      const variables = variablesForRecipient(candidate);
      const required = [...variables.header, ...variables.body];

      if (required.some((value) => !String(value ?? "").trim())) {
        candidate.eligible = false;
        candidate.reason = "Variável sem valor";
      }
    }

    setReviewRecipients(candidates);
    const eligibleCount = candidates.filter((item) => item.eligible).length;
    setAudienceCount(eligibleCount);
    setReviewReady(true);

    if (!eligibleCount) {
      setMessage("Nenhum destinatário elegível após as validações.");
      return false;
    }

    setMessage(null);
    return true;
  }

  async function createBroadcast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organizationId || !ctx.userId || !selectedTemplate) return;

    if (!reviewReady) {
      setMessage("Gere a revisão dos destinatários antes de preparar o disparo.");
      return;
    }

    if (!optInConfirmed) {
      setMessage(
        "Confirme que os destinatários autorizaram o recebimento de mensagens no WhatsApp."
      );
      return;
    }

    if (!channelId) {
      setMessage("Selecione o canal que será usado no disparo.");
      return;
    }

    if (selectedRate <= 0) {
      setMessage(
        "A tarifa oficial da Meta ainda não foi carregada. Atualize os preços antes de preparar o disparo."
      );
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const eligible = reviewRecipients.filter((item) => item.eligible);
      const excluded = reviewRecipients.filter((item) => !item.eligible);

      const contactByPhone = new Map<string, string>();

      for (const recipient of eligible) {
        if (recipient.contactId) {
          contactByPhone.set(recipient.phone, recipient.contactId);
        }
      }

      if (sourceType === "FILE") {
        const phones = [...new Set(eligible.map((item) => item.phone))];

        for (let index = 0; index < phones.length; index += 400) {
          const batch = phones.slice(index, index + 400);
          const { data: existing, error: existingError } = await supabase
            .from("contacts")
            .select("id,phone_e164")
            .eq("organization_id", organizationId)
            .in("phone_e164", batch);

          if (existingError) throw existingError;

          for (const contact of existing ?? []) {
            contactByPhone.set(contact.phone_e164, contact.id);
          }
        }

        const missing = eligible.filter(
          (item) => !contactByPhone.has(item.phone)
        );

        for (let index = 0; index < missing.length; index += 300) {
          const batch = missing.slice(index, index + 300);
          const { data: inserted, error: insertError } = await supabase
            .from("contacts")
            .insert(
              batch.map((item) => ({
                organization_id: organizationId,
                phone_e164: item.phone,
                name: item.name,
                status: "LEAD",
                source: "broadcast_import"
              }))
            )
            .select("id,phone_e164");

          if (insertError) throw insertError;

          for (const contact of inserted ?? []) {
            contactByPhone.set(contact.phone_e164, contact.id);
          }
        }
      }

      const sourceMeta =
        sourceType === "FILE"
          ? {
              file_name: fileName,
              first_row_header: firstRowHeader,
              phone_column: phoneColumn,
              name_column: nameColumn,
              headers: fileHeaders
            }
          : sourceType === "TAG"
            ? {
                tag_id: selectedTagId,
                tag_name:
                  tags.find((item) => item.id === selectedTagId)?.name ?? null
              }
            : {
                contact_statuses: audience
              };

      const { data: broadcast, error: broadcastError } = await supabase
        .from("broadcasts")
        .insert({
          organization_id: organizationId,
          whatsapp_account_id: channelId,
          campaign_id: campaignId || null,
          name: name.trim(),
          template_id: selectedTemplate.id,
          category: selectedTemplate.category,
          source_type: sourceType,
          source_meta: sourceMeta,
          audience_status: audience,
          audience_count: eligible.length,
          excluded_count: excluded.length,
          status: "READY",
          unit_cost_brl: selectedRate,
          estimated_cost_brl: eligible.length * selectedRate,
          opt_in_confirmed: true,
          created_by: ctx.userId
        })
        .select("id")
        .single();

      if (broadcastError || !broadcast) {
        throw broadcastError ?? new Error("Não foi possível criar o disparo.");
      }

      const recipients = [
        ...eligible.map((recipient) => ({
          broadcast_id: broadcast.id,
          contact_id:
            recipient.contactId ??
            contactByPhone.get(recipient.phone) ??
            null,
          recipient_name: recipient.name,
          phone_e164: recipient.phone,
          status: "PENDING",
          variables: variablesForRecipient(recipient),
          source_row: recipient.rowNumber,
          raw_data: recipient.rawData,
          estimated_cost_brl: selectedRate
        })),
        ...excluded.map((recipient) => ({
          broadcast_id: broadcast.id,
          contact_id: null,
          recipient_name: recipient.name,
          phone_e164:
            recipient.phone || recipient.rawPhone || `linha-${recipient.rowNumber ?? "sem-numero"}`,
          status: "SKIPPED",
          variables: {},
          source_row: recipient.rowNumber,
          raw_data: recipient.rawData,
          exclude_reason: recipient.reason,
          estimated_cost_brl: 0
        }))
      ];

      for (let index = 0; index < recipients.length; index += 400) {
        const batch = recipients.slice(index, index + 400);
        const { error: recipientError } = await supabase
          .from("broadcast_recipients")
          .insert(batch);

        if (recipientError) throw recipientError;
      }

      setShowForm(false);
      resetWizard();
      setMessage(
        `Disparo preparado: ${eligible.length} elegível(is) e ${excluded.length} excluído(s). Nenhuma mensagem foi enviada automaticamente.`
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

  async function loadBroadcastDetails(broadcast: Broadcast) {
    if (!organizationId) return;

    if (expandedBroadcastId === broadcast.id && detailsByBroadcast[broadcast.id]) {
      setExpandedBroadcastId(null);
      return;
    }

    setExpandedBroadcastId(broadcast.id);
    setDetailsLoadingId(broadcast.id);

    const { data: recipients, error: recipientsError } = await supabase
      .from("broadcast_recipients")
      .select(
        "id,contact_id,recipient_name,phone_e164,status,error_code,error_message,exclude_reason,sent_at,delivered_at,read_at"
      )
      .eq("broadcast_id", broadcast.id)
      .order("created_at")
      .limit(2000);

    if (recipientsError) {
      setDetailsLoadingId(null);
      setMessage(recipientsError.message);
      return;
    }

    const details = (recipients ?? []) as BroadcastRecipientDetail[];
    setDetailsByBroadcast((current) => ({
      ...current,
      [broadcast.id]: details
    }));

    const sentRecipients = details.filter(
      (recipient) => recipient.contact_id && recipient.sent_at
    );

    if (!sentRecipients.length) {
      setResponseRates((current) => ({
        ...current,
        [broadcast.id]: { responses: 0, base: 0, rate: 0 }
      }));
      setDetailsLoadingId(null);
      return;
    }

    const contactIds = [...new Set(
      sentRecipients
        .map((recipient) => recipient.contact_id)
        .filter(Boolean) as string[]
    )];

    const conversationMap = new Map<string, string>();
    const conversationIds: string[] = [];

    for (let index = 0; index < contactIds.length; index += 400) {
      const batch = contactIds.slice(index, index + 400);
      const { data: conversationRows } = await supabase
        .from("conversations")
        .select("id,contact_id")
        .eq("organization_id", organizationId)
        .in("contact_id", batch);

      for (const conversation of conversationRows ?? []) {
        conversationMap.set(conversation.id, conversation.contact_id);
        conversationIds.push(conversation.id);
      }
    }

    const firstSentAt = sentRecipients
      .map((recipient) => new Date(recipient.sent_at as string).getTime())
      .reduce((minimum, value) => Math.min(minimum, value), Number.MAX_SAFE_INTEGER);

    const inboundByContact = new Map<string, number>();

    for (let index = 0; index < conversationIds.length; index += 400) {
      const batch = conversationIds.slice(index, index + 400);
      const { data: inboundRows } = await supabase
        .from("messages")
        .select("conversation_id,created_at")
        .eq("organization_id", organizationId)
        .eq("direction", "INBOUND")
        .gte("created_at", new Date(firstSentAt).toISOString())
        .in("conversation_id", batch)
        .order("created_at");

      for (const row of inboundRows ?? []) {
        const contactId = conversationMap.get(row.conversation_id);
        if (!contactId) continue;
        const timestamp = new Date(row.created_at).getTime();
        const current = inboundByContact.get(contactId);
        if (current === undefined || timestamp < current) {
          inboundByContact.set(contactId, timestamp);
        }
      }
    }

    let responses = 0;
    for (const recipient of sentRecipients) {
      const firstInbound = inboundByContact.get(recipient.contact_id as string);
      if (
        firstInbound !== undefined &&
        firstInbound >= new Date(recipient.sent_at as string).getTime()
      ) {
        responses += 1;
      }
    }

    const base = sentRecipients.length;
    setResponseRates((current) => ({
      ...current,
      [broadcast.id]: {
        responses,
        base,
        rate: base ? Math.round((responses / base) * 100) : 0
      }
    }));

    setDetailsLoadingId(null);
  }

  async function startBroadcast(broadcast: Broadcast) {
    if (sendingBroadcastId) return;

    const estimated = Number(broadcast.estimated_cost_brl ?? 0);
    const confirmed = window.confirm(
      `Enviar agora ${broadcast.audience_count} mensagem(ns) pelo template aprovado?\n\nCusto estimado: ${money(estimated)}\n\nO envio só começa após esta confirmação.`
    );

    if (!confirmed) return;

    setSendingBroadcastId(broadcast.id);
    setMessage(null);

    let totalAccepted = 0;
    let totalFailed = 0;

    try {
      for (let batch = 0; batch < 100; batch += 1) {
        const { data, error } = await supabase.functions.invoke(
          "whatsapp-broadcast-send",
          {
            body: {
              broadcastId: broadcast.id,
              confirm: true,
              batchSize: 25
            }
          }
        );

        if (error || !data?.ok) {
          throw new Error(
            data?.error ||
              error?.message ||
              "Não foi possível executar o disparo."
          );
        }

        totalAccepted += Number(data.accepted ?? 0);
        totalFailed += Number(data.failed ?? 0);

        await loadData();

        if (Number(data.remaining ?? 0) === 0) {
          break;
        }
      }

      setMessage(
        `Envio processado: ${totalAccepted} aceita(s) pela Meta e ${totalFailed} falha(s). Entrega e leitura serão atualizadas automaticamente pelo webhook.`
      );
    } catch (sendError) {
      setMessage(
        sendError instanceof Error
          ? sendError.message
          : "Não foi possível concluir o disparo."
      );
    } finally {
      setSendingBroadcastId(null);
      await loadData();
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
      deliveredEstimate: active.reduce(
        (sum, item) =>
          sum + item.delivered_count * Number(item.unit_cost_brl ?? 0),
        0
      ),
      actualKnownCost: active.reduce((sum, item) => {
        const value =
          item.actual_cost_brl ??
          recipientMetaStats[item.id]?.actualCost ??
          null;
        return value === null ? sum : sum + Number(value);
      }, 0),
      actualKnownCount: active.filter(
        (item) =>
          item.actual_cost_brl !== null ||
          recipientMetaStats[item.id]?.actualCost !== null
      ).length
    };
  }, [broadcasts, recipientMetaStats]);

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
        <div className="templateTopActions">
          <button
            className="secondaryAction"
            type="button"
            disabled={pricingSyncing}
            onClick={() =>
              void (async () => {
                const ok = await syncPricing(true);
                if (ok) {
                  await loadData();
                  setMessage("Tarifas oficiais atualizadas diretamente da Meta.");
                }
              })()
            }
          >
            {pricingSyncing ? "Atualizando..." : "↻ Atualizar preços Meta"}
          </button>
          <button
            className="primaryAction"
            onClick={showForm ? closeWizard : openWizard}
          >
            {showForm ? "Fechar assistente" : "+ Novo disparo"}
          </button>
        </div>
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
        <form className="broadcastWizard" onSubmit={createBroadcast}>
          <div className="broadcastWizardSteps">
            {[
              [1, "Identificação"],
              [2, "Destinatários"],
              [3, "Template"],
              [4, "Revisão"],
              [5, "Confirmação"]
            ].map(([step, label]) => (
              <button
                key={step}
                type="button"
                className={wizardStep === step ? "active" : wizardStep > Number(step) ? "done" : ""}
                onClick={() => {
                  const target = Number(step) as 1 | 2 | 3 | 4 | 5;
                  if (target < wizardStep) setWizardStep(target);
                }}
              >
                <span>{wizardStep > Number(step) ? "✓" : step}</span>
                <strong>{label}</strong>
              </button>
            ))}
          </div>

          {wizardStep === 1 && (
            <section className="broadcastWizardPanel">
              <div className="wizardPanelHeading">
                <div>
                  <p className="eyebrow">PASSO 1 DE 5</p>
                  <h2>Identifique o disparo e escolha o canal</h2>
                  <p>
                    O nome serve apenas para localizar este lote no histórico.
                    Nada será enviado nesta etapa.
                  </p>
                </div>
              </div>

              <div className="broadcastFormGrid">
                <div className="builderField">
                  <label>Nome do disparo</label>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex.: Retomada Israel Outubro"
                    required
                  />
                </div>

                <div className="builderField">
                  <label>Canal de envio</label>
                  <select
                    value={channelId}
                    onChange={(event) => setChannelId(event.target.value)}
                    required
                  >
                    <option value="">Selecione...</option>
                    {accounts.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.verified_name || "WhatsApp"} ·{" "}
                        {channel.display_phone_number || "sem telefone"} ·{" "}
                        {channel.status}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="builderField">
                  <label>Campanha / grupo (opcional)</label>
                  <select
                    value={campaignId}
                    onChange={(event) => setCampaignId(event.target.value)}
                  >
                    <option value="">Sem campanha vinculada</option>
                    {campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="wizardQualityCard">
                <div>
                  <strong>Verificação de qualidade</strong>
                  <span>
                    Confere conexão do canal e disponibilidade de templates
                    aprovados. Não envia mensagens.
                  </span>
                </div>
                <button
                  type="button"
                  className="secondaryAction"
                  onClick={() => void verifyQuality()}
                >
                  Verificar qualidade
                </button>
              </div>

              <div className="builderNavigation">
                <span />
                <button
                  type="button"
                  className="primaryAction"
                  onClick={() => {
                    const channel = accounts.find((item) => item.id === channelId);
                    if (!name.trim()) {
                      setMessage("Informe o nome do disparo.");
                      return;
                    }
                    if (!channel || channel.status !== "CONNECTED") {
                      setMessage("Selecione um canal conectado.");
                      return;
                    }
                    setMessage(null);
                    setWizardStep(2);
                  }}
                >
                  Próximo →
                </button>
              </div>
            </section>
          )}

          {wizardStep === 2 && (
            <section className="broadcastWizardPanel">
              <div className="wizardPanelHeading">
                <div>
                  <p className="eyebrow">PASSO 2 DE 5</p>
                  <h2>Escolha a origem dos destinatários</h2>
                  <p>
                    Use contatos do CRM, uma etiqueta existente ou importe
                    CSV/Excel. Telefones são normalizados e duplicados são
                    removidos na revisão.
                  </p>
                </div>
              </div>

              <div className="broadcastSourceGrid">
                <button
                  type="button"
                  className={sourceType === "CRM_STATUS" ? "selected" : ""}
                  onClick={() => {
                    setSourceType("CRM_STATUS");
                    setReviewReady(false);
                  }}
                >
                  <strong>CRM / status</strong>
                  <span>Selecionar contatos por estágio cadastrado.</span>
                </button>
                <button
                  type="button"
                  className={sourceType === "TAG" ? "selected" : ""}
                  onClick={() => {
                    setSourceType("TAG");
                    setReviewReady(false);
                  }}
                >
                  <strong>Etiqueta</strong>
                  <span>Usar contatos que possuem uma etiqueta específica.</span>
                </button>
                <button
                  type="button"
                  className={sourceType === "FILE" ? "selected" : ""}
                  onClick={() => {
                    setSourceType("FILE");
                    setReviewReady(false);
                  }}
                >
                  <strong>Planilha</strong>
                  <span>Importar .csv, .xlsx ou .xls.</span>
                </button>
              </div>

              {sourceType === "CRM_STATUS" && (
                <div className="wizardSourcePanel">
                  <label>Estados do CRM</label>
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
                  <small>
                    {counting ? "Contando..." : `${audienceCount} contato(s) encontrados.`}
                  </small>
                </div>
              )}

              {sourceType === "TAG" && (
                <div className="wizardSourcePanel">
                  <label>Etiqueta</label>
                  <select
                    value={selectedTagId}
                    onChange={(event) => setSelectedTagId(event.target.value)}
                  >
                    <option value="">Selecione...</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                  <small>
                    {selectedTagId
                      ? counting
                        ? "Contando..."
                        : `${audienceCount} contato(s) com esta etiqueta.`
                      : "Escolha uma etiqueta para contar os destinatários."}
                  </small>
                </div>
              )}

              {sourceType === "FILE" && (
                <div className="wizardSourcePanel fileImportPanel">
                  <label className="fileDrop">
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleRecipientFile(file);
                      }}
                    />
                    <strong>{fileName || "Selecionar CSV ou Excel"}</strong>
                    <span>.csv, .xlsx ou .xls · até 8 MB</span>
                  </label>

                  <label className="headerCheckbox">
                    <input
                      type="checkbox"
                      checked={firstRowHeader}
                      onChange={(event) =>
                        setFirstRowHeader(event.target.checked)
                      }
                    />
                    <span>A primeira linha é o cabeçalho</span>
                  </label>

                  {fileHeaders.length > 0 && (
                    <>
                      <div className="broadcastFormGrid">
                        <div className="builderField">
                          <label>Coluna de telefone / WhatsApp</label>
                          <select
                            value={phoneColumn}
                            onChange={(event) => setPhoneColumn(event.target.value)}
                          >
                            {fileHeaders.map((header) => (
                              <option key={header} value={header}>
                                {header}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="builderField">
                          <label>Coluna de nome (opcional)</label>
                          <select
                            value={nameColumn}
                            onChange={(event) => setNameColumn(event.target.value)}
                          >
                            <option value="">Sem coluna de nome</option>
                            {fileHeaders.map((header) => (
                              <option key={header} value={header}>
                                {header}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="importPreview">
                        <div>
                          <strong>Prévia da planilha</strong>
                          <span>{importedRows.length} linha(s)</span>
                        </div>
                        <div className="importPreviewTable">
                          <table>
                            <thead>
                              <tr>
                                <th>#</th>
                                {fileHeaders.slice(0, 5).map((header) => (
                                  <th key={header}>{header}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {importedRows.slice(0, 5).map((row) => (
                                <tr key={row.rowNumber}>
                                  <td>{row.rowNumber}</td>
                                  {fileHeaders.slice(0, 5).map((header) => (
                                    <td key={header}>{row.values[header]}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="builderNavigation">
                <button
                  type="button"
                  className="secondaryAction"
                  onClick={() => setWizardStep(1)}
                >
                  ← Voltar
                </button>
                <button
                  type="button"
                  className="primaryAction"
                  onClick={() => {
                    if (sourceType === "FILE" && (!fileName || !phoneColumn)) {
                      setMessage("Carregue a planilha e selecione a coluna de telefone.");
                      return;
                    }
                    if (sourceType === "TAG" && !selectedTagId) {
                      setMessage("Selecione uma etiqueta.");
                      return;
                    }
                    if (audienceCount <= 0) {
                      setMessage("A origem selecionada não possui destinatários.");
                      return;
                    }
                    setMessage(null);
                    setWizardStep(3);
                  }}
                >
                  Próximo →
                </button>
              </div>
            </section>
          )}

          {wizardStep === 3 && (
            <section className="broadcastWizardPanel">
              <div className="wizardPanelHeading">
                <div>
                  <p className="eyebrow">PASSO 3 DE 5</p>
                  <h2>Selecione o template e mapeie as variáveis</h2>
                  <p>
                    Somente templates aprovados pela Meta aparecem aqui.
                  </p>
                </div>
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
                    Nenhum template aprovado. Sincronize ou envie um template
                    para aprovação primeiro.
                  </small>
                )}
              </div>

              {selectedTemplate && (
                <div className="wizardTemplatePreview">
                  <span>{categoryLabels[selectedTemplate.category]}</span>
                  {selectedTemplate.header_text && (
                    <strong>{selectedTemplate.header_text}</strong>
                  )}
                  <p>{selectedTemplate.body}</p>
                </div>
              )}

              {(headerVariables.length > 0 || bodyVariables.length > 0) && (
                <div className="variableMappingCard">
                  <div>
                    <strong>Mapeamento das variáveis</strong>
                    <span>
                      Defina de onde vem o valor de cada variável por destinatário.
                    </span>
                  </div>

                  {[
                    ...headerVariables.map((number) => ({
                      key: `header:${number}`,
                      label: `Cabeçalho {{${number}}}`
                    })),
                    ...bodyVariables.map((number) => ({
                      key: `body:${number}`,
                      label: `Corpo {{${number}}}`
                    }))
                  ].map((variable) => {
                    const mapping =
                      variableMappings[variable.key] ?? {
                        source: "FIXED" as const,
                        value: ""
                      };

                    return (
                      <div className="variableMappingRow" key={variable.key}>
                        <strong>{variable.label}</strong>
                        <select
                          value={mapping.source}
                          onChange={(event) => {
                            const source = event.target.value as VariableMapping["source"];
                            setVariableMappings((current) => ({
                              ...current,
                              [variable.key]: {
                                source,
                                value:
                                  source === "COLUMN"
                                    ? fileHeaders[0] ?? ""
                                    : source === "FIXED"
                                      ? current[variable.key]?.value ?? ""
                                      : ""
                              }
                            }));
                          }}
                        >
                          <option value="CONTACT_NAME">Nome do contato</option>
                          <option value="CONTACT_PHONE">Telefone</option>
                          {sourceType === "FILE" && (
                            <option value="COLUMN">Coluna da planilha</option>
                          )}
                          <option value="FIXED">Valor fixo</option>
                        </select>

                        {mapping.source === "COLUMN" && (
                          <select
                            value={mapping.value}
                            onChange={(event) =>
                              setVariableMappings((current) => ({
                                ...current,
                                [variable.key]: {
                                  source: "COLUMN",
                                  value: event.target.value
                                }
                              }))
                            }
                          >
                            {fileHeaders.map((header) => (
                              <option key={header} value={header}>
                                {header}
                              </option>
                            ))}
                          </select>
                        )}

                        {mapping.source === "FIXED" && (
                          <input
                            value={mapping.value}
                            onChange={(event) =>
                              setVariableMappings((current) => ({
                                ...current,
                                [variable.key]: {
                                  source: "FIXED",
                                  value: event.target.value
                                }
                              }))
                            }
                            placeholder="Valor para todos os destinatários"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="builderNavigation">
                <button
                  type="button"
                  className="secondaryAction"
                  onClick={() => setWizardStep(2)}
                >
                  ← Voltar
                </button>
                <button
                  type="button"
                  className="primaryAction"
                  onClick={() =>
                    void (async () => {
                      if (!selectedTemplate) {
                        setMessage("Selecione um template aprovado.");
                        return;
                      }
                      const ok = await buildReview();
                      if (ok) setWizardStep(4);
                    })()
                  }
                >
                  Validar destinatários →
                </button>
              </div>
            </section>
          )}

          {wizardStep === 4 && (
            <section className="broadcastWizardPanel">
              <div className="wizardPanelHeading">
                <div>
                  <p className="eyebrow">PASSO 4 DE 5</p>
                  <h2>Revisão, validações e custo estimado</h2>
                  <p>
                    Confira os elegíveis e excluídos antes de preparar o lote.
                  </p>
                </div>
                <button
                  type="button"
                  className="secondaryAction"
                  onClick={() => void buildReview()}
                >
                  ↻ Revalidar
                </button>
              </div>

              <div className="broadcastReviewMetrics">
                <article>
                  <span>Elegíveis</span>
                  <strong>
                    {reviewRecipients.filter((item) => item.eligible).length}
                  </strong>
                </article>
                <article>
                  <span>Excluídos</span>
                  <strong>
                    {reviewRecipients.filter((item) => !item.eligible).length}
                  </strong>
                </article>
                <article>
                  <span>Tarifa oficial</span>
                  <strong>{money(selectedRate)}</strong>
                </article>
                <article className="highlighted">
                  <span>Estimativa máxima</span>
                  <strong>{money(estimatedCost)}</strong>
                </article>
              </div>

              <div className="recipientReviewTable">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Nome</th>
                      <th>Telefone</th>
                      <th>Linha</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRecipients.slice(0, 30).map((recipient) => (
                      <tr key={recipient.key}>
                        <td>
                          <span
                            className={
                              recipient.eligible
                                ? "recipientStatus eligible"
                                : "recipientStatus excluded"
                            }
                          >
                            {recipient.eligible ? "Elegível" : "Excluído"}
                          </span>
                        </td>
                        <td>{recipient.name || "—"}</td>
                        <td>{recipient.phone || recipient.rawPhone || "—"}</td>
                        <td>{recipient.rowNumber ?? "CRM"}</td>
                        <td>{recipient.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {reviewRecipients.length > 30 && (
                  <small>
                    Mostrando 30 de {reviewRecipients.length} registros.
                  </small>
                )}
              </div>

              <div className="wizardCostNotice">
                <strong>Estimativa ≠ cobrança efetiva</strong>
                <p>
                  O valor acima usa a tarifa oficial sincronizada da Meta. O
                  histórico mantém separado qualquer dado de faturamento
                  informado pelo webhook.
                </p>
              </div>

              <div className="builderNavigation">
                <button
                  type="button"
                  className="secondaryAction"
                  onClick={() => setWizardStep(3)}
                >
                  ← Voltar
                </button>
                <button
                  type="button"
                  className="primaryAction"
                  disabled={
                    !reviewReady ||
                    reviewRecipients.filter((item) => item.eligible).length === 0
                  }
                  onClick={() => setWizardStep(5)}
                >
                  Próximo →
                </button>
              </div>
            </section>
          )}

          {wizardStep === 5 && (
            <section className="broadcastWizardPanel">
              <div className="wizardPanelHeading">
                <div>
                  <p className="eyebrow">PASSO 5 DE 5</p>
                  <h2>Confirmação e preparação</h2>
                  <p>
                    Esta etapa salva o lote como pronto. O envio real continua
                    exigindo o botão “Iniciar envio” no histórico.
                  </p>
                </div>
              </div>

              <div className="finalReviewCard">
                <div>
                  <span>Disparo</span>
                  <strong>{name}</strong>
                </div>
                <div>
                  <span>Canal</span>
                  <strong>
                    {accounts.find((item) => item.id === channelId)?.verified_name ||
                      accounts.find((item) => item.id === channelId)?.display_phone_number ||
                      "—"}
                  </strong>
                </div>
                <div>
                  <span>Campanha / grupo</span>
                  <strong>
                    {campaigns.find((item) => item.id === campaignId)?.name || "Sem campanha"}
                  </strong>
                </div>
                <div>
                  <span>Template</span>
                  <strong>{selectedTemplate?.name || "—"}</strong>
                </div>
                <div>
                  <span>Elegíveis</span>
                  <strong>
                    {reviewRecipients.filter((item) => item.eligible).length}
                  </strong>
                </div>
                <div>
                  <span>Excluídos</span>
                  <strong>
                    {reviewRecipients.filter((item) => !item.eligible).length}
                  </strong>
                </div>
                <div>
                  <span>Custo estimado</span>
                  <strong>{money(estimatedCost)}</strong>
                </div>
              </div>

              <button
                type="button"
                className="scheduledUnavailable"
                disabled
                title="O backend ainda não possui um scheduler de disparos. O recurso só será habilitado quando houver execução agendada segura."
              >
                ◷ Agendamento — em breve
              </button>

              <label className="broadcastConsent">
                <input
                  type="checkbox"
                  checked={optInConfirmed}
                  onChange={(event) => setOptInConfirmed(event.target.checked)}
                />
                <span>
                  Confirmo que estes destinatários autorizaram receber mensagens
                  da Mais Viagens pelo WhatsApp.
                </span>
              </label>

              <div className="wizardNoSendNotice">
                <strong>Nenhum envio será feito agora.</strong>
                <span>
                  “Preparar disparo” apenas cria o lote e os destinatários. Para
                  enviar, será necessário voltar ao histórico, clicar em “Iniciar
                  envio” e confirmar novamente.
                </span>
              </div>

              <div className="builderNavigation">
                <button
                  type="button"
                  className="secondaryAction"
                  onClick={() => setWizardStep(4)}
                >
                  ← Voltar
                </button>
                <button
                  className="primaryAction"
                  disabled={
                    saving ||
                    !optInConfirmed ||
                    !reviewReady ||
                    audienceCount === 0
                  }
                >
                  {saving ? "Preparando..." : "Preparar disparo"}
                </button>
              </div>
            </section>
          )}
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
          <span>Estimativa entregue</span>
          <strong>{money(totals.deliveredEstimate)}</strong>
          <small>rate card oficial × entregas</small>
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
            const deliveredEstimate = broadcast.delivered_count * unitCost;
            const metaStats = recipientMetaStats[broadcast.id] ?? {
              billable: 0,
              metaReported: 0,
              actualCost: null
            };
            const actualCost =
              broadcast.actual_cost_brl ?? metaStats.actualCost;
            const remaining = Math.max(
              0,
              Number(broadcast.estimated_cost_brl ?? 0) - deliveredEstimate
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
                      {categoryLabels[broadcast.category]} · Canal:{" "}
                      <strong>
                        {one(broadcast.whatsapp_accounts)?.verified_name ||
                          one(broadcast.whatsapp_accounts)?.display_phone_number ||
                          "—"}
                      </strong>
                      {one(broadcast.campaigns)?.name
                        ? ` · Campanha: ${one(broadcast.campaigns)?.name}`
                        : ""}
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
                    <span>Tarifa oficial</span>
                    <strong>{money(unitCost)}</strong>
                  </div>
                  <div>
                    <span>Estimativa entregue</span>
                    <strong>{money(deliveredEstimate)}</strong>
                  </div>
                  <div>
                    <span>Meta faturável</span>
                    <strong>
                      {metaStats.metaReported > 0
                        ? `${metaStats.billable}/${metaStats.metaReported}`
                        : "Aguardando"}
                    </strong>
                  </div>
                  <div>
                    <span>Custo efetivo informado</span>
                    <strong>
                      {actualCost === null ? "Não disponível" : money(Number(actualCost))}
                    </strong>
                  </div>
                  <div>
                    <span>Saldo estimado</span>
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
                    <button
                      onClick={() => void loadBroadcastDetails(broadcast)}
                    >
                      {detailsLoadingId === broadcast.id
                        ? "Calculando..."
                        : expandedBroadcastId === broadcast.id
                          ? "Ocultar detalhes"
                          : "Detalhes / resposta"}
                    </button>
                    {["READY", "SENDING"].includes(broadcast.status) && (
                      <button
                        className="sendBroadcastButton"
                        disabled={Boolean(sendingBroadcastId)}
                        onClick={() => void startBroadcast(broadcast)}
                      >
                        {sendingBroadcastId === broadcast.id
                          ? "Enviando..."
                          : broadcast.status === "SENDING"
                            ? "Continuar envio"
                            : "Iniciar envio"}
                      </button>
                    )}
                    {broadcast.status === "READY" && (
                      <button
                        disabled={Boolean(sendingBroadcastId)}
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
                        disabled={Boolean(sendingBroadcastId)}
                        onClick={() =>
                          void updateStatus(broadcast.id, "CANCELED")
                        }
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>

                {expandedBroadcastId === broadcast.id && (
                  <div className="broadcastDetailsPanel">
                    <div className="broadcastDetailsSummary">
                      <div>
                        <span>Taxa de resposta</span>
                        <strong>
                          {responseRates[broadcast.id]
                            ? `${responseRates[broadcast.id].rate}%`
                            : detailsLoadingId === broadcast.id
                              ? "…"
                              : "0%"}
                        </strong>
                        <small>
                          Critério: contato enviou mensagem inbound depois do envio deste lote.
                        </small>
                      </div>
                      <div>
                        <span>Respostas</span>
                        <strong>
                          {responseRates[broadcast.id]
                            ? `${responseRates[broadcast.id].responses}/${responseRates[broadcast.id].base}`
                            : "—"}
                        </strong>
                      </div>
                      <div>
                        <span>Excluídos antes do envio</span>
                        <strong>{broadcast.excluded_count}</strong>
                      </div>
                    </div>

                    <div className="broadcastRecipientTable">
                      <table>
                        <thead>
                          <tr>
                            <th>Destinatário</th>
                            <th>Status</th>
                            <th>Enviado</th>
                            <th>Entregue</th>
                            <th>Lido</th>
                            <th>Erro / exclusão</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detailsByBroadcast[broadcast.id] ?? [])
                            .slice(0, 100)
                            .map((recipient) => (
                              <tr key={recipient.id}>
                                <td>
                                  <strong>
                                    {recipient.recipient_name || recipient.phone_e164}
                                  </strong>
                                  <span>{recipient.phone_e164}</span>
                                </td>
                                <td>{recipient.status}</td>
                                <td>{recipient.sent_at ? "✓" : "—"}</td>
                                <td>{recipient.delivered_at ? "✓" : "—"}</td>
                                <td>{recipient.read_at ? "✓" : "—"}</td>
                                <td>
                                  {recipient.exclude_reason ||
                                    recipient.error_message ||
                                    recipient.error_code ||
                                    "—"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {(detailsByBroadcast[broadcast.id]?.length ?? 0) > 100 && (
                        <small>
                          Mostrando os primeiros 100 de{" "}
                          {detailsByBroadcast[broadcast.id].length} destinatários.
                        </small>
                      )}
                    </div>
                  </div>
                )}
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
          A estimativa usa o rate card oficial sincronizado da Meta e as entregas confirmadas pelo webhook. Quando o webhook informa billable, categoria ou modelo de preço, esses dados ficam registrados separadamente. Um valor calculado localmente nunca é exibido como cobrança efetiva da Meta; quando a API não fornece o valor monetário por mensagem, o painel mostra claramente “Não disponível”.
        </p>
      </div>

      {message && <div className="sectionNotice">{message}</div>}
    </SectionLayout>
  );
}

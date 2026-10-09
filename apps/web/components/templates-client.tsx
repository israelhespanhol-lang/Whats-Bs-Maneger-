"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import SectionLayout from "./section-layout";
import { supabase } from "../lib/supabase";
import { useMaisChatContext } from "../lib/use-mais-chat-context";

type TemplateStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "ARCHIVED";

type TemplateCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION"
  | "SERVICE";

type HeaderType = "NONE" | "TEXT";
type ButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";

type TemplateButton = {
  type: ButtonType;
  text: string;
  url?: string;
  phone_number?: string;
};

type Template = {
  id: string;
  name: string;
  category: TemplateCategory;
  language: string;
  body: string;
  status: TemplateStatus;
  meta_template_name: string | null;
  meta_template_id: string | null;
  meta_status_reason: string | null;
  header_type: HeaderType;
  header_text: string | null;
  header_example: string | null;
  footer_text: string | null;
  buttons: TemplateButton[];
  body_examples: string[];
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

type BuilderStep = 1 | 2 | 3;

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

function normalizeTemplateName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

function variableNumbers(value: string) {
  const matches = [...value.matchAll(/\{\{(\d+)\}\}/g)].map((match) =>
    Number(match[1])
  );

  return [...new Set(matches)].sort((a, b) => a - b);
}

function variableSequenceIsValid(numbers: number[]) {
  return numbers.every((value, index) => value === index + 1);
}

function renderPreview(
  value: string,
  examples: string[],
  headerExample?: string | null
) {
  return value.replace(/\{\{(\d+)\}\}/g, (_, rawNumber: string) => {
    const number = Number(rawNumber);
    return (
      examples[number - 1] ||
      (number === 1 && headerExample ? headerExample : null) ||
      `{{${number}}}`
    );
  });
}

function emptyButton(type: ButtonType): TemplateButton {
  if (type === "URL") {
    return { type, text: "", url: "https://" };
  }

  if (type === "PHONE_NUMBER") {
    return { type, text: "", phone_number: "+55" };
  }

  return { type, text: "" };
}

export default function TemplatesClient() {
  const ctx = useMaisChatContext();
  const organizationId = ctx.membership?.organization_id ?? null;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState<BuilderStep>(1);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] =
    useState<TemplateCategory>("MARKETING");
  const [language, setLanguage] = useState("pt_BR");
  const [headerType, setHeaderType] = useState<HeaderType>("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerExample, setHeaderExample] = useState("");
  const [body, setBody] = useState("");
  const [bodyExamples, setBodyExamples] = useState<string[]>([]);
  const [footerText, setFooterText] = useState("");
  const [buttons, setButtons] = useState<TemplateButton[]>([]);

  const [statusFilter, setStatusFilter] =
    useState<"ALL" | TemplateStatus>("ALL");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadTemplates() {
    if (!organizationId) return;

    const { data, error } = await supabase
      .from("message_templates")
      .select(
        "id,name,category,language,body,status,meta_template_name,meta_template_id,meta_status_reason,header_type,header_text,header_example,footer_text,buttons,body_examples,submitted_at,created_at,updated_at"
      )
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

  const bodyVars = useMemo(() => variableNumbers(body), [body]);
  const headerVars = useMemo(
    () => variableNumbers(headerText),
    [headerText]
  );

  useEffect(() => {
    setBodyExamples((current) =>
      bodyVars.map((_, index) => current[index] ?? "")
    );
  }, [bodyVars.length]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return templates.filter((template) => {
      if (
        statusFilter !== "ALL" &&
        template.status !== statusFilter
      ) {
        return false;
      }

      if (!term) return true;

      return (
        template.name.toLowerCase().includes(term) ||
        template.body.toLowerCase().includes(term)
      );
    });
  }, [templates, search, statusFilter]);

  const approved = templates.filter(
    (item) => item.status === "APPROVED"
  ).length;
  const pending = templates.filter(
    (item) => item.status === "PENDING"
  ).length;
  const drafts = templates.filter(
    (item) => item.status === "DRAFT"
  ).length;

  function resetBuilder() {
    setEditingId(null);
    setBuilderStep(1);
    setName("");
    setCategory("MARKETING");
    setLanguage("pt_BR");
    setHeaderType("NONE");
    setHeaderText("");
    setHeaderExample("");
    setBody("");
    setBodyExamples([]);
    setFooterText("");
    setButtons([]);
    setMessage(null);
  }

  function openNewBuilder() {
    resetBuilder();
    setBuilderOpen(true);
  }

  function openEditBuilder(template: Template) {
    if (!["DRAFT", "REJECTED"].includes(template.status)) {
      setMessage(
        "Templates enviados ou aprovados não podem ser editados. Duplique para criar uma nova versão."
      );
      return;
    }

    setEditingId(template.id);
    setBuilderStep(1);
    setName(template.name);
    setCategory(template.category);
    setLanguage(template.language);
    setHeaderType(template.header_type ?? "NONE");
    setHeaderText(template.header_text ?? "");
    setHeaderExample(template.header_example ?? "");
    setBody(template.body);
    setBodyExamples(template.body_examples ?? []);
    setFooterText(template.footer_text ?? "");
    setButtons(template.buttons ?? []);
    setBuilderOpen(true);
    setMessage(null);
  }

  function closeBuilder() {
    setBuilderOpen(false);
    resetBuilder();
  }

  function insertVariable() {
    const nextNumber = bodyVars.length + 1;
    const token = `{{${nextNumber}}}`;
    setBody((current) =>
      current
        ? `${current}${current.endsWith(" ") ? "" : " "}${token}`
        : token
    );
  }

  function addButton(type: ButtonType) {
    if (buttons.length >= 3) {
      setMessage("Neste builder, use no máximo 3 botões por template.");
      return;
    }

    setButtons((current) => [...current, emptyButton(type)]);
  }

  function updateButton(
    index: number,
    patch: Partial<TemplateButton>
  ) {
    setButtons((current) =>
      current.map((button, currentIndex) =>
        currentIndex === index ? { ...button, ...patch } : button
      )
    );
  }

  function removeButton(index: number) {
    setButtons((current) =>
      current.filter((_, currentIndex) => currentIndex !== index)
    );
  }

  function builderValidation() {
    const cleanName = normalizeTemplateName(name);

    if (!cleanName) {
      return "Informe um nome para o template.";
    }

    if (!body.trim()) {
      return "O corpo da mensagem é obrigatório.";
    }

    if (!variableSequenceIsValid(bodyVars)) {
      return "As variáveis do corpo precisam ser sequenciais: {{1}}, {{2}}, {{3}}...";
    }

    if (headerVars.length > 1) {
      return "O cabeçalho deve usar no máximo uma variável.";
    }

    if (
      headerVars.length === 1 &&
      !headerExample.trim()
    ) {
      return "Informe um exemplo para a variável do cabeçalho.";
    }

    if (
      bodyVars.some(
        (_, index) => !String(bodyExamples[index] ?? "").trim()
      )
    ) {
      return "Preencha um exemplo para cada variável do corpo.";
    }

    for (const button of buttons) {
      if (!button.text.trim()) return "Todos os botões precisam de um texto.";

      if (
        button.type === "URL" &&
        !/^https?:\/\//i.test(button.url ?? "")
      ) {
        return "Os botões de link precisam começar com http:// ou https://.";
      }

      if (
        button.type === "PHONE_NUMBER" &&
        !(button.phone_number ?? "").replace(/\D/g, "")
      ) {
        return "Informe um telefone válido no botão de ligação.";
      }
    }

    return null;
  }

  async function saveDraft(
    event?: FormEvent<HTMLFormElement>
  ): Promise<string | null> {
    event?.preventDefault();

    if (!organizationId || !ctx.userId) return null;

    const validationError = builderValidation();
    if (validationError) {
      setMessage(validationError);
      return null;
    }

    setSaving(true);
    setMessage(null);

    const payload = {
      organization_id: organizationId,
      name: normalizeTemplateName(name),
      category,
      language,
      body: body.trim(),
      header_type: headerType,
      header_text:
        headerType === "TEXT" ? headerText.trim() || null : null,
      header_example:
        headerType === "TEXT"
          ? headerExample.trim() || null
          : null,
      footer_text: footerText.trim() || null,
      buttons,
      body_examples: bodyExamples,
      status: "DRAFT" as const,
      created_by: ctx.userId
    };

    let savedId = editingId;

    if (editingId) {
      const { error } = await supabase
        .from("message_templates")
        .update(payload)
        .eq("id", editingId);

      if (error) {
        setSaving(false);
        setMessage(error.message);
        return null;
      }
    } else {
      const { data, error } = await supabase
        .from("message_templates")
        .insert(payload)
        .select("id")
        .single();

      if (error || !data) {
        setSaving(false);
        setMessage(
          error?.code === "23505"
            ? "Já existe um template com esse nome."
            : error?.message ?? "Não foi possível salvar o template."
        );
        return null;
      }

      savedId = data.id;
      setEditingId(data.id);
    }

    setSaving(false);
    setMessage("Rascunho salvo.");
    await loadTemplates();
    return savedId;
  }

  async function submitBuilder() {
    let templateId = editingId;

    if (!templateId) {
      templateId = await saveDraft();
    } else {
      const saved = await saveDraft();
      if (!saved) return;
      templateId = saved;
    }

    if (!templateId) return;

    await submitTemplate(templateId);
  }

  async function submitTemplate(templateId: string) {
    setSubmittingId(templateId);
    setMessage(null);

    const { data, error } = await supabase.functions.invoke(
      "whatsapp-template-manage",
      {
        body: {
          action: "submit",
          templateId
        }
      }
    );

    setSubmittingId(null);

    if (error || !data?.ok) {
      const detail =
        data?.meta?.message ||
        data?.error ||
        error?.message ||
        "Não foi possível enviar o template para a Meta.";

      setMessage(detail);
      return;
    }

    setMessage(
      "Template enviado para a Meta. O status será atualizado quando a análise avançar."
    );
    setBuilderOpen(false);
    resetBuilder();
    await loadTemplates();
  }

  async function syncWithMeta() {
    setSyncing(true);
    setMessage(null);

    const { data, error } = await supabase.functions.invoke(
      "whatsapp-template-manage",
      {
        body: { action: "sync" }
      }
    );

    setSyncing(false);

    if (error || !data?.ok) {
      setMessage(
        data?.meta?.message ||
          data?.error ||
          error?.message ||
          "Falha ao sincronizar com a Meta."
      );
      return;
    }

    setMessage(
      `Sincronização concluída: ${data.synchronized ?? 0} template(s) atualizado(s).`
    );
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

    const { error } = await supabase
      .from("message_templates")
      .insert({
        organization_id: organizationId,
        name: `${template.name}_copia_${suffix}`,
        category: template.category,
        language: template.language,
        body: template.body,
        header_type: template.header_type,
        header_text: template.header_text,
        header_example: template.header_example,
        footer_text: template.footer_text,
        buttons: template.buttons ?? [],
        body_examples: template.body_examples ?? [],
        status: "DRAFT",
        created_by: ctx.userId
      });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Template duplicado como rascunho.");
  }

  const previewHeader =
    headerType === "TEXT"
      ? renderPreview(headerText, [], headerExample)
      : "";

  const previewBody = renderPreview(
    body || "Digite sua mensagem para visualizar a prévia.",
    bodyExamples
  );

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
      description="Crie, visualize e envie templates oficiais do WhatsApp sem sair do Mais Chat."
      actions={
        <div className="templateTopActions">
          <button
            className="secondaryAction"
            onClick={() => void syncWithMeta()}
            disabled={syncing}
          >
            {syncing ? "Sincronizando..." : "↻ Sincronizar Meta"}
          </button>
          <button
            className="primaryAction"
            onClick={
              builderOpen ? closeBuilder : openNewBuilder
            }
          >
            {builderOpen ? "Fechar builder" : "+ Novo template"}
          </button>
        </div>
      }
    >
      {builderOpen && (
        <section className="flowTemplateBuilder">
          <div className="templateBuilderMain">
            <div className="builderProgress">
              {[
                [1, "Configuração"],
                [2, "Conteúdo"],
                [3, "Revisão"]
              ].map(([step, label]) => (
                <button
                  key={step}
                  type="button"
                  className={
                    builderStep === step ? "active" : ""
                  }
                  onClick={() =>
                    setBuilderStep(step as BuilderStep)
                  }
                >
                  <span>{step}</span>
                  {label}
                </button>
              ))}
            </div>

            <form
              className="flowBuilderForm"
              onSubmit={(event) => void saveDraft(event)}
            >
              {builderStep === 1 && (
                <div className="builderStepPanel">
                  <div className="builderPanelHeading">
                    <div>
                      <p className="eyebrow">ETAPA 1</p>
                      <h2>Configuração do template</h2>
                    </div>
                    <span className="builderHintPill">
                      Meta Cloud API
                    </span>
                  </div>

                  <div className="builderField">
                    <label>Nome do template</label>
                    <input
                      value={name}
                      onChange={(event) =>
                        setName(
                          normalizeTemplateName(
                            event.target.value
                          )
                        )
                      }
                      placeholder="ex: lembrete_viagem_israel"
                      maxLength={512}
                    />
                    <small>
                      Apenas letras minúsculas, números e _
                    </small>
                  </div>

                  <div className="builderField">
                    <label>Categoria</label>
                    <div className="categoryChoiceGrid">
                      <button
                        type="button"
                        className={
                          category === "MARKETING"
                            ? "selected"
                            : ""
                        }
                        onClick={() =>
                          setCategory("MARKETING")
                        }
                      >
                        <strong>Marketing</strong>
                        <span>
                          Ofertas, novidades, viagens e
                          reengajamento.
                        </span>
                      </button>

                      <button
                        type="button"
                        className={
                          category === "UTILITY"
                            ? "selected"
                            : ""
                        }
                        onClick={() =>
                          setCategory("UTILITY")
                        }
                      >
                        <strong>Utilidade</strong>
                        <span>
                          Confirmações, lembretes e atualizações
                          de serviço.
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="builderField">
                    <label>Idioma</label>
                    <select
                      value={language}
                      onChange={(event) =>
                        setLanguage(event.target.value)
                      }
                    >
                      <option value="pt_BR">
                        Português (Brasil)
                      </option>
                      <option value="en_US">
                        English (US)
                      </option>
                      <option value="es">
                        Español
                      </option>
                    </select>
                  </div>

                  <div className="builderNavigation">
                    <span />
                    <button
                      type="button"
                      className="primaryAction"
                      onClick={() => {
                        if (!name.trim()) {
                          setMessage(
                            "Informe um nome para continuar."
                          );
                          return;
                        }
                        setMessage(null);
                        setBuilderStep(2);
                      }}
                    >
                      Continuar →
                    </button>
                  </div>
                </div>
              )}

              {builderStep === 2 && (
                <div className="builderStepPanel">
                  <div className="builderPanelHeading">
                    <div>
                      <p className="eyebrow">ETAPA 2</p>
                      <h2>Monte a mensagem</h2>
                    </div>
                    <span className="builderHintPill">
                      Prévia ao vivo
                    </span>
                  </div>

                  <div className="builderSection">
                    <div className="builderSectionHeader">
                      <div>
                        <strong>Cabeçalho</strong>
                        <span>Opcional</span>
                      </div>
                      <select
                        value={headerType}
                        onChange={(event) => {
                          const next =
                            event.target.value as HeaderType;
                          setHeaderType(next);
                          if (next === "NONE") {
                            setHeaderText("");
                            setHeaderExample("");
                          }
                        }}
                      >
                        <option value="NONE">
                          Sem cabeçalho
                        </option>
                        <option value="TEXT">
                          Texto
                        </option>
                      </select>
                    </div>

                    {headerType === "TEXT" && (
                      <>
                        <input
                          value={headerText}
                          onChange={(event) =>
                            setHeaderText(event.target.value)
                          }
                          placeholder="Ex.: Sua viagem está chegando, {{1}}"
                          maxLength={60}
                        />
                        {headerVars.length > 0 && (
                          <div className="variableExampleRow">
                            <span>{"{{1}}"}</span>
                            <input
                              value={headerExample}
                              onChange={(event) =>
                                setHeaderExample(
                                  event.target.value
                                )
                              }
                              placeholder="Exemplo: Israel"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="builderSection">
                    <div className="builderSectionHeader">
                      <div>
                        <strong>Corpo da mensagem</strong>
                        <span>Obrigatório</span>
                      </div>
                      <button
                        type="button"
                        className="miniBuilderButton"
                        onClick={insertVariable}
                      >
                        + Variável
                      </button>
                    </div>

                    <textarea
                      value={body}
                      onChange={(event) =>
                        setBody(event.target.value)
                      }
                      rows={8}
                      maxLength={1024}
                      placeholder="Olá {{1}}, sua viagem para {{2}} está confirmada..."
                    />

                    <div className="builderTextMeta">
                      <span>
                        Use *negrito*, _itálico_ e ~tachado~
                      </span>
                      <span>{body.length}/1024</span>
                    </div>

                    {bodyVars.length > 0 && (
                      <div className="variableExamples">
                        <strong>
                          Exemplos das variáveis
                        </strong>
                        <p>
                          A Meta usa estes exemplos para analisar
                          o template.
                        </p>

                        {bodyVars.map((number, index) => (
                          <div
                            className="variableExampleRow"
                            key={number}
                          >
                            <span>{`{{${number}}}`}</span>
                            <input
                              value={
                                bodyExamples[index] ?? ""
                              }
                              onChange={(event) =>
                                setBodyExamples(
                                  (current) =>
                                    current.map(
                                      (
                                        value,
                                        currentIndex
                                      ) =>
                                        currentIndex ===
                                        index
                                          ? event.target
                                              .value
                                          : value
                                    )
                                )
                              }
                              placeholder={
                                index === 0
                                  ? "Ex.: Rael"
                                  : "Ex.: Israel"
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="builderSection">
                    <div className="builderSectionHeader">
                      <div>
                        <strong>Rodapé</strong>
                        <span>Opcional</span>
                      </div>
                    </div>
                    <input
                      value={footerText}
                      onChange={(event) =>
                        setFooterText(event.target.value)
                      }
                      placeholder="Ex.: Mais Viagens"
                      maxLength={60}
                    />
                  </div>

                  <div className="builderSection">
                    <div className="builderSectionHeader">
                      <div>
                        <strong>Botões</strong>
                        <span>Até 3 neste builder</span>
                      </div>
                    </div>

                    <div className="buttonTypePicker">
                      <button
                        type="button"
                        onClick={() =>
                          addButton("QUICK_REPLY")
                        }
                      >
                        + Resposta rápida
                      </button>
                      <button
                        type="button"
                        onClick={() => addButton("URL")}
                      >
                        + Abrir site
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          addButton("PHONE_NUMBER")
                        }
                      >
                        + Ligar
                      </button>
                    </div>

                    {buttons.length > 0 && (
                      <div className="builderButtonsList">
                        {buttons.map((button, index) => (
                          <div
                            className="builderButtonRow"
                            key={index}
                          >
                            <span className="buttonKindBadge">
                              {button.type ===
                              "QUICK_REPLY"
                                ? "Resposta"
                                : button.type === "URL"
                                  ? "Link"
                                  : "Telefone"}
                            </span>

                            <input
                              value={button.text}
                              onChange={(event) =>
                                updateButton(index, {
                                  text: event.target.value
                                })
                              }
                              placeholder="Texto do botão"
                              maxLength={25}
                            />

                            {button.type === "URL" && (
                              <input
                                value={button.url ?? ""}
                                onChange={(event) =>
                                  updateButton(index, {
                                    url: event.target
                                      .value
                                  })
                                }
                                placeholder="https://..."
                              />
                            )}

                            {button.type ===
                              "PHONE_NUMBER" && (
                              <input
                                value={
                                  button.phone_number ??
                                  ""
                                }
                                onChange={(event) =>
                                  updateButton(index, {
                                    phone_number:
                                      event.target.value
                                  })
                                }
                                placeholder="+55..."
                              />
                            )}

                            <button
                              type="button"
                              className="removeBuilderButton"
                              onClick={() =>
                                removeButton(index)
                              }
                              aria-label="Remover botão"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="builderNavigation">
                    <button
                      type="button"
                      className="secondaryAction"
                      onClick={() => setBuilderStep(1)}
                    >
                      ← Voltar
                    </button>
                    <button
                      type="button"
                      className="primaryAction"
                      onClick={() => {
                        const validationError =
                          builderValidation();
                        if (validationError) {
                          setMessage(validationError);
                          return;
                        }
                        setMessage(null);
                        setBuilderStep(3);
                      }}
                    >
                      Revisar →
                    </button>
                  </div>
                </div>
              )}

              {builderStep === 3 && (
                <div className="builderStepPanel">
                  <div className="builderPanelHeading">
                    <div>
                      <p className="eyebrow">ETAPA 3</p>
                      <h2>Revisar e enviar</h2>
                    </div>
                    <span className="builderHintPill">
                      Aprovação Meta
                    </span>
                  </div>

                  <div className="templateReviewGrid">
                    <div className="reviewItem">
                      <span>Nome</span>
                      <strong>
                        {normalizeTemplateName(name)}
                      </strong>
                    </div>
                    <div className="reviewItem">
                      <span>Categoria</span>
                      <strong>
                        {categoryLabels[category]}
                      </strong>
                    </div>
                    <div className="reviewItem">
                      <span>Idioma</span>
                      <strong>{language}</strong>
                    </div>
                    <div className="reviewItem">
                      <span>Variáveis</span>
                      <strong>{bodyVars.length}</strong>
                    </div>
                  </div>

                  <div className="approvalNotice">
                    <strong>
                      O que acontece ao enviar?
                    </strong>
                    <p>
                      O Mais Chat cria este template
                      diretamente no WhatsApp Manager. A Meta
                      analisa o conteúdo e o status aparecerá
                      aqui como Em análise, Aprovado ou
                      Rejeitado.
                    </p>
                  </div>

                  <div className="builderNavigation">
                    <button
                      type="button"
                      className="secondaryAction"
                      onClick={() => setBuilderStep(2)}
                    >
                      ← Voltar
                    </button>

                    <div className="builderSubmitActions">
                      <button
                        type="submit"
                        className="secondaryAction"
                        disabled={saving}
                      >
                        {saving
                          ? "Salvando..."
                          : "Salvar rascunho"}
                      </button>

                      <button
                        type="button"
                        className="primaryAction"
                        disabled={
                          saving ||
                          submittingId === editingId
                        }
                        onClick={() =>
                          void submitBuilder()
                        }
                      >
                        {submittingId
                          ? "Enviando..."
                          : "Enviar para aprovação"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </form>
          </div>

          <aside className="templateLivePreview">
            <div className="previewHeader">
              <div>
                <p className="eyebrow">PRÉVIA</p>
                <strong>WhatsApp</strong>
              </div>
              <span>Ao vivo</span>
            </div>

            <div className="whatsappPreviewStage">
              <div className="whatsappTemplateBubble">
                {previewHeader && (
                  <strong className="previewMessageHeader">
                    {previewHeader}
                  </strong>
                )}

                <p>{previewBody}</p>

                {footerText.trim() && (
                  <small className="previewFooter">
                    {footerText}
                  </small>
                )}

                <div className="previewTime">10:42</div>

                {buttons.length > 0 && (
                  <div className="previewButtons">
                    {buttons.map((button, index) => (
                      <button type="button" key={index}>
                        <span>
                          {button.type === "URL"
                            ? "↗"
                            : button.type ===
                                "PHONE_NUMBER"
                              ? "☎"
                              : "↩"}
                        </span>
                        {button.text ||
                          "Texto do botão"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="previewChecklist">
              <div
                className={
                  name.trim() ? "ok" : ""
                }
              >
                <span>{name.trim() ? "✓" : "○"}</span>
                Nome configurado
              </div>
              <div
                className={
                  body.trim() ? "ok" : ""
                }
              >
                <span>{body.trim() ? "✓" : "○"}</span>
                Corpo preenchido
              </div>
              <div
                className={
                  bodyVars.every(
                    (_, index) =>
                      bodyExamples[index]?.trim()
                  )
                    ? "ok"
                    : ""
                }
              >
                <span>
                  {bodyVars.every(
                    (_, index) =>
                      bodyExamples[index]?.trim()
                  )
                    ? "✓"
                    : "○"}
                </span>
                Exemplos das variáveis
              </div>
            </div>
          </aside>
        </section>
      )}

      {!builderOpen && (
        <>
          <div className="metricGrid">
            <article className="metricCard">
              <span>Total</span>
              <strong>{templates.length}</strong>
              <small>na biblioteca</small>
            </article>
            <article className="metricCard">
              <span>Aprovados</span>
              <strong>{approved}</strong>
              <small>prontos para campanhas</small>
            </article>
            <article className="metricCard">
              <span>Em análise</span>
              <strong>{pending}</strong>
              <small>aguardando a Meta</small>
            </article>
            <article className="metricCard">
              <span>Rascunhos</span>
              <strong>{drafts}</strong>
              <small>em preparação</small>
            </article>
          </div>

          <section className="dataCard">
            <div className="dataToolbar">
              <label className="sectionSearch">
                <span>⌕</span>
                <input
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Buscar templates..."
                />
              </label>

              <select
                className="sectionSelect"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as
                      | "ALL"
                      | TemplateStatus
                  )
                }
              >
                <option value="ALL">
                  Todos os status
                </option>
                {Object.entries(statusLabels).map(
                  ([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </div>

            <div className="flowTemplateList">
              {filtered.map((template) => (
                <article
                  className="flowTemplateRow"
                  key={template.id}
                >
                  <div className="flowTemplateIcon">
                    ◇
                  </div>

                  <div className="flowTemplateMain">
                    <div className="flowTemplateTitleRow">
                      <h3>{template.name}</h3>
                      <span
                        className={`statePill state-${template.status.toLowerCase()}`}
                      >
                        {statusLabels[template.status]}
                      </span>
                    </div>

                    <p>
                      {template.header_text && (
                        <strong>
                          {template.header_text}{" "}
                        </strong>
                      )}
                      {template.body}
                    </p>

                    <div className="flowTemplateMeta">
                      <span>
                        {categoryLabels[template.category]}
                      </span>
                      <span>{template.language}</span>
                      <span>
                        {(template.buttons ?? []).length}{" "}
                        botão
                        {(template.buttons ?? []).length ===
                        1
                          ? ""
                          : "ões"}
                      </span>
                      {template.meta_template_id && (
                        <span>
                          Meta #{template.meta_template_id}
                        </span>
                      )}
                    </div>

                    {template.status === "REJECTED" &&
                      template.meta_status_reason && (
                        <div className="templateRejectReason">
                          {template.meta_status_reason}
                        </div>
                      )}
                  </div>

                  <div className="flowTemplateActions">
                    {["DRAFT", "REJECTED"].includes(
                      template.status
                    ) && (
                      <button
                        onClick={() =>
                          openEditBuilder(template)
                        }
                      >
                        Editar
                      </button>
                    )}

                    {template.status === "DRAFT" && (
                      <button
                        className="submitMetaButton"
                        disabled={
                          submittingId === template.id
                        }
                        onClick={() =>
                          void submitTemplate(template.id)
                        }
                      >
                        {submittingId === template.id
                          ? "Enviando..."
                          : "Enviar à Meta"}
                      </button>
                    )}

                    <button
                      onClick={() =>
                        void duplicateTemplate(template)
                      }
                    >
                      Duplicar
                    </button>

                    {template.status !== "ARCHIVED" && (
                      <button
                        onClick={() =>
                          void archiveTemplate(template.id)
                        }
                      >
                        Arquivar
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="sectionEmpty">
                <strong>
                  Nenhum template encontrado.
                </strong>
                <p>
                  Crie um template completo com prévia e
                  envie para aprovação da Meta.
                </p>
              </div>
            )}
          </section>
        </>
      )}

      {message && (
        <div className="sectionNotice">
          {message}
        </div>
      )}
    </SectionLayout>
  );
}

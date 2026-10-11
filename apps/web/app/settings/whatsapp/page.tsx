"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "../../../components/theme-toggle";
import BrandLogo from "../../../components/brand-logo";
import BusinessPhotoEditor from "../../../components/business-photo-editor";
import { supabase } from "../../../lib/supabase";

type Account = {
  id: string;
  phone_number_id: string;
  business_account_id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
};

const webhookUrl =
  "https://yqtplpmlvhzgkmbuoimk.supabase.co/functions/v1/whatsapp-webhook";

export default function WhatsAppSettingsPage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [memberRole, setMemberRole] = useState<"OWNER" | "ADMIN" | "AGENT" | null>(null);
  const [remotePhotoUrl, setRemotePhotoUrl] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoDraft, setPhotoDraft] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [photoSuccess, setPhotoSuccess] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session) {
        router.replace("/login");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("organization_members")
        .select("organization_id,role")
        .eq("user_id", session.user.id)
        .limit(1)
        .maybeSingle();

      if (membershipError || !membership) {
        setMessage("Não foi possível localizar sua organização.");
        setLoading(false);
        return;
      }

      setOrganizationId(membership.organization_id);
      setMemberRole(membership.role as "OWNER" | "ADMIN" | "AGENT");

      const { data: accountData } = await supabase
        .from("whatsapp_accounts")
        .select(
          "id,phone_number_id,business_account_id,display_phone_number,verified_name,status"
        )
        .eq("organization_id", membership.organization_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (accountData) {
        const typed = accountData as Account;
        setAccount(typed);
        setPhoneNumberId(typed.phone_number_id);
        setBusinessAccountId(typed.business_account_id ?? "");
        setDisplayPhoneNumber(typed.display_phone_number ?? "");
      }

      setLoading(false);
    }

    void load();
  }, [router]);

  async function readPhotoError(error: any, response: any) {
    if (typeof response?.error === "string") return response.error;
    try {
      const json = await error?.context?.json?.();
      if (typeof json?.error === "string") return json.error;
    } catch {
      // Supabase may return a network error without a JSON response.
    }
    return error?.message || "Não foi possível conversar com a Meta.";
  }

  useEffect(() => {
    if (!account?.id || account.status !== "CONNECTED") return;

    let cancelled = false;
    setPhotoLoading(true);

    void (async () => {
      const { data, error } = await supabase.functions.invoke(
        "whatsapp-business-photo",
        { body: { action: "get", accountId: account.id } }
      );

      if (cancelled) return;

      if (error || data?.error) {
        setPhotoMessage(await readPhotoError(error, data));
      } else {
        setRemotePhotoUrl(data?.profilePictureUrl ?? null);
      }
      setPhotoLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.id, account?.status]);

  useEffect(() => {
    if (!selectedPhoto) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(selectedPhoto);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedPhoto]);

  function choosePhoto(file?: File) {
    if (!file) return;
    setPhotoMessage(null);
    setPhotoSuccess(false);

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setPhotoMessage("Selecione uma imagem JPG ou PNG.");
      return;
    }
    if (file.size > 4 * 1024 * 1024 || file.size < 4) {
      setPhotoMessage("Escolha uma foto de até 4 MB.");
      return;
    }
    setPhotoDraft(file);
  }

  async function readPhotoBase64(file: File) {
    const value = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      reader.readAsDataURL(file);
    });
    const index = value.indexOf(",");
    if (index < 0) throw new Error("Dados da imagem inválidos.");
    return value.slice(index + 1);
  }

  async function saveBusinessPhoto() {
    if (!account || !selectedPhoto || photoSaving) return;

    // The clearly labeled action button is the user's explicit instruction.
    // Show server responses inline instead of blocking browser dialogs.
    setPhotoSaving(true);
    setPhotoSuccess(false);
    setPhotoMessage(null);

    try {
      const dataBase64 = await readPhotoBase64(selectedPhoto);
      const { data, error } = await supabase.functions.invoke(
        "whatsapp-business-photo",
        {
          body: {
            action: "update",
            accountId: account.id,
            mimeType: selectedPhoto.type,
            dataBase64,
            confirm: true
          }
        }
      );

      if (error || data?.error || data?.success !== true) {
        setPhotoMessage(await readPhotoError(error, data));
        return;
      }

      setPhotoSuccess(true);
      setPhotoMessage(
        data?.message ||
          "A Meta aceitou a foto. Pode levar alguns minutos para aparecer aos clientes."
      );
      if (typeof data?.profilePictureUrl === "string") {
        setRemotePhotoUrl(data.profilePictureUrl);
      }
    } catch (error) {
      setPhotoMessage(
        error instanceof Error ? error.message : "Não foi possível ler a imagem."
      );
    } finally {
      setPhotoSaving(false);
    }
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;

    setSaving(true);
    setMessage(null);

    const payload = {
      organization_id: organizationId,
      phone_number_id: phoneNumberId.trim(),
      business_account_id: businessAccountId.trim() || null,
      display_phone_number: displayPhoneNumber.trim() || null,
      status: "CONNECTING" as const
    };

    const response = account
      ? await supabase
          .from("whatsapp_accounts")
          .update(payload)
          .eq("id", account.id)
          .select(
            "id,phone_number_id,business_account_id,display_phone_number,verified_name,status"
          )
          .single()
      : await supabase
          .from("whatsapp_accounts")
          .insert(payload)
          .select(
            "id,phone_number_id,business_account_id,display_phone_number,verified_name,status"
          )
          .single();

    if (response.error) {
      setMessage(response.error.message);
      setSaving(false);
      return;
    }

    setAccount(response.data as Account);
    setMessage(
      "Dados públicos salvos. Agora configure os Secrets do Supabase e valide a conexão."
    );
    setSaving(false);
  }

  async function testConnection() {
    setTesting(true);
    setMessage(null);

    const { data, error } = await supabase.functions.invoke(
      "whatsapp-connection-test",
      { body: {} }
    );

    if (error) {
      setMessage(
        "A conexão ainda não pôde ser validada. Confira os Secrets e os IDs da Meta."
      );
      setTesting(false);
      return;
    }

    if (data?.account) {
      const next = {
        ...account,
        ...data.account
      } as Account;
      setAccount(next);
      setDisplayPhoneNumber(data.account.display_phone_number ?? "");
      setMessage("Conexão validada com sucesso pela Meta.");
    } else {
      setMessage("Teste concluído sem dados de conta.");
    }

    setTesting(false);
  }

  if (loading) {
    return (
      <main className="statePage">
        <div className="stateCard">
          <div className="brandMark">W</div>
          <h1>Carregando configurações...</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="settingsPage">
      <header className="settingsTopbar">
        <a className="settingsBack" href="/settings">← Configurações</a>
        <div className="settingsBrand settingsBrandWithLogo">
          <BrandLogo className="settingsBrandLogo" />
          <div>
            <strong>Mais Chat</strong>
            <span>Configuração do WhatsApp</span>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <div className="settingsContent">
        <section className="settingsIntro">
          <p className="eyebrow">META WHATSAPP CLOUD API</p>
          <h1>Conectar um número de WhatsApp</h1>
          <p>
            Os identificadores públicos ficam no banco. Tokens e segredos ficam
            apenas nos Secrets do Supabase e nunca são salvos no navegador.
          </p>
        </section>

        <div className="settingsGrid">
          <section className="settingsCard">
            <div className="settingsCardHeader">
              <div>
                <span className="stepNumber">1</span>
                <h2>Identificadores da Meta</h2>
              </div>
              <span className={`connectionStatus status-${account?.status?.toLowerCase() ?? "disconnected"}`}>
                {account?.status ?? "DISCONNECTED"}
              </span>
            </div>

            <form className="settingsForm" onSubmit={saveAccount}>
              <label>
                Phone Number ID
                <input
                  value={phoneNumberId}
                  onChange={(event) => setPhoneNumberId(event.target.value)}
                  placeholder="Ex.: 123456789012345"
                  required
                />
              </label>

              <label>
                WhatsApp Business Account ID
                <input
                  value={businessAccountId}
                  onChange={(event) => setBusinessAccountId(event.target.value)}
                  placeholder="WABA ID"
                  required
                />
              </label>

              <label>
                Número exibido
                <input
                  value={displayPhoneNumber}
                  onChange={(event) => setDisplayPhoneNumber(event.target.value)}
                  placeholder="+55..."
                />
              </label>

              <button className="authPrimaryButton" disabled={saving}>
                {saving ? "Salvando..." : "Salvar identificadores"}
              </button>
            </form>
          </section>

          <section className="settingsCard">
            <div className="settingsCardHeader">
              <div>
                <span className="stepNumber">2</span>
                <h2>Webhook da Meta</h2>
              </div>
            </div>

            <p className="settingsHint">
              Use este endereço em <strong>Callback URL</strong> na configuração
              de Webhooks do WhatsApp:
            </p>

            <div className="copyField">
              <code>{webhookUrl}</code>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(webhookUrl)}
              >
                Copiar
              </button>
            </div>

            <p className="settingsHint">
              O <strong>Verify Token</strong> deve ser exatamente o mesmo valor
              salvo no Secret <code>WHATSAPP_VERIFY_TOKEN</code>.
            </p>
          </section>

          <section className="settingsCard">
            <div className="settingsCardHeader">
              <div>
                <span className="stepNumber">3</span>
                <h2>Secrets do Supabase</h2>
              </div>
            </div>

            <div className="secretList">
              <code>WHATSAPP_ACCESS_TOKEN</code>
              <code>WHATSAPP_APP_SECRET</code>
              <code>WHATSAPP_VERIFY_TOKEN</code>
              <code>WHATSAPP_GRAPH_VERSION</code>
            </div>

            <p className="settingsHint">
              Adicione esses quatro valores em <strong>Edge Functions → Secrets</strong>.
              O Graph Version deve ser a versão indicada no seu painel da Meta.
            </p>

            <a
              className="detailsButton settingsLink"
              href="https://supabase.com/dashboard/project/yqtplpmlvhzgkmbuoimk/functions/secrets"
              target="_blank"
              rel="noreferrer"
            >
              Abrir Secrets do Supabase ↗
            </a>
          </section>

          <section className="settingsCard businessPhotoCard">
            <div className="settingsCardHeader">
              <div>
                <span className="stepNumber">5</span>
                <h2>Foto do perfil comercial</h2>
              </div>
              <span className="businessPhotoPublicLabel">Visível aos clientes</span>
            </div>

            <p className="settingsHint">
              Esta é a imagem pública do número{" "}
              <strong>{account?.display_phone_number || "WhatsApp"}</strong>.
              A mudança é feita diretamente no perfil comercial da Meta;
              não altera fotos de atendentes ou contatos.
            </p>

            <div className="businessPhotoEditor">
              <div className="businessPhotoPreview">
                {(photoPreview || remotePhotoUrl) ? (
                  <img
                    src={photoPreview || remotePhotoUrl || ""}
                    alt={photoPreview ? "Prévia da nova foto comercial" : "Foto comercial atual"}
                    onError={() => {
                      if (!photoPreview) setRemotePhotoUrl(null);
                    }}
                  />
                ) : (
                  <span aria-hidden="true">MV</span>
                )}
              </div>
              <div className="businessPhotoEditorContent">
                <strong>
                  {selectedPhoto
                    ? "Nova foto selecionada"
                    : photoLoading
                      ? "Consultando a Meta..."
                      : remotePhotoUrl
                        ? "Foto comercial atual"
                        : "Foto ainda não disponível"}
                </strong>
                <span>{selectedPhoto?.name || "Recomendado: imagem quadrada com a logo da Mais Viagens."}</span>
                <div className="businessPhotoActions">
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="businessPhotoFileInput"
                    aria-label="Selecionar foto comercial"
                    onChange={(event) => {
                      choosePhoto(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    disabled={photoSaving || !account || account.status !== "CONNECTED" || memberRole === "AGENT"}
                  />
                  <button
                    className="detailsButton"
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoSaving || !account || account.status !== "CONNECTED" || memberRole === "AGENT"}
                  >
                    Escolher imagem
                  </button>
                  <button
                    className="authPrimaryButton"
                    type="button"
                    disabled={!selectedPhoto || photoSaving || !account || account.status !== "CONNECTED" || memberRole === "AGENT"}
                    onClick={() => void saveBusinessPhoto()}
                  >
                    {photoSaving ? "Atualizando na Meta..." : "Atualizar foto comercial"}
                  </button>
                </div>
              </div>
            </div>
            <p className="settingsHint">
              Aceita JPG ou PNG de até 4 MB. Ajuste zoom, posição e recorte antes de enviar. Ao clicar em Atualizar foto comercial, a foto pública será alterada diretamente no WhatsApp, sem confirmação adicional. Apenas administradores podem alterar a foto.
              A Meta pode demorar alguns minutos para atualizar o WhatsApp dos clientes.
            </p>
            {memberRole === "AGENT" && (
              <p className="settingsHint">Peça a um administrador para alterar a foto comercial.</p>
            )}
            {photoMessage && (
              <div className={`businessPhotoNotice ${photoSuccess ? "success" : "error"}`} role="status">
                {photoMessage}
              </div>
            )}
          </section>

          <section className="settingsCard">
            <div className="settingsCardHeader">
              <div>
                <span className="stepNumber">4</span>
                <h2>Validar conexão</h2>
              </div>
            </div>

            <p className="settingsHint">
              Depois de configurar os IDs e os Secrets, teste a conexão. O
              sistema consulta a Meta e só marca a conta como conectada se a
              credencial funcionar.
            </p>

            <button
              className="authPrimaryButton"
              type="button"
              disabled={!account || testing}
              onClick={() => void testConnection()}
            >
              {testing ? "Validando..." : "Testar conexão com a Meta"}
            </button>

            {account?.verified_name && (
              <div className="verifiedAccount">
                <strong>{account.verified_name}</strong>
                <span>{account.display_phone_number}</span>
              </div>
            )}
          </section>
        </div>

        {message && <div className="settingsMessage">{message}</div>}
      </div>

      {photoDraft && (
        <BusinessPhotoEditor
          file={photoDraft}
          onCancel={() => setPhotoDraft(null)}
          onConfirm={(cropped) => {
            setSelectedPhoto(cropped);
            setPhotoDraft(null);
            setPhotoMessage(null);
            setPhotoSuccess(false);
          }}
        />
      )}
    </main>
  );
}

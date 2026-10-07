"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "../../../components/theme-toggle";
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
        .select("organization_id")
        .eq("user_id", session.user.id)
        .limit(1)
        .maybeSingle();

      if (membershipError || !membership) {
        setMessage("Não foi possível localizar sua organização.");
        setLoading(false);
        return;
      }

      setOrganizationId(membership.organization_id);

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
        <a className="settingsBack" href="/">← Voltar</a>
        <div className="settingsBrand">
          <div className="brandMark">W</div>
          <div>
            <strong>Whats BS Manager</strong>
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
    </main>
  );
}

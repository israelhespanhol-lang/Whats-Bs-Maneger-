"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "../../components/brand-logo";
import { supabase } from "../../lib/supabase";

type FeatureKind = "chat" | "people" | "campaign" | "automation";

function FeatureIcon({ kind }: { kind: FeatureKind }) {
  if (kind === "chat") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 18.5 3.5 20l1.1-3.7A7.5 7.5 0 1 1 7 18.5Z" />
        <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
      </svg>
    );
  }

  if (kind === "people") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19v-1.2c0-2.7 2.4-4.8 5.5-4.8s5.5 2.1 5.5 4.8V19" />
        <circle cx="17" cy="9" r="2.3" />
        <path d="M15.5 14c2.9.2 5 1.8 5 4.1V19" />
      </svg>
    );
  }

  if (kind === "campaign") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 13V9h4l8-4v12l-8-4H4Z" />
        <path d="m8 13 1.2 5h2.4l-1.4-4.2M19 8.5c1 .8 1.5 1.9 1.5 3s-.5 2.2-1.5 3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" />
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      router.push("/");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir o acesso."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loginWithGoogle() {
    setGoogleLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/`
            : undefined
      }
    });

    if (error) {
      setMessage(error.message);
      setGoogleLoading(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setMessage("Digite seu e-mail primeiro para receber o link de recuperação.");
      return;
    }

    setResetLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo:
        typeof window !== "undefined"
          ? `${window.location.origin}/login`
          : undefined
    });

    setMessage(
      error
        ? error.message
        : "Enviamos um link de recuperação para o seu e-mail."
    );
    setResetLoading(false);
  }

  const features: Array<{
    kind: FeatureKind;
    title: string;
    description: string;
  }> = [
    {
      kind: "chat",
      title: "Conversas",
      description: "em um só lugar"
    },
    {
      kind: "people",
      title: "Gestão de",
      description: "contatos"
    },
    {
      kind: "campaign",
      title: "Campanhas",
      description: "mais eficientes"
    },
    {
      kind: "automation",
      title: "Automações",
      description: "que ampliam seus resultados"
    }
  ];

  return (
    <main className="maisLoginPage">
      <section className="maisLoginHero">
        <div className="maisLoginHeroGlow" />

        <div className="maisLoginBrand">
          <BrandLogo className="maisLoginBrandLogo" />
          <span>MAIS CHAT</span>
        </div>

        <div className="maisLoginCopy">
          <p className="maisLoginKicker">MULTIATENDIMENTO</p>
          <h1>
            Seu Atendimento
            <br />
            da Mais Viagens
            <br />
            em uma única
            <br />
            operação.
          </h1>
          <p className="maisLoginDescription">
            Conversas, contatos, campanhas e automações
            <br className="maisDesktopBreak" />
            em uma experiência centralizada da Mais Viagens.
          </p>

          <div className="maisLoginFeatures">
            {features.map((feature) => (
              <div className="maisLoginFeature" key={feature.kind}>
                <div className="maisLoginFeatureIcon">
                  <FeatureIcon kind={feature.kind} />
                </div>
                <strong>{feature.title}</strong>
                <span>{feature.description}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="maisLoginScenic">
          <div className="maisLoginFlightPath" />
          <div className="maisLoginPlane" aria-hidden="true">✈</div>
          <div className="maisLoginMonument" aria-hidden="true">
            <BrandLogo className="maisLoginMonumentLogo" />
          </div>

          <div className="maisLoginDestination">
            <div className="maisLoginDestinationIcon">◎</div>
            <p>
              Mais tecnologia para conectar
              <br />
              pessoas a <strong>novos destinos.</strong>
            </p>
          </div>
        </div>
      </section>

      <section className="maisLoginAccess">
        <div className="maisLoginCard">
          <div className="maisLoginCardBrand">
            <BrandLogo className="maisLoginCardLogo" />
            <span>MAIS CHAT</span>
          </div>

          <header className="maisLoginCardHeader">
            <h2>Bem-vindo de volta</h2>
            <p>
              Acesse sua conta para continuar no
              <br />
              Mais Chat.
            </p>
          </header>

          <form className="maisLoginForm" onSubmit={submit}>
            <label>
              <span>E-mail</span>
              <div className="maisLoginInput">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m4 7 8 6 8-6" />
                </svg>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seu@email.com"
                  required
                  autoComplete="email"
                />
              </div>
            </label>

            <label>
              <span>Senha</span>
              <div className="maisLoginInput">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="5" y="10" width="14" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Sua senha"
                  minLength={6}
                  required
                  autoComplete="current-password"
                />
                <button
                  className="maisLoginEye"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" />
                    <circle cx="12" cy="12" r="2.4" />
                  </svg>
                </button>
              </div>
            </label>

            <div className="maisLoginOptions">
              <label className="maisLoginRemember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <span>Lembrar de mim</span>
              </label>

              <button
                type="button"
                className="maisLoginLink"
                onClick={() => void resetPassword()}
                disabled={resetLoading}
              >
                {resetLoading ? "Enviando..." : "Esqueceu a senha?"}
              </button>
            </div>

            {message && <div className="maisLoginMessage">{message}</div>}

            <button
              className="maisLoginPrimary"
              type="submit"
              disabled={loading}
            >
              <span>{loading ? "Entrando..." : "Entrar no Mais Chat"}</span>
              {!loading && <b>→</b>}
            </button>
          </form>

          <div className="maisLoginDivider">
            <span />
            <small>ou</small>
            <span />
          </div>

          <button
            className="maisLoginGoogle"
            type="button"
            onClick={() => void loginWithGoogle()}
            disabled={googleLoading}
          >
            <span className="maisGoogleG">G</span>
            {googleLoading ? "Conectando..." : "Entrar com o Google"}
          </button>

          <footer className="maisLoginCardFooter">
            <span>Ainda não tem uma conta?</span>
            <a href="mailto:contato@maisviagens.com.br">
              Fale com o time comercial
            </a>
          </footer>
        </div>
      </section>
    </main>
  );
}

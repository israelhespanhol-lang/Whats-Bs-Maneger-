"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "../../components/brand-logo";
import ThemeToggle from "../../components/theme-toggle";
import { supabase } from "../../lib/supabase";

type FeatureKind = "chat" | "people" | "chart";

function FeatureIcon({ kind }: { kind: FeatureKind }) {
  if (kind === "chat") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 18.4 3.7 20l1-3.6A7.7 7.7 0 1 1 7 18.4Z" />
        <path d="M8.4 11.6h.01M12 11.6h.01M15.6 11.6h.01" />
      </svg>
    );
  }

  if (kind === "people") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.7 19v-1.2C3.7 15 6 13 9 13s5.3 2 5.3 4.8V19" />
        <circle cx="17" cy="9" r="2.2" />
        <path d="M15.7 14c2.8.2 4.8 1.8 4.8 4.1V19" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19V11M12 19V5M19 19v-8" />
      <path d="M3 19h18" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      title: "Todas as conversas",
      description: "Em um só lugar."
    },
    {
      kind: "people",
      title: "Mais produtividade",
      description: "Para o seu time."
    },
    {
      kind: "chart",
      title: "Resultados que viajam",
      description: "Junto com o seu negócio."
    }
  ];

  return (
    <main className="loginV2">
      <div className="loginV2Scenery" aria-hidden="true" />
      <div className="loginV2SceneryShade" aria-hidden="true" />
      <div className="loginV2Arc loginV2ArcTop" aria-hidden="true" />
      <div className="loginV2Arc loginV2ArcBottom" aria-hidden="true" />
      <div className="loginV2GlowOrb" aria-hidden="true" />

      <header className="loginV2Topbar">
        <div className="loginV2Brand">
          <BrandLogo className="loginV2BrandLogo" />
          <span className="loginV2BrandDivider" />
          <strong>Mais Chat</strong>
        </div>

        <div className="loginV2Theme">
          <ThemeToggle />
        </div>
      </header>

      <section className="loginV2Hero">
        <div className="loginV2Eyebrow">
          <span>MULTIATENDIMENTO</span>
          <i />
        </div>

        <h1>
          Seu Atendimento
          <br />
          da <em>Mais Viagens</em>
          <br />
          em uma única
          <br />
          operação.
        </h1>

        <p className="loginV2Description">
          Conversas, contatos, campanhas e automações
          <br />
          em uma experiência centralizada da Mais Viagens.
        </p>

        <div className="loginV2Features">
          {features.map((feature) => (
            <div className="loginV2Feature" key={feature.kind}>
              <div className="loginV2FeatureIcon">
                <FeatureIcon kind={feature.kind} />
              </div>
              <div>
                <strong>{feature.title}</strong>
                <span>{feature.description}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="loginV2Tagline">
        <i />
        <p>
          TECNOLOGIA
          <br />
          QUE APROXIMA
          <br />
          DESTINOS
        </p>
      </div>

      <section className="loginV2Card">
        <div className="loginV2CardBrand" aria-hidden="true">
          <BrandLogo className="loginV2CardLogo" alt="" />
        </div>

        <header>
          <h2>Acesse o Mais Chat</h2>
          <p>
            Entre com suas credenciais para continuar
            <br />
            e oferecer o melhor atendimento.
          </p>
        </header>

        <form className="loginV2Form" onSubmit={submit}>
          <label>
            <span>E-mail</span>
            <div className="loginV2Input">
              <MailIcon />
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
            <div className="loginV2Input">
              <LockIcon />
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
                className="loginV2Eye"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                <EyeIcon />
              </button>
            </div>
          </label>

          <div className="loginV2ForgotRow">
            <button
              type="button"
              className="loginV2Link"
              onClick={() => void resetPassword()}
              disabled={resetLoading}
            >
              {resetLoading ? "Enviando..." : "Esqueceu a senha?"}
            </button>
          </div>

          {message && <div className="loginV2Message">{message}</div>}

          <button
            className="loginV2Primary"
            type="submit"
            disabled={loading}
          >
            <span>{loading ? "Entrando..." : "Entrar no Mais Chat"}</span>
            {!loading && <b>→</b>}
          </button>
        </form>

        <div className="loginV2Divider">
          <span />
          <small>ou</small>
          <span />
        </div>

        <button
          className="loginV2Google"
          type="button"
          onClick={() => void loginWithGoogle()}
          disabled={googleLoading}
        >
          <span className="loginV2GoogleLogo" aria-hidden="true">G</span>
          {googleLoading ? "Conectando..." : "Entrar com Google"}
        </button>
      </section>
    </main>
  );
}

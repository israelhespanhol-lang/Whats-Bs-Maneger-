"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "../../components/theme-toggle";
import BrandLogo from "../../components/brand-logo";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name }
          }
        });

        if (error) throw error;

        setMessage(
          "Conta criada. Se a confirmação por e-mail estiver ativa, confirme seu e-mail antes de entrar."
        );
        setMode("login");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      router.push("/");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Não foi possível concluir o acesso."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="authPage">
      <section className="authBrandPanel">
        <div className="authBrand authBrandWithLogo">
          <BrandLogo className="authBrandLogo" />
          <span className="productName authProductName">Mais Chat</span>
        </div>

        <div className="authHeroCopy">
          <p className="eyebrow">MULTIATENDIMENTO</p>
          <h1>Seu Atendimento da Mais Viagens em uma única operação.</h1>
          <p>
            Conversas, contatos, campanhas e automações em uma experiência centralizada da Mais Viagens.
          </p>
        </div>

        <div className="authTheme">
          <ThemeToggle />
        </div>
      </section>

      <section className="authFormPanel">
        <div className="authCard">
          <div className="authCardHeader">
            <p className="eyebrow">
              {mode === "login" ? "ACESSO SEGURO" : "CRIAR CONTA"}
            </p>
            <h2>
              {mode === "login" ? "Entrar no Mais Chat" : "Criar seu acesso"}
            </h2>
            <p>
              {mode === "login"
                ? "Use seu e-mail e senha para acessar a operação."
                : "Crie um usuário para começar a configurar a empresa."}
            </p>
          </div>

          <form className="authForm" onSubmit={submit}>
            {mode === "signup" && (
              <label>
                Nome
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Seu nome"
                  required
                  autoComplete="name"
                />
              </label>
            )}

            <label>
              E-mail
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@empresa.com.br"
                required
                autoComplete="email"
              />
            </label>

            <label>
              Senha
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                minLength={6}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>

            {message && <div className="authMessage">{message}</div>}

            <button className="authPrimaryButton" type="submit" disabled={loading}>
              {loading
                ? "Aguarde..."
                : mode === "login"
                  ? "Entrar"
                  : "Criar conta"}
            </button>
          </form>

          <button
            className="authSwitch"
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setMessage(null);
            }}
          >
            {mode === "login"
              ? "Ainda não tenho acesso"
              : "Já tenho uma conta"}
          </button>
        </div>
      </section>
    </main>
  );
}

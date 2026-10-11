"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BrandLogo from "../../components/brand-logo";
import { supabase } from "../../lib/supabase";
import styles from "./invite.module.css";

type State = "checking" | "ready" | "missing" | "success";

export default function TeamInvitationPage() {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const update = async () => {
      const { data, error: authError } = await supabase.auth.getSession();
      if (!live) return;
      if (authError) setError("Não foi possível validar o convite. Abra novamente o link recebido por e-mail.");
      if (data.session?.user) {
        setEmail(data.session.user.email || "");
        setState("ready");
      } else {
        setState("missing");
      }
    };
    void update();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!live) return;
      if (session?.user) {
        setEmail(session.user.email || "");
        setState("ready");
      }
    });
    return () => {
      live = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function completeInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || password.length < 8) return;
    if (password !== confirmation) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      setError(passwordError.message || "Não foi possível cadastrar a senha.");
      setBusy(false);
      return;
    }
    // The normal app context also retries activation after a successful sign-in.
    const { data: activated, error: activationError } = await supabase.functions.invoke("team-members", {
      body: { action: "activate" }
    });
    if (activationError || !activated?.ok) {
      setError("Senha salva com sucesso, mas a confirmação da equipe não foi concluída. Você já pode entrar com este e-mail e a nova senha.");
      setState("success");
      setBusy(false);
      return;
    }
    setState("success");
    router.replace("/");
    router.refresh();
  }

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}><BrandLogo className={styles.logo} /> <span>Mais Chat</span></div>
        <span className={styles.eyebrow}>CONVITE DE EQUIPE</span>
        <h1>Bem-vindo ao atendimento da Mais Viagens</h1>
        <p className={styles.explanation}>
          Configure seu acesso individual para trabalhar com a equipe, sem compartilhar senhas.
        </p>

        {state === "checking" && <p className={styles.notice}>Verificando seu convite...</p>}

        {state === "missing" && (
          <div className={styles.notice}>
            <strong>Convite não identificado nesta sessão.</strong>
            <p>Abra o link mais recente recebido por e-mail. Se você já possui senha ou conta Google vinculada ao e-mail convidado, entre normalmente.</p>
            <Link className={styles.primaryLink} href="/login">Ir para o login</Link>
          </div>
        )}

        {state === "ready" && (
          <form className={styles.form} onSubmit={(event) => void completeInvite(event)}>
            <label>
              E-mail convidado
              <input value={email} disabled type="email" />
            </label>
            <label>
              Criar senha
              <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Pelo menos 8 caracteres" disabled={busy} />
            </label>
            <label>
              Confirmar senha
              <input type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Digite a senha novamente" disabled={busy} />
            </label>
            <button className={styles.submit} type="submit" disabled={busy || password.length < 8 || !confirmation}>
              {busy ? "Ativando acesso..." : "Concluir meu acesso"}
            </button>
          </form>
        )}

        {state === "success" && (
          <Link href="/login" className={styles.primaryLink}>Entrar no Mais Chat</Link>
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}
        <p className={styles.footer}>Seu acesso é individual. As conversas pertencem à organização.</p>
      </div>
    </main>
  );
}

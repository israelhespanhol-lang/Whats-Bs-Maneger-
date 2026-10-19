# CLAUDE.md — Mais Chat

> **Leia primeiro:** [Handoff completo do projeto, 19/10/2026](docs/HANDOFF_CLAUDE_2026-10-19.md).
> Documento operacional: o que está no `main`, o que permanece em PRs e o que **não** deve ser ativado.

## Objetivo inegociável
O usuário quer reproduzir o FlowChat: **um único número comercial** usado em **COEX (templates/disparos pela Cloud API)** e **Suporte (conversas reais com o cliente)**. A prioridade é conseguir, se tecnicamente viável, **atendimento pelo WhatsApp Business real fora da janela de 24h da Cloud API**, com experiência multiatendente e nome visível ao cliente, como `Israel Hespanhol:\nOlá!`. Não confundir isso com apenas imitar a interface ou duplicar um número no menu.

## Estado agora
- Produção: branch `main`, app Vercel; COEX e Suporte são abas de UI ligadas à mesma conta da Cloud API (PR #20 merged). **Isso não é COEX oficial ativo.**
- Número: chip novo, registrado **diretamente na Meta Cloud API**, nunca usado no WhatsApp Business App; usuário tem chip/celular e aceitaria indisponibilidade planejada, **mas não autorizou desregistrar agora**.
- PR #19: assinatura e atribuição do atendente nas mensagens manuais pela API, **draft, não merged, Edge Function não implantada**.
- PR #22: ponte laboratorial NÃO OFICIAL com Baileys/QR, **draft, não merged, sem sessão pareada ou mensagens reais testadas**, conexão/envio desativados por padrão.
- Banco Mais Chat: Supabase `yqtplpmlvhzgkmbuoimk`. **Conector Supabase ligado nesta sessão não tem autorização para esse projeto**; não use outro projeto como substituto.
- Meta/COEX oficial: requer validação da elegibilidade do número API-only para migração ao WhatsApp Business App e, depois, eventual Embedded Signup. Não há garantia de retorno à Cloud API em COEX.
- Não existem chaves ou credenciais neste arquivo. Nunca solicitá-las via chat.

## Regra de operação do usuário
**Fazer mudanças no código por conta própria** quando possível, com PR, CI e deploy validado; não delegar código/copiar comandos ao usuário sem necessidade. Nunca disparar campanhas, respostas ou follow-ups sem autorização. Não mexer no número, templates, credenciais, webhooks e banco de produção sem conferência/backup/consentimento específico. Diferenciar sempre **prévia, merge, deploy Vercel, deploy Edge Function e funcionamento real**.

## Primeiro roteiro para o Claude
1. Ler o [handoff](docs/HANDOFF_CLAUDE_2026-10-19.md), `docs/COEX_MIGRATION_READINESS.md`, PRs [#19](https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-/pull/19) e [#22](https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-/pull/22).
2. Verificar estado atual de `main`, CI, projeto Vercel, acessos ao Supabase correto, código dos webhooks e disponibilidade do app Meta.
3. **Perguntar somente o que realmente bloqueia o próximo passo**; não propor recomeçar do zero.
4. Traçar duas frentes isoladas: (A) via **COEX oficial**, caso elegível; (B) protótipo Baileys em **número de laboratório** e com riscos documentados. Não considerar que (B) pode coexistir com API no mesmo número sem prova concreta.
5. Antes de qualquer desregistro, obter aceitação separada do plano de migração, duração da interrupção, backup e rollback.

**Projeto distinto:** LeadOps/VollyChat na EC2 não é o Mais Chat. Não acessar nem ativar disparos, IA ou campanhas do LeadOps por causa desta transferência.

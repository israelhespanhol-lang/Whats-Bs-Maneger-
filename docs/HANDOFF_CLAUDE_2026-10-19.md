# HANDOFF PARA CLAUDE — MAIS CHAT / COEX + SUPORTE
**Data de referência:** 19/10/2026  
**Origem:** continuação do trabalho no Mais Chat após discussões detalhadas sobre reproduzir o FlowChat.  
**Estado:** documentação de transição, **não é autorização para intervenção na conta Meta**.

## 0. A instrução que define todo o projeto

O usuário quer que um mesmo número comercial apareça e funcione como dois canais operacionais, conforme o antigo FlowChat:

1. **COEX:** API oficial para campanhas em massa por templates aprovados, lotes, relatórios, custos e acompanhamento.
2. **SUPORTE:** atendimento humano para as pessoas que responderem, com múltiplos atendentes, nomes próprios e histórico compartilhado. **Requisito decisivo:** conseguir usar uma sessão REAL do WhatsApp Business para conversar manualmente mesmo quando a janela de 24 horas da Cloud API estiver fechada. Não basta uma interface que se pareça com WhatsApp Web.

**Exemplo da mensagem que o cliente deve ver:**

```text
Israel Hespanhol:
Olá! Vou verificar sua solicitação.
```

O nome deve vir da identidade real/autenticada do atendente. O número comercial é único; nunca criar dois cadastros reais da Meta para simular dois canais. O cliente e suas mensagens devem ter histórico consistente.

### O que NÃO resolveria a necessidade
- Duplicar visualmente a opção de canal COEX / Suporte, sem duas capacidades operacionais reais.
- Criar uma interface idêntica ao WhatsApp Web usando somente `whatsapp-send`: o endpoint Cloud API ainda verifica a janela de 24 horas.
- Presumir que disparar templates estende automaticamente a janela de 24 h: **a resposta do cliente** é o evento típico que abre/renova a janela de atendimento da API.
- Prometer um `iframe` oficial com WhatsApp Web; não há integração pública documentada para incorporar toda a sessão do app com permissões de envio fora da janela.

### Histórico relevante esclarecido pelo usuário
- No FlowChat, havia uma aba **COEX** para disparos e uma aba **Suporte** para respostas; ele confirmou que ambas usavam **exatamente o mesmo número comercial**.
- O usuário ouviu referência a **QR Code** no FlowChat, mas **não viu pessoalmente o pareamento**, portanto a arquitetura interna do FlowChat continua uma hipótese, NÃO um fato verificado.
- O chip atual do Mais Chat foi **comprado novo e registrado diretamente na Meta Cloud API**. Nunca foi previamente conectado ao WhatsApp Business App.
- O usuário **possui o chip e um celular** que pode receber SMS/ligação e usar o aplicativo.
- Ele **aceitaria interrupção planejada** para migração, se necessária, e aceita riscos experimentais, inclusive de integração não oficial; isso **não equivale a autorizar o desregistro imediado**, disparos ou alterações irreversíveis.
- Ele prefere que o assistente implemente alterações diretamente nos arquivos, faça PRs, valide CI/deploy e forneça status, em vez de instruir o usuário a fazer as alterações.

## 1. Repositório e infraestrutura conhecidos

| Recurso | Referência / condição |
|---|---|
| Código GitHub | [israelhespanhol-lang/Whats-Bs-Maneger-](https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-) |
| Branch de produção | `main` |
| Mais Chat (endereço conhecido) | https://whats-bs-manager.vercel.app |
| Vercel projectId | `prj_CGfv1NPkwQcSk74yoYPvxpS6GzBP` |
| Supabase Mais Chat project ref | `yqtplpmlvhzgkmbuoimk` |
| URL Supabase | `https://yqtplpmlvhzgkmbuoimk.supabase.co` |
| Deploy de produção (verificado em 19/10) | `fbae2c758c3434d97dc8e8721295c17cccf767c9`, Vercel **READY** |
| Guia de prontidão | [docs/COEX_MIGRATION_READINESS.md](COEX_MIGRATION_READINESS.md) |
| Edge webhook | `supabase/functions/whatsapp-webhook/index.ts` |
| Edge envio manual | `supabase/functions/whatsapp-send/index.ts` |
| Painel de Suporte | `apps/web/components/dashboard-client.tsx` |
| Painel de COEX/Disparos | `apps/web/components/broadcasts-client.tsx` |
| Menu lateral | `apps/web/components/app-sidebar.tsx` |
| Configurações WhatsApp | `apps/web/app/settings/whatsapp/page.tsx` |
| Banco e migrations | `database/migrations/` |

**Atenção ao acesso ao Supabase:** ao consultar em 19/10, o conector listado na sessão mostrava **somente outro projeto**, `hylycnzcnkwlqjwpuycc`. O acesso a `yqtplpmlvhzgkmbuoimk` retornou `ProtocolError -32600: You do not have permission to perform this action`. **NÃO usar `hylycnzcnkwlqjwpuycc` como banco do Mais Chat nem executar migrações nele.** Solicitar a conexão/escopo correto antes de inspecionar, migrar ou publicar Edge Functions do Mais Chat. A impossibilidade de acesso não prova que o Supabase principal esteja offline.

**Outros projetos:** LeadOps e integração VollyChat/COEX da EC2 são outro fluxo de trabalho. Não reiniciar, ativar IA ou enviar campanhas do LeadOps ao trabalhar no Mais Chat.

## 2. Estado do desenvolvimento, verificado em 19/10/2026

### 2.1. Em produção (`main`)
- Autenticação de usuários, organizações, memberships `OWNER/ADMIN/AGENT`, convite/acesso da equipe, Supabase Auth e políticas RLS.
- WhatsApp Cloud API conectada por registro de `whatsapp_accounts`, referenciado por `phone_number_id`, com conta/organização.
- Recebimento de mensagens pelo webhook Meta, contatos e conversas armazenados no Supabase; conversas atreladas a `whatsapp_account_id` e `contact_id`.
- Envio individual pelo `whatsapp-send` enquanto janela de atendimento está aberta. Retorna `WINDOW_CLOSED` quando expirada, exigindo template.
- Recursos de atendimento: atribuição, transferência e filtros, notas internas, respostas rápidas, anexos/áudio e outras funcionalidades em módulos existentes.
- Campanhas e disparos: templates aprovados, seleção/auditoria de público, precificação, preparação, execução manual e acompanhamento; nunca executar sem aprovação do usuário.
- Menu já exibe **Suporte** e **COEX · Disparos** como áreas separadas (PR #20, merge `52bd253...`). **Ainda é o MESMO backend Cloud API, não duas sessões transportes independentes.**
- PR #21 incluiu checklist de migração. Merge `fbae2c758c3434d97dc8e8721295c17cccf767c9`, produção **READY**.
- Webhook de produção no repositório **não contém `smb_message_echoes`**; trata mensagens recebidas e statuses. Se COEX oficial for ativado no futuro, terá que registrar ecos do app como `OUTBOUND`, sem abrir janelas da API, com deduplicação.
- A instância de produção deve ser auditada novamente no começo da sessão Claude, pois o GitHub pode ter avançado após esta data.

### 2.2. PR #19: atribuição e assinatura visível ao cliente — **NÃO MERGED**
[Pull request #19](https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-/pull/19) — branch `feat/agent-attribution-in-chat-20261017`, **aberto em DRAFT** no último exame, commit `1aa39071c2d1be6620b0f6db909ee7300bd2df80`.

Código da branch, **NÃO produção**:
- Backend consulta `organization_members` do usuário autenticado; registra no JSON `messages.raw_payload.sent_by` o `member_id`, o nome e a origem.
- Nas mensagens **manuais** de texto e nas legendas de mídia (exceto áudio) prepara a assinatura `Nome do atendente:\nMensagem`. Templates/campanhas continuam intocados.
- Frontend solicita projeção JSON `sent_by:raw_payload->sent_by` e mostra autoria nas bolhas. Corrige prévia de envio de `Você:` para `Equipe:`.
- Sucesso anterior de builds da Vercel em prévia, mas **a função Edge `whatsapp-send` NÃO foi implantada** por ausência de permissão Supabase. Fazer revisão, correção, testes e deploy coordenado; não fazer merge isolado do frontend e considerar a API publicada.

### 2.3. PR #22: bridge WhatsApp Web NÃO OFICIAL, protótipo — **NÃO MERGED**
[Pull request #22](https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-/pull/22) — branch `experimental/whatsapp-business-linked-session-lab`, **aberto em DRAFT**, último commit `15773a7f183b711d5b9fea20cad24ddc1406e18b`. CI genérico e testes específicos do laboratório **SUCCESS**.

Código localizado apenas nesta branch, **NÃO em `main`**:
- Pasta `experiments/whatsapp-session-bridge/`.
- `package.json`: Node.js >=20, biblioteca comunitária `@whiskeysockets/baileys`, `qrcode`; isolado dos workspaces de produção.
- `src/index.mjs`: socket local apenas `127.0.0.1`; QR em `GET /v1/qr`, estado `GET /health`, eventos recentes em `GET /v1/events`, envio individual em `POST /v1/manual-reply`.
- Segurança: token de administração obrigatório >=32 caracteres, sem valor padrão conhecido, armazenamento de sessão fora do Git, conexão **OFF** por padrão (`BRIDGE_ENABLE_CONNECTION=false`), envio **OFF** por padrão (`BRIDGE_ENABLE_SEND=false`), destinatários de teste em `BRIDGE_SEND_ALLOWLIST`, uma resposta manual por vez com intervalo mínimo.
- `src/format.mjs`: validação de destinatário, texto assinado com nome do atendente.
- `.env.example` com flags sem credenciais; não armazenar sessão no repo.
- `test/format.test.mjs`, workflow `.github/workflows/linked-session-lab.yml` testado com CI SUCCESS.
- **Nunca foi pareado por QR, nunca foi testado recebimento real, e nenhuma mensagem WhatsApp foi enviada por ele.** Nem hospedagem de produção nem proxy autenticado Supabase foram conectados.
- Baileys é **não oficial** e pode quebrar/sofrer restrições. Não existe garantia de que o mesmo número pode manter Baileys e Cloud API simultaneamente sem coexistência corretamente habilitada.
- O chip atual, registrado só na API, **não possui sessão do aplicativo Business** para escanear QR. Não tentar vincular QR antes de resolver elegibilidade e ativação do app.
- Se for prosseguir com Baileys, **testar primeiro em número de laboratório já ativo no aplicativo**, não no número comercial.

### 2.4. Outros marcos históricos
- PR #9: otimizações de inbox.
- PR #10/#14: respostas rápidas, mídia e áudio.
- PR #11/#15: equipe, atribuição, disponibilidade e roteamento — o roteamento automático permanece opt-in (OFF por padrão).
- PR #12: tarefas de follow-up, sem envios automáticos.
- PR #13: relatórios.
- PRs #16, #17, #18: layout, sidebar recolhível e logo **oficial** da Mais Viagens; não substituir por logo inventado.
- PR #20: abas COEX e Suporte no menu com o mesmo `whatsapp_account_id`.
- PR #21: documentação de preparação/migração.

## 3. Arquitetura e fluxos: estado presente x objetivo futuro

### Atual em produção

```text
                    Meta Cloud API / WABA
                       (1 número)
                           |
            +--------------+--------------+
            |                             |
    templates e disparos            webhooks inbound
            |                             |
  Mais Chat / COEX                 Supabase/messages
                                          |
                                   Mais Chat/Suporte
                                          |
                                  resposta via API
                              (regra 24 h permanece)
```

### Objetivo real, ainda NÃO alcançado

```text
                     1 NÚMERO COMERCIAL
                           |
            +--------------+--------------------+
            |                                   |
      META CLOUD API                 WhatsApp Business APP
     templates/campanhas             / dispositivo vinculado
            |                                   |
     COEX no Mais Chat            atendimento manual fora da
                                   janela da API (se suportado)
            |                                   |
            +---------------+-------------------+
                            |
                    Histórico compartilhado
                  + membros / atribuições
                  + dedup / ecos / auditoria
                            |
                   MAIS CHAT / SUPORTE
```

- **COEX oficial da Meta:** parte tipicamente do WhatsApp Business App com onboarding específico para usar a API no mesmo número. Um número originalmente dedicado à Cloud API **não pode ser presumido elegível** para conversão direta; verificar documentação e obter confirmação Meta/BSP sobre migração e eventual retorno à API.
- **Bridge não oficial tipo WhatsApp Web:** pode espelhar sessão do aplicativo pelo protocolo vinculado, mas é hipótese do comportamento antigo do FlowChat. QR Code no FlowChat **não foi comprovado**; site mencionava conexão QR, sem confirmar internamente COEX+Suporte no mesmo número.
- **Não tratar envio pelo WhatsApp Business App como uma porta dos fundos dentro da Cloud API**: nenhuma alteração de UI no Mais Chat permite mensagens livres da Cloud API fora das 24 h.
- Antes de implementar eventos do aplicativo, entender formatos `smb_message_echoes`, histórico e mapeamento de conta/contato, sem classificar como INBOUND nem disparar IA em resposta a um OUTBOUND.

## 4. Preferências do usuário e limites de risco

1. Quer implementação direta pelo assistente; evitar longos tutoriais de edição manual.
2. Usar GitHub + PR + testes + Vercel, validar deploy final antes de afirmar que está ativo. Backend Supabase precisa de deploy separadamente.
3. **NÃO enviar qualquer WhatsApp, template, campanha, follow-up ou automação sem autorização explícita.**
4. Não reprocessar mensagens antigas, não criar envios automáticos ocultos, não reativar IA ou campanhas do LeadOps acidentalmente.
5. Não alterar/migrar/desregistrar o número da Meta ainda. O usuário disse que **aceita interrupção planejada em tese**, mas nenhuma data, plano de rollback ou go-live foi aprovado.
6. Não confundir **um número** com duas contas reais; canais COEX/Suporte da UI podem ser representações da mesma conta.
7. Identidade comercial: Mais Viagens, logo oficial no componente `apps/web/components/brand-logo.tsx`.
8. Nomes dos agentes devem ser do membro autenticado, não campo livre de um cliente; não inserir assinatura em templates de massa ou mensagens já enviadas sem especificação.
9. Proteger tokens, PINs, QR Codes, diretórios de sessão e dados de clientes; não incorporar segredos em docs, commits, mensagens ou logs.
10. O usuário aceita experimentar Baileys apesar do risco, mas a viabilidade **técnica e simultaneidade com a API** continuam sem validação.

## 5. Backlog prioritário (ações para continuar AGORA)

### Fase A — Reconhecimento e segurança, sem interromper operação
- [ ] Ler `CLAUDE.md`, este documento, `docs/COEX_MIGRATION_READINESS.md`, PRs #19/#22 e confirmar HEAD de `main`.
- [ ] Obter acesso **ao Supabase correto `yqtplpmlvhzgkmbuoimk`**; não substituir pelo projeto conectado `hylycnzcnkwlqjwpuycc`.
- [ ] Auditar somente leitura: conta WABA, `phone_number_id`, webhook subscrito, templates aprovados, limitações de sessão, filas pendentes, backup de tabelas e Edge Functions; não buscar nem divulgar tokens em claro.
- [ ] Descobrir caminho tecnicamente válido de **API-only → WhatsApp Business App → Coexistence** via documentos oficiais Meta ou parceiro compatível; obter confirmação de elegibilidade (ou reconhecer formalmente que ainda não há caminho confiável).
- [ ] Conferir se a alternativa Baileys simultânea com API depende do mesmo COEX, e qual fluxo de vinculação se aplica, sem testar no número principal.

### Fase B — Desenvolver o Suporte em paralelo, sem risco
- [ ] Revisar PR #19 e preparar implantação coordenada de autoria/assinaturas quando Supabase estiver autorizado. Não publicar a API parcialmente.
- [ ] Revisar PR #22 para hardening de dependências, persistência segura, validação de vínculo, proteção contra event loop/reconexões, logs mascarados e testes em aparelho **de laboratório**.
- [ ] Definir modelo de `source_transport`/autoria no histórico (`cloud_api` vs `business_app` vs `linked_session`), com dedup por `whatsapp_message_id`, respeitando RLS/tenant.
- [ ] Planejar bridge privado **server-to-server**, sem token de Baileys no frontend, com Supabase Auth, confirmação de role e vínculo de atendente da organização. Não expor porta localhost na internet diretamente.
- [ ] Prototipar UI real de Suporte com métricas/presença e identificação interna, mas sem afirmar fora de janela antes de enviar por sessão autorizada.
- [ ] Preparar `smb_message_echoes` e eventuais eventos de sincronização no webhook oficial, sem misturar tipos de mensagens.

### Fase C — Planejar eventual migração do número principal (somente após aprovação específica)
- [ ] Fazer snapshot/backup e inventário de dados; verificar retomada e retenção dos templates/histórico.
- [ ] Documentar janela de indisponibilidade realista (pode durar dias), responsável Meta/BSP, suporte, rollback, número de contingência e critérios de desistência.
- [ ] Aprovação explícita do usuário para **executar** migração/desregistro, informando risco de não conseguir Cloud API + app coexistentes no mesmo número.
- [ ] Somente então iniciar procedimentos oficiais, validar o aplicativo real e testes de QR, se elegível.
- [ ] Na produção: realizar teste manual autorizado, com cliente/contato de teste, confirmar resposta fora de janela no app, histórico do Mais Chat e não duplicação.

## 6. Critérios de aceitação para dizer “igual ao FlowChat”

1. Campanha de template pela Meta vai pelo **mesmo número** e só dispara após confirmação do operador.
2. Resposta do destinatário aparece corretamente em Suporte, sem perda e sem duplicar a conversa.
3. Atendentes múltiplos autenticam com identidade própria e têm atribuição, transferência e auditoria.
4. Fora da janela de 24h da API, uma mensagem individual é enviada por **sessão verdadeira do aplicativo Business ou dispositivo vinculado compatível**, se tecnicamente permitida; **não** por endpoint Cloud API indevidamente.
5. Mensagem entregue ao cliente inclui nome correto do atendente (ou assinatura manual do app, conforme canal e capacidade).
6. Histórico dos envios/recebimentos de API e aplicativo é coerente (deduplicação por ID, origem correta) e suporta reconexão.
7. O número continua podendo disparar templates na Cloud API depois da ativação (deve ser demonstrado, não assumido).
8. Disponibilidade, reconexão, backups e contenção de riscos de bloqueio documentados.
9. Logs e dados protegidos (segredos só no servidor; LGPD; acesso por organização).
10. Status operacional real testado. **Build READY ou CI green isolados não validam integração WhatsApp.**

## 7. Prompt de início para Claude (cole no chat do Claude)

> Estou transferindo para você o desenvolvimento do **Mais Chat**. Clone/abra `https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-` e leia integralmente `CLAUDE.md` e `docs/HANDOFF_CLAUDE_2026-10-19.md`. Preserve todas as regras de segurança. Quero reproduzir o comportamento do FlowChat usando **o mesmo número**: COEX disparando templates pela Cloud API e Suporte ligado a uma **sessão real do WhatsApp Business** para respostas fora da janela de 24 horas, com multiatendentes e nomes visíveis ao cliente. Não aceite apenas replicar visualmente o WhatsApp Web ou duplicar registros de número. Confirme o estado exato do `main`, os PRs #19 e #22 e qual Supabase está conectado. Comece por uma auditoria somente leitura e apresente o próximo passo técnico viável para provar a conexão real sem mexer no número comercial; depois implemente diretamente no código as partes seguras, validando PR/CI/deploy. **Não envie mensagens nem desregistre o número sem meu consentimento específico.**

## 8. Fontes e apontadores

- [Repositório](https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-)
- [Mais Chat](https://whats-bs-manager.vercel.app/)
- [Migração COEX/rollback](COEX_MIGRATION_READINESS.md)
- [PR #19: identificação/assinatura agente](https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-/pull/19)
- [PR #20: menu COEX/Suporte, merged](https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-/pull/20)
- [PR #21: plano de migração, merged](https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-/pull/21)
- [PR #22: Baileys experimental, draft](https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-/pull/22)
- [Baileys (NÃO oficial)](https://github.com/WhiskeySockets/Baileys)
- [360dialog Coexistence](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence)
- [360dialog onboarding](https://docs.360dialog.com/docs/hub/embedded-signup/coexistence-onboarding)
- [Meta WhatsApp Cloud API — registration](https://www.postman.com/meta/whatsapp-business-platform/folder/zuoeksl/registration)

### Conclusão
O código para um experimento de sessão vinculada existe em PR #22; o plano de migração está em `main`; o app funciona atualmente na Cloud API, mas **a coexistência real WhatsApp Business + API no número atual NÃO foi testada nem ativada**. Essa é a fronteira exata do projeto na transferência.

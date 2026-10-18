# Laboratório experimental — WhatsApp Business vinculado (NÃO OFICIAL)

Esta pasta é independente do monorepo de produção e **não é incluída nos workspaces do `package.json` raiz**. Nenhuma conexão, envio, alteração de banco ou desregistro de número acontece ao abrir/mergir estes arquivos.

## Objetivo

Testar uma sessão de dispositivo vinculado em WhatsApp Business por meio da biblioteca comunitária Baileys, como hipótese de implementação da antiga aba **Suporte** do FlowChat. Se a prova funcionar em um número apto, estudaremos depois uma integração segura com o Mais Chat para compartilhar histórico, atribuição e identificação de atendentes.

**Este recurso não é o COEX oficial da Meta.** Não há garantia de coexistência simultânea de uma sessão vinculada e Cloud API no mesmo número. O conector não altera o comportamento ou as permissões da Cloud API.

**IMPEDIMENTO ATUAL:** o número principal do Mais Chat foi registrado diretamente na Cloud API e não tem uma conta WhatsApp Business ativa no aplicativo. Não existe um celular principal conectado para escanear o QR. Logo, o código **não consegue vincular esse número no estado atual**. Ativar o WhatsApp Business no celular pode exigir retirar o número da Cloud API, com interrupção e riscos de nova elegibilidade. Não faça isso sem decisão operacional específica.

## Segurança por padrão

- O serviço só escuta em `127.0.0.1`; não expor diretamente na internet ou conectar ao navegador público.
- Exige `BRIDGE_ADMIN_TOKEN` de pelo menos 32 caracteres, passado via cabeçalho `x-bridge-token` para endpoints sensíveis.
- Conexão desabilitada por padrão (`BRIDGE_ENABLE_CONNECTION=false`).
- Envio desabilitado por padrão (`BRIDGE_ENABLE_SEND=false`).
- Quando habilitado manualmente para testes, envio só para uma **allowlist** explícita de números, um destinatário por requisição, uma mensagem por vez, com intervalo mínimo de 3 segundos.
- Não possui qualquer endpoint de campanhas, templates, disparo em massa, recuperação automática ou follow-up.
- O nome do atendente aparece no texto enviado em formato `Israel Hespanhol:\nOlá!`, mas ainda não existe integração de identidade do Supabase. O agente é indicado pelo operador autenticado com o token local.
- Somente os últimos 100 eventos `notify` ficam na RAM do processo (não são gravados em disco); os arquivos de autenticação da sessão são persistidos separadamente em diretório privado. Não colocar essa pasta dentro do Git.
- Conexão via WhatsApp Web **não oficial** pode quebrar, conflitar com versões do app ou gerar restrições/bloqueios. Não usar em produção sem análise jurídica, de segurança, consentimento de clientes e contingência.

## Execução somente no laboratório

Requer Node.js 20+. Testar antes com **número de laboratório já ativo no WhatsApp Business no celular**, sem Cloud API ativa.

```bash
cd experiments/whatsapp-session-bridge
npm install
npm run check
npm test
cp .env.example .env
```

Os valores de `.env` são exemplos. O serviço Node **não carrega o arquivo automaticamente**; injete as variáveis de forma privada com um gerenciador de segredos ou um processo local. Não compartilhe token, QR, sessão ou credenciais nos chats.

Para testar a leitura do estado (sem conexão), defina um token aleatório longo e execute `npm start`. Por padrão, `GET http://127.0.0.1:8787/health` retorna `state: disabled`.

Para autorizar o **pareamento experimental** em um número de laboratório, definir `BRIDGE_ENABLE_CONNECTION=true` antes de iniciar. O endpoint local `GET /v1/qr`, autenticado com `x-bridge-token`, retorna SVG do QR, que deve ser lido em um **WhatsApp Business já ativo em um celular**.

`GET /v1/events` (autenticado) retorna apenas as últimas mensagens individuais recebidas em memória, para validar a conexão. Não disponibilizar ao frontend até existir um proxy autenticado com isolamento de organização e auditoria.

`POST /v1/manual-reply` (autenticado) só funciona se `BRIDGE_ENABLE_SEND=true` e `BRIDGE_SEND_ALLOWLIST` tiver números de teste explicitamente permitidos. Exemplo de corpo:

```json
{"intent":"manual_reply","to":"5548999998888","agent":"Israel Hespanhol","text":"Olá, testando atendimento."}
```

É **uma ação individual manual de laboratório**, nunca um agendador. Para atendimento real multiusuário, ainda precisaremos de proxy server-to-server com autenticação Supabase, controle por organização, vínculo de atendente real, histórico persistido, deduplicação e tratamento de anexos.

## Critérios de avanço

1. Confirmar como reativar o WhatsApp Business para o número principal **sem perder irreversivelmente a possibilidade de usar a Cloud API**, com Meta/parceiro oficial.
2. Não usar o número principal enquanto o primeiro teste não passar em número de laboratório.
3. Validar envio/recebimento com um número de teste voluntário e obter logs sem dados pessoais em claro.
4. Validar desconexão, revogação do vínculo, reinício, autenticação e bloqueio de requisições não autorizadas.
5. Somente então desenvolver proxy privado Mais Chat ↔ bridge e inclusão de eventos `OUTBOUND` no banco.
6. Depois de uma confirmação específica do responsável, programar eventual intervenção no número principal com backup, rollback e janela de indisponibilidade.

## Referências

- [WhatsApp Business — vincular dispositivos oficiais](https://faq.whatsapp.com/878854700132604/?cms_platform=android)
- [Baileys — implementação comunitária não oficial](https://github.com/WhiskeySockets/Baileys)
- [Registro/desregistro Cloud API](https://www.postman.com/meta/whatsapp-business-platform/folder/zuoeksl/registration)
- [Plano de migração COEX no Mais Chat](../../docs/COEX_MIGRATION_READINESS.md)

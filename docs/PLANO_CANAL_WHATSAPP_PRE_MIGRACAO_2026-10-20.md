# Pré-migração urgente — Canal do WhatsApp com o número comercial
**20/10/2026 — estado: BLOQUEADO PARA EXECUÇÃO.**
**Objetivo:** priorizar a criação de um Canal da Mais Viagens no WhatsApp Business **usando o mesmo chip que hoje está na Cloud API**; tentar posteriormente coexistência COEX para campanhas via API e atendimento humano via Business App.

> Este documento autoriza apenas diagnóstico e preparação. NÃO autoriza desregistrar, excluir número/WABA, disparar campanhas, limpar dados, trocar credenciais, desligar webhooks ou recriar a conta. É necessária aprovação explícita final, depois que os backups e elegibilidade forem auditados.

## Resultado da auditoria de 20/10/2026

| Item | Situação e evidência |
|---|---|
| Código e configuração versionada (não inclui secrets) | **Ponto de restauração criado**: branch `backup/pre-canal-migration-20261020`, commit imutável referenciado `ad12164baa7e48e61f921df2e34c380660b76f14`. |
| Deploy | Vercel projeto `prj_CGfv1NPkwQcSk74yoYPvxpS6GzBP`: produção no mesmo SHA, estado READY em 20/10. |
| Banco de dados | **BACKUP NÃO CONCLUÍDO**: acesso ao projeto correto `yqtplpmlvhzgkmbuoimk` falhou com `MCP -32600 permission denied`. Não foi possível ver tabelas reais, confirmar backup, exportar nem testar restauração. |
| Edge Functions/segredos | Não auditados em runtime; funções versionadas `supabase/functions/whatsapp-send/index.ts`, `supabase/functions/whatsapp-webhook/index.ts` e outras. Não expor tokens, secrets, PIN 2FA em arquivos ou chats. |
| Número Meta/WABA | **NÃO AUDITADO AO VIVO**: sem acesso direto ao painel Meta do titular. Precisamos verificar número/ID/WABA, restrições, templates e envios pendentes antes de remover. |
| WhatsApp Business App | Usuário informou possuir chip e celular; conta atual nunca esteve ativa no WhatsApp Business App, tendo sido registrada diretamente na Cloud API. |
| Canal | A Central de Ajuda do WhatsApp confirma a criação de canais no WhatsApp Business App, onde o recurso está disponível. Não testado com esta conta. |
| COEX | **NÃO ATIVO/NÃO GARANTIDO** para número que começou exclusivamente na Cloud API. A documentação de um parceiro oficial descreve onboarding iniciado por WhatsApp Business App ativo, e avisa que o caminho inverso não funciona no fluxo direto. |
| PR #19 assinatura atendente | DRAFT, não merged, Edge `whatsapp-send` não implantada em coordenação. |
| PR #22 sessão experimental Baileys | DRAFT, não merged, sem sessão vinculada; não usar no número comercial neste procedimento. |

## Fase 1 — verificações obrigatórias ANTES de qualquer desregistro

- [x] Criar referência separada ao código do `main` no GitHub: `backup/pre-canal-migration-20261020`.
- [x] Identificar o projeto Vercel de produção e o commit.
- [ ] **BACKUP DO BANCO:** reconectar/autorizar o Supabase **correto** `yqtplpmlvhzgkmbuoimk`. Conferir em **Database → Backups** existência, data, integridade e prazo de retenção. Se possível, executar também `pg_dump` ou `supabase db dump` para cópia externa criptografada, verificar tamanho e estrutura, testar restauração em ambiente separado. Uma cópia da branch GitHub **não é backup do banco**.
- [ ] **Storage:** verificar buckets e objetos relevantes: backup de banco do Supabase cobre metadados, mas NÃO cobre o conteúdo dos arquivos do Storage. Exportar objetos necessários por canal seguro, com retenção LGPD.
- [ ] **Operação atual:** confirmar listas de conversas/contatos, mensagens, templates aprovados, status de campanhas/lotes (`SENDING`, agendamentos) e integrações que dependem do número. Pausar somente após confirmação específica para a janela real.
- [ ] **Meta:** usuário precisa abrir Business Manager → Contas do WhatsApp → Gerenciador do WhatsApp → Números de telefone, e verificar número correto, `phone_number_id`, `WABA-ID`, status, qualidade, limites, 2FA, vínculo de propriedade, e eventuais restrições à remoção; gravar inventário **sem tokens/PIN**.
- [ ] **Procedimento aplicável:** confirmar, preferivelmente com suporte Meta/BSP e antes do corte, o passo exato de desligar Cloud API e liberar o número para o aplicativo, distinguindo `/deregister` da exclusão/remoção do número da WABA. Procedimentos variam conforme tipo de conta e mensagens pagas recentes; **não excluir WABA inteira**.
- [ ] **Retorno/rollback:** documentar e verificar credenciais administrativas, permissões, requisitos de verificação por SMS/ligação e 2FA; avaliar se o número pode retornar à Cloud API dedicada caso COEX falhe. A documentação Meta indica recadastro possível, mas isso NÃO equivale a garantia de COEX.
- [ ] **COEX:** procurar validação escrita da elegibilidade de conta nova app/antiga API, eventual exigência de maturidade do número no Business App e parceiro capaz de fornecer Embedded Signup; considerar interrupção prolongada de campanhas.
- [ ] **Alinhamento operacional:** informar responsáveis sobre inatividade da API, preparar canal alternativo de atendimento, confirmar que o chip recebe SMS/ligação e instalação do WhatsApp Business no telefone.

## Fase 2 — janela planejada SOMENTE depois do go/no-go

1. Registrar data/hora, responsável operacional, canal de contingência e evidências de backup concluído e testado. Confirmar que nenhum lote disparará durante a operação.
2. Obter **autorização explícita final do usuário** para o procedimento específico de desregistro/remoção (se aplicável) e para a janela de interrupção. Aceitação genérica de risco **não** é autorização para agir.
3. Executar **apenas o procedimento preciso que foi verificado** para o número e WABA identificados. Não usar rotas de exclusão irreversíveis sem compreender consequências.
4. Confirmar pelo painel Meta que o número saiu da Cloud API, registrar resultado e hora. Neste ponto, os disparos/atendimento API param.
5. No celular com o chip, ativar o **WhatsApp Business App** e verificar SMS/ligação. **O histórico de mensagens que estava no Supabase não migra automaticamente ao aplicativo.**
6. Se a função estiver disponível para a conta, no app usar **Atualizações → Canais → + → Criar canal**, definir logo/nome/descrição da Mais Viagens, configurar administradores e obter link; validar publicando apenas uma atualização de teste aprovada. O Canal é unidirecional; seguidores não iniciam conversas por essa publicação.
7. Preservar o Business App ativo e iniciar verificação da elegibilidade COEX junto a parceiro oficial. **Não prometer prazo de sete dias como garantia de aprovação.**
8. Se COEX for aprovado, fazer Embedded Signup compatível, recuperar/atualizar integrações e adaptar `whatsapp-webhook` para `smb_message_echoes` como `OUTBOUND`; não atualizar janela de 24h pela mensagem do app.
9. Testar o mesmo número: envio template pela API (apenas teste autorizado), resposta no app, ecos no Mais Chat e preservação do Canal. Se COEX não for aprovado, manter operação alternativa até decisão sobre retorno à Cloud API dedicada.

## Plano de contingência

- **Falha antes do desregistro:** interromper operação sem mudanças; manter a API como está.
- **Falha para ativar WhatsApp Business:** preservar capturas do erro e confirmar com suporte Meta antes de remover novos ativos. Possibilidade de recadastro na Cloud API dedicada requer permissões, verificação e eventual novo registro — **não é instantânea nem garantida**.
- **Canal não disponível no WhatsApp Business:** NÃO insistir removendo mais ativos; verificar disponibilidade da funcionalidade nessa conta/região e decidir alternativa antes de outras mudanças.
- **COEX recusado:** API pode permanecer desativada por tempo indeterminado; obter decisão de continuar no app ou voltar à API dedicada.
- **Nunca tratar backup de código como proteção de dados WhatsApp/Meta ou DB.** Logs, metadados de campanha e mensagens do Supabase exigem backup próprio.

## Referências oficiais e de provedor

- [Meta — API Cloud: register/deregister](https://www.postman.com/meta/whatsapp-business-platform/folder/zuoeksl/registration)
- [Meta — deregister endpoint](https://www.postman.com/meta/whatsapp-business-platform/request/u5q4lqs/deregister-phone)
- [WhatsApp — canais no Business App](https://faq.whatsapp.com/809740894165112)
- [WhatsApp — criar canal](https://faq.whatsapp.com/794229125227200/?cms_platform=web&locale=pt_BR)
- [360dialog — coexistência e elegibilidade](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence)
- [Supabase — Database Backups](https://supabase.com/docs/guides/platform/backups)

## Próxima ação concreta
**Pedir ao usuário para conectar o projeto Supabase correto e verificar o backup em Database > Backups.** Pedir captura do status do número em WhatsApp Manager, sem expor códigos, tokens, PINs ou dados de clientes. Só após auditoria completa apresentar uma confirmação final para realizar desregistro.

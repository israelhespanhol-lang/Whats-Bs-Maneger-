# Plano de migração para WhatsApp Business + Cloud API (COEX)

**Estado: planejamento; operação atual INALTERADA. Nenhum envio, desregistro ou migração foi autorizado para execução neste documento.**

## Objetivo e limitação funcional

- Um único número comercial, com campanhas de templates pela Cloud API e respostas humanas pelo aplicativo **WhatsApp Business** (ou dispositivos vinculados oficialmente suportados).
- O Mais Chat continua sendo o painel de campanhas e supervisão; recebe mensagens dos clientes e deve armazenar os eventos `smb_message_echoes` enviados pelo aplicativo após uma eventual ativação.
- **Não confundir coexistência com um WhatsApp Web embutido no Mais Chat.** As mensagens de atendimento enviadas *pela Cloud API* continuam limitadas à janela de 24 horas ou exigem templates quando ela está fechada. O atendimento manual fora da janela deve ser realizado no aplicativo oficial/cliente vinculado suportado.
- A conta atual foi cadastrada diretamente na Cloud API, nunca no aplicativo WhatsApp Business. **O fluxo padrão de COEX não aceita a conversão direta API → COEX.** Qualquer estratégia de retorno ao aplicativo e nova entrada no COEX deve ter viabilidade confirmada previamente pela Meta ou parceiro oficial, por escrito.

## Auditoria somente leitura (código do repositório)

- [x] A conta comercial do projeto é representada por `whatsapp_accounts`, com `phone_number_id`, `business_account_id`, telefone comercial, nome verificado e status.
- [x] O envio manual passa pela Edge Function `whatsapp-send`; verifica janela de atendimento e associa o número real de destino à conta da conversa.
- [x] Disparos de templates estão separados do Suporte e requerem confirmação manual do operador.
- [x] Webhook `whatsapp-webhook` usa `metadata.phone_number_id` para localizar a conta e registrar mensagens recebidas.
- [ ] O webhook ainda precisa tratar `smb_message_echoes` como **OUTBOUND**, com deduplicação pelo ID da mensagem, **sem** atualizar a janela de 24 horas.
- [ ] Confirmar assinatura e suporte aos eventos `history`, `smb_app_state_sync`, `smb_message_echoes` e `account_update` no fluxo do provedor.
- [ ] Acesso ao Supabase para consultar e efetuar backup/validação: conector sem permissão nesta auditoria.
- [ ] Inventariar WABA, phone number ID, status, limite de disparo, cobrança, nome aprovado, assinaturas de webhook e templates; NÃO registrar tokens ou PIN em texto.
- [ ] Verificar que o chip recebe SMS e chamadas, que há acesso administrador ao Business Portfolio e que o WhatsApp Business poderá ser ativado no aparelho.

## Portões obrigatórios antes de qualquer interrupção

1. **Aceite de experiência:** responsável confirma que responder fora da janela será pelo WhatsApp Business oficial (ou dispositivo vinculado suportado), não pelo composer Cloud API do Mais Chat.
2. **Elegibilidade confirmada:** obter do suporte Meta/BSP procedimento aplicável a um número *originalmente registrado direto na Cloud API*; confirmar se será possível entrar depois no COEX, qual conta WABA utilizar e se haverá perda de configurações/templates.
3. **Prazo comunicado:** uso ativo do aplicativo pode exigir no mínimo 7 dias e o período sem campanhas/API pode ser prolongado; não assumir migração de poucas horas.
4. **Backup:** exportar contatos, conversas, mensagens, campanhas, templates, configurações necessárias e inventário de webhooks; garantir restauração e regras LGPD.
5. **Rollback documentado:** validar procedimento e credenciais para re-registrar a Cloud API com o mesmo número se a etapa de Business App/COEX falhar. O retorno **não** é automaticamente garantido.
6. **Janela aprovada:** data/horário, responsáveis, contatos de contingência, confirmação de não haver lotes enviando, comunicação interna e plano de atendimento alternativo.
7. **Go/no-go:** autorização explícita **para aquela execução**, após checagem dos seis itens acima.

## Execução futura (NÃO executar durante a preparação)

- Congelar envios iniciados e registrar o estado de lotes em andamento.
- Capturar backup consistente, contagens e parâmetros sem exportar credenciais sensíveis.
- Usar apenas procedimento formalmente confirmado para desregistro/transição do número. Não rodar `/{phone_number_id}/deregister` sem go/no-go.
- Ativar o WhatsApp Business App e validar mensagens reais de entrada/saída no app (sem automações ou disparos de teste).
- Após elegibilidade, executar Embedded Signup de COEX por parceiro oficial compatível e autorizar sincronização.
- Atualizar o Mais Chat para receber `smb_message_echoes` como mensagens de saída e impedir respostas duplicadas pela IA.
- Validar o mesmo número em COEX e Suporte; confirmar templates via API, respostas fora da janela **no aplicativo**, eco no painel, anexos, atribuições e consistência de histórico.
- Se falhar, seguir plano de contingência/rollback aprovado, sem apagar dados históricos.

## Riscos e dependências não resolvidos

- A documentação do COEX descreve o fluxo **aplicativo → Cloud API**; não promete conversão de um número originado na Cloud API.
- O tempo mínimo de maturação do número no app, a elegibilidade, mudanças de WABA, dispositivos vinculados e transferência de templates dependem do provedor e da Meta.
- Um COEX efetivo não libera a Cloud API para mensagens livres fora de 24 h e não fornece um navegador WhatsApp Web embutível oficialmente no Mais Chat.
- Não usar integração não oficial de WhatsApp Web/QR como solução de produção: risco de bloqueio, perda de eventos e inconsistência de histórico.
- A assinatura do atendente nas mensagens enviadas pela API está em PR separado; o app oficial não insere automaticamente o nome do operador a partir dos logins do Mais Chat.

## Referências

- Meta, registro/desregistro da Cloud API: https://www.postman.com/meta/whatsapp-business-platform/folder/zuoeksl/registration
- 360dialog, elegibilidade e limites da coexistência: https://docs.360dialog.com/docs/resources/phone-numbers/coexistence
- 360dialog, onboarding e requisitos: https://docs.360dialog.com/docs/hub/embedded-signup/coexistence-onboarding
- 360dialog, migração entre WABAs (diferente de COEX): https://docs.360dialog.com/docs/hub/migrations

**Revisão:** 18/10/2026. Este é um checklist operacional de preparação, não confirmação de elegibilidade do número.

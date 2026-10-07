# Arquitetura inicial

## Fluxo de mensagens

1. A Meta entrega eventos do WhatsApp para `POST /webhooks/whatsapp`.
2. A API valida a assinatura/origem do evento.
3. A mensagem é normalizada e persistida.
4. O dashboard recebe a atualização em tempo real.
5. Uma resposta humana é enviada pela API oficial do WhatsApp.
6. Status como enviado, entregue, lido e falha atualizam a mensagem original.

## Módulos previstos

- Inbox multiatendente
- Contatos e etiquetas
- CRM e histórico
- Templates oficiais
- Campanhas e lotes
- Auditoria
- Usuários, equipes e permissões
- Integração futura com LeadOps/IA

## Segurança de campanhas

O sistema deverá operar com princípio de autorização explícita:

- importar um contato nunca dispara mensagem;
- criar uma campanha nunca dispara mensagem;
- agendar uma campanha deve mostrar destinatários, template e horário;
- envio em lote exige confirmação humana;
- toda autorização deve gerar registro de auditoria;
- deve existir pausa/cancelamento da fila;
- IA não pode autorizar campanhas.

## Separação futura SaaS

Toda entidade persistida deverá poder ser associada a uma organização (`tenant`) para que várias empresas usem o sistema sem compartilhar dados.

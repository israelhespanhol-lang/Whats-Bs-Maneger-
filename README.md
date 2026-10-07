# Whats BS Manager

Plataforma própria para gerenciamento de WhatsApp Business, multiatendimento, contatos, campanhas e futura integração com IA/LeadOps.

## Objetivo do MVP

O primeiro marco do projeto é permitir:

- conectar um número pela WhatsApp Business Platform;
- receber mensagens por webhook;
- visualizar conversas em uma caixa de entrada;
- responder mensagens pelo painel;
- armazenar contatos e histórico;
- acompanhar status de envio;
- manter qualquer disparo em massa sob confirmação humana explícita.

## Arquitetura inicial

```text
WhatsApp Business Platform
          |
          v
       API/Webhook
          |
   +------+------+
   |             |
PostgreSQL     Worker
   |             |
   +------v------+
        Web App
```

## Estrutura

```text
apps/
  web/        Dashboard
  api/        API e webhooks

packages/
  shared/     Tipos e contratos compartilhados

docs/
  architecture.md

docker-compose.yml
.env.example
```

## Stack inicial

- Next.js + TypeScript
- Node.js + TypeScript
- PostgreSQL
- WhatsApp Business Cloud API
- Docker Compose para desenvolvimento local

## Regra de segurança

Nenhuma campanha ou disparo em massa deve iniciar automaticamente. Toda ação de envio em lote deverá exigir confirmação explícita do usuário e gerar registro de auditoria.

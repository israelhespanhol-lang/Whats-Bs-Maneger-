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
- Fastify
- PostgreSQL
- WhatsApp Business Cloud API
- Docker Compose para desenvolvimento local

## Rodando localmente

Pré-requisitos: Node.js, npm e Docker.

```bash
git clone https://github.com/israelhespanhol-lang/Whats-Bs-Maneger-.git
cd Whats-Bs-Maneger-
npm install
cp .env.example .env
docker compose up -d
```

Em terminais separados:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Depois:

- Dashboard: http://localhost:3000
- API: http://localhost:4000
- Health check: http://localhost:4000/health
- Webhook da Meta: http://localhost:4000/webhooks/whatsapp

## Configuração futura da Meta

Preencher no arquivo `.env`:

```env
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
```

Nunca envie o arquivo `.env` ao GitHub.

## Estado atual

Já existe:

- estrutura monorepo;
- dashboard inicial da caixa de entrada;
- painel de contato;
- indicador de janela de 24h;
- API Fastify;
- endpoint de health check;
- endpoint inicial para webhook da Meta;
- PostgreSQL para desenvolvimento;
- tipos compartilhados;
- documentação da arquitetura.

Próximo marco:

1. modelagem do banco;
2. persistência de contatos, conversas e mensagens;
3. conexão real com WhatsApp Business Cloud API;
4. mensagens em tempo real no dashboard;
5. envio individual pelo painel.

## Regra de segurança

Nenhuma campanha ou disparo em massa deve iniciar automaticamente. Toda ação de envio em lote deverá exigir confirmação explícita do usuário e gerar registro de auditoria.

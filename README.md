# OpenKG AgentUI

A general-purpose application framework for building Agent-based AI applications, powered by the Intellect Agent Harness platform.

## Overview

AgentUI is a general-purpose application framework built on top of the Intellect Agent Harness platform. It consists of:

- **Frontend SPA** (`src/`): React 18 + TypeScript + Vite 7 + shadcn/ui
- **BFF** (`bff/`): Node.js + Hono backend-for-frontend for Harness-specific logic
- **Nginx** (`nginx/`): Reverse proxy serving static assets and routing API calls

## Quick Start

### Prerequisites

- Node.js >= 18.20.4
- npm
- A running Intellect backend (Python API on port 9380)

### Development

```bash
# Install frontend dependencies
npm install

# Install BFF dependencies
cd bff && npm install && cd ..

# Start both frontend and BFF
npm run dev:all
```

The frontend runs on http://localhost:9391, BFF on http://localhost:9390.

Configure the Intellect backend address in `.env.development` (defaults to `localhost:9380`).

### Production Build

```bash
npm run build        # Build frontend
cd bff && npm run build  # Build BFF
```

### Docker

```bash
docker compose up -d
```

This starts agentui + intellect + all dependencies (MySQL, ES, Redis, MinIO).

## Architecture

```
Browser
  ↓
Nginx (port 80)
  ├── / → SPA static files (dist/)
  ├── /api/bff/* → BFF (Node.js :9390)
  ├── /api/v1/admin/* → intellect Python admin (:9381)
  └── /v1/*, /api/* → intellect Python API (:9380)
```

## API Type Generation

Types are generated from the Intellect OpenAPI spec (not committed to git):

```bash
# Ensure intellect backend is running with /api/v1/openapi.json endpoint
npm run gen:api-types
```

Generated types are written to `src/interfaces/generated/api-types.ts`.

## Project Structure

```
agentui/
├── src/              # Frontend SPA source
├── bff/              # Backend-for-Frontend (Hono)
├── nginx/            # Nginx configuration
├── scripts/          # Build/utility scripts
├── docs/             # Architecture docs
├── Dockerfile        # Multi-stage build (frontend + BFF + nginx)
└── docker-compose.yml
```

## Relationship with Intellect

This project was split from the [Intellect](https://github.com/ontoweb/intellect) monorepo. The Intellect backend provides the core RAG capabilities (document parsing, indexing, retrieval, LLM integration). AgentUI provides the frontend UI and Harness-specific BFF logic.

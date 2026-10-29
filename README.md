# AICTE Approval Workflow Automation

Local prototype for the SIH26262 AICTE approval and compliance brief. The workspace includes a React dashboard, Express REST API, in-memory demo workflow, optional PostgreSQL/RabbitMQ integration, and delivery scaffolding.

## Run the preview

Requires Node.js 20 or newer and pnpm 11.25.0.

```powershell
pnpm install
pnpm dev
```

Open the Vite URL printed in the terminal (normally <http://127.0.0.1:5173>). The frontend proxies API calls to Express on port 4173. Without `.env`, the server loads five demo applications and uses temporary in-memory storage; records reset when the server restarts. The role selector and compliance examples are simulations.

To run the durable local service stack, create `.env` from `.env.example`, then run `docker compose up --build`. The stack uses development-only credentials, local PostgreSQL/RabbitMQ, and demo seed records. Open <http://127.0.0.1:4173> after the app health check passes.

## Current API

- `GET /api/health`
- `GET /api/applications?status=Pending%20EVC&region=South&search=college`
- `POST /api/applications`
- `GET /api/applications/{id}`
- `PUT /api/applications/{id}/stage`
- `GET /api/applications/{id}/audit`
- `GET /api/evc/queue`, `POST /api/evc/schedule`
- `GET /api/undertakings`, `POST /api/undertakings`, `PUT /api/undertakings/{id}`
- `GET /api/notifications`

Full starter API description is in [`docs/openapi.yaml`](docs/openapi.yaml). APH routing assumptions are in [`docs/APH-routing.md`](docs/APH-routing.md).

Existing institutes follow Scrutiny → Approved; new institutes follow Scrutiny → Pending EVC → SAC / SHC → Approved, as interpreted from the brief pending team confirmation. Stage actions are `approve`, `reject`, `revert`, and `clarification`; revert, reject, and clarification require comments.

The PostgreSQL workflow repository transactionally stores applications, stage history, audit entries, and outbox events. RabbitMQ publishes workflow events at least once. EVC scheduling and undertaking/evidence data are currently in-memory prototype services; they are not yet persisted to PostgreSQL. No identity provider, production RBAC, private document storage, TLS termination, email/SMS delivery, or production cloud deployment is configured. Demo role selection is not a security boundary. Request throttling is process-local and must be replaced for multi-instance production use.

## Development checks

```powershell
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for collaboration rules. [`CHECKLIST.md`](CHECKLIST.md) records the full executive-summary scope and current completion status. [`reports.md`](reports.md) defines measured coverage percentages and distinguishes project targets from verified results. GitHub Actions runs lint, backend tests, and frontend build on pull requests and main/develop pushes.

# AICTE Approval Workflow Automation

Starter workspace for SIH26262. It includes a responsive dashboard and an Isaac-owned workflow API with PostgreSQL persistence and a RabbitMQ event outbox when those services are configured.

## Run locally

Requires Node.js 20 or newer and pnpm 11.25.0. To run with durable storage and messaging, start the local services first:

```bash
docker compose up -d
Copy-Item .env.example .env
pnpm install
pnpm dev
```

On PowerShell, `Copy-Item .env.example .env` creates the local connection settings. Open <http://127.0.0.1:4173>. The server applies the SQL migration at startup and hosts the JSON API under `/api`.

Compose exposes its PostgreSQL container on host port 5433 so it can coexist with a local PostgreSQL service already using 5432.

To preview only the UI/API without Docker, omit `.env`; the server then falls back to in-memory storage and local events. Those records are lost when the process restarts.

## Workflow API

- `GET /api/health`
- `GET /api/applications?status=Pending%20EVC&region=South&search=college`
- `POST /api/applications` — returns `201 Created`
- `GET /api/applications/{id}`
- `PUT /api/applications/{id}/stage`
- `GET /api/applications/{id}/audit`

Create an application:

```json
{
  "institutionName": "Northstar College of Engineering",
  "region": "North",
  "instituteType": "new"
}
```

`instituteType` is `existing` or `new`. Existing institutes follow Scrutiny → Approved; new institutes follow Scrutiny → Pending EVC → SAC / SHC → Approved. Stage actions are `approve`, `reject`, `revert`, and `clarification`. Revert, reject, and clarification actions require a non-empty `comments` field. `x-actor` supplies a demo actor label until real authentication is integrated.

The PostgreSQL repository stores applications, stage history, and append-only audit records. Stage transitions, audit entries, and event-outbox entries commit in one database transaction. The outbox dispatcher publishes durable messages to the `aicte.workflow.events` RabbitMQ queue and marks them delivered after broker confirmation. Delivery is at least once; downstream consumers should deduplicate by event ID. The in-process event publisher remains available to unit tests.

Local compose credentials (`aicte_local`) are for development only. Replace them before any shared or deployed environment, and do not commit `.env`.

## Checks

```bash
pnpm lint
pnpm test
pnpm test:coverage
```

`CHECKLIST.md` tracks the full executive summary. Checked items describe what this prototype demonstrates; unchecked items are follow-on work, including team confirmation of the APH route rules.

## Existing dashboard prototype

`index.html`, `styles.css`, and `app.js` contain the responsive dashboard foundation with local sample records, filtering, CSV export, and a new-application form. Replacing its mock data with the API is part of the frontend workstream.

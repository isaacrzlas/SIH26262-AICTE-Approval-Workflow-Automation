# AICTE Approval Workflow Automation

Starter workspace for SIH26262. This is an interactive frontend prototype based on the executive summary; it uses local mock data and does not yet connect to authentication, a database, or production services.

## Run locally

Requires Node.js 18 or newer. No package install is required for the preview server.

```bash
npm run dev
```

Open <http://127.0.0.1:4173>.

## What is here

- `index.html`, `styles.css`, `app.js`: responsive dashboard prototype with mock application records, filters, CSV export, a new-application form, and clickable workflow stage transitions.
- `server.js`: small Node.js static preview server.
- `CHECKLIST.md`: implementation checklist covering the complete executive summary. Checked items describe what this prototype already demonstrates; unchecked items are follow-on work.

## Suggested next steps for Isaac

1. Confirm the APH decision paths and application categories with the team.
2. Agree on shared application/stage types and the audit-event shape.
3. Scaffold the React/Vite frontend and Node/Express API, then move the prototype views into components.
4. Implement the application and stage models, routing rules, validation, audit trail, and unit tests.
5. Coordinate API contracts and database requirements with the other workstreams.

The executive summary proposes PostgreSQL, RabbitMQ, object storage, OIDC/RBAC, Docker, Terraform, GitHub Actions, and an 8-week plan. These are documented as targets; this starter does not configure those systems yet.

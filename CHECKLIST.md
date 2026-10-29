# SIH26262 implementation checklist

Source: Executive Summary (1).pdf, pages 1–17. This tracks the full scope in the brief. Checked boxes indicate what the current prototype demonstrates; they do not imply production implementation. EVC schedules remain demo-only in-memory data. Compliance records have in-memory and PostgreSQL adapters, but file bytes are not stored or scanned; the role selector is not authentication or authorization.

## Product goals and prototype outcomes
- [ ] Deliver an end-to-end AICTE approval and compliance platform with workflow routing, role dashboards, EVC scheduling, compliance tracking, document validity monitoring, alerts, and escalations.
- [x] Provide a web dashboard foundation with application pipeline, recent applications, activity feed, and status indicators.
- [x] Demonstrate an application submission, basic workflow advancement, and a visible audit/activity concept with local mock data.
- [x] Demonstrate APH-based routing and basic reminder/alert states with local demo scenarios. Workflow accuracy metrics, timed reminder delivery, and manual-step reduction still need measured evaluation.
- [x] Provide React frontend, Node.js/Express backend, optional PostgreSQL/RabbitMQ integration, Docker Compose, and Terraform/Kubernetes starting scaffolds. Cloud provider and production architecture still need team agreement.
- [ ] Implement security controls: RBAC, TLS, secure document storage, input validation, rate limiting, and NIST-aligned practices. Input validation and process-local rate limiting exist; the remaining controls are not implemented.

## Repository, collaboration, and delivery practices
- [x] Organize `/src/frontend`, `/src/backend`, `/infrastructure`, `/scripts`, `/docs`, `/tests`, `/templates`, and a root README.
- [ ] Maintain `main` for production and `develop` for integration.
- [ ] Use `feature/*`, `bugfix/*`, `release/vX.Y.Z`, `hotfix/*`, and `chore/*` branches; lowercase, hyphenated names, optional issue IDs.
- [ ] Use Conventional Commits (`feat`, `fix`, `docs`, `refactor`, `chore`, etc.) and matching PR titles.
- [ ] Merge feature branches into `develop` via reviewed PRs; require CI checks.
- [x] Configure CI verification for pull requests and `main`/`develop` pushes (lint, tests, frontend build). Staging/production deployment, release/hotfix automation, and feature-push triggers remain unconfigured.
- [x] Add CONTRIBUTING guide, architecture diagram, API specification, issue templates, PR template, coding standards, and CODEOWNERS.
- [ ] Require two different approvals for `main`; add extra review for security-sensitive changes.
- [ ] Create six coordinated workstreams: Isaac (workflow/backend), Jerusha (dashboard/UX), Aaron (compliance), Joshua (database/EVC), Simardeep (messaging/infrastructure), Niya (integration/testing/docs).

## Part 1 — Isaac: workflow engine and core backend
- [x] Build Node.js/Express REST API for application submissions, stage completion, approval, rejection, clarification, and reversion.
- [x] Define Application and stage-history models with timestamps and actor fields; provide PostgreSQL and in-memory test/dev repositories.
- [x] Implement `POST /api/applications`, `GET /api/applications/{id}`, and `PUT /api/applications/{id}/stage`; creation returns 201. Also expose list filters and `GET /api/applications/{id}/audit`.
- [x] Encode the brief's prototype routes: existing institute Scrutiny → Approved; new institute Scrutiny → Pending EVC → SAC / SHC → Approved.
- [x] Advance stages automatically; support reviewer rejection, reversion, and “return for clarification.”
- [x] Require and retain a non-empty comment for reversions. Reverts reopen the prior workflow stage.
- [x] Record an audit entry on submission and every state transition; persist stage-completion events in a transactional outbox and publish through RabbitMQ when configured.
- [x] Validate institution, region, institute type, action, and route/stage transitions; malformed JSON and oversized payloads receive client errors.
- [x] Unit test default stage, scrutiny-only approval, scrutiny+EVC path, reversion/reopen behavior, clarification, rejection, audit history, and REST status codes.
- [x] Reach the brief's ≥80% code-coverage target for the backend test suite: measured 96.65% backend line coverage, 83.77% branch coverage, and 95.12% function coverage. These are test-coverage ratios, not production or frontend coverage; see [`reports.md`](reports.md).
- [x] Add PostgreSQL schema/repository and environment-based server wiring. Application, stage-history, audit, and outbox writes are transactionally persisted; version checks reject concurrent stale updates.
- [x] Add RabbitMQ durable queue publisher and transactional outbox dispatcher. Broker outages leave events pending for retry after restart; delivery is at least once, so consumers should deduplicate by event ID.
- [x] Document the APH routing assumptions from the brief for team review in `docs/APH-routing.md`.
- [x] Add local PostgreSQL/RabbitMQ configuration in `docker-compose.yml` and `.env.example`; the PostgreSQL host mapping avoids the standard local port.
- [x] Exercise the API, PostgreSQL repository contract, RabbitMQ publisher, outbox retry, EVC scheduling, and compliance evidence endpoints with automated tests (20 passing).
- [ ] Run the full API against live configured PostgreSQL and RabbitMQ services. This workspace currently has no `.env` or connection URLs, and no Docker or RabbitMQ service is available.
- [ ] Record team confirmation of the APH routes before production use. The code currently follows the existing-institute and new-institute paths from the executive summary; decision points are listed in `docs/APH-routing.md`.

## Part 2 — Jerusha: frontend dashboard and UX
- [x] Establish a responsive dashboard visual foundation with status summary, pipeline, application list, activity, and filters.
- [x] Demonstrate local application creation, stage-action affordance, status filtering, search, and CSV report export.
- [x] Convert the prototype into a React single-page app with React Router and reusable components.
- [ ] Implement token-based login/authentication and role-filtered views. The current role selector is only a UI simulation.
- [ ] Build application dashboard filters for status, region, and date; add application detail with stage history, documents, and compliance information. Status/region/search filters and audit history exist; date and full detail/documents view remain.
- [x] Build EVC schedule view for applications awaiting EVC and meeting scheduling (local in-memory demo).
- [x] Build compliance view for due tasks and approaching deadlines (local in-memory demo).
- [ ] Provide stage-level approve/reject/revert actions; integrate APIs with fetch/Axios and handle failures clearly. API actions exist and the React UI advances stages; remaining actions need UI controls.
- [ ] Add WebSocket or polling updates and live alerts.
- [x] Ensure responsive, intuitive UI and accessibility basics (semantic HTML, clear validated forms, status announcements); image alt text is not applicable to the current icon-only UI.
- [ ] Test valid/invalid login, mocked dashboard list, approval API action, EVC schedule confirmation, and deadline alert; add integration/E2E tests (Cypress or equivalent).
- [x] Pass linting and keep UI modular/reusable (verified with `pnpm lint`).

## Part 3 — Aaron: compliance and undertakings
- [x] Add PostgreSQL `undertakings`, `compliance_docs`, and deduplicated `compliance_alerts` tables with application links and due/expiry indexes; keep an in-memory adapter for the local demo.
- [x] Implement `GET/POST /api/applications/{id}/undertakings` and `PUT /api/undertakings/{id}`; retain the existing unscoped read/create routes for UI compatibility.
- [x] Validate date, evidence description, allowed declared MIME type, declared size (10 MB maximum), and future document expiry metadata; valid evidence metadata fulfills the undertaking transactionally. Actual file bytes and document content are not uploaded, verified, or virus-scanned; late evidence is currently allowed.
- [x] Run a daily UTC check; create a three-day undertaking reminder and deduplicate reminders. Missed deadlines become Overdue and create an admin-targeted outbox event and dashboard alert.
- [x] Create 30/15-day document-expiry reminder records and outbox events; show recorded alerts on the dashboard.
- [x] Audit undertaking creation, evidence validation/fulfillment, and missed deadlines in the application audit history.
- [x] Handle strict calendar dates, UTC day boundaries, same-day due dates, and leap years in deadline logic.
- [x] Test reminders and duplicate suppression, evidence validation, overdue audit/escalation, expiry reminders, migration SQL calls, and scheduler event-loop yielding. Unit and repository tests pass; HTTP API tests require local socket access and could not run in this restricted environment.
- [x] Yield between scheduler batches so large queues do not monopolize the event loop; a 250-item scheduler test verifies other event-loop work runs.

## Part 4 — Joshua: database and EVC scheduling
- [ ] Produce normalized (3NF) PostgreSQL schema and ER diagram for applications, institutions, officers, stages, EVC, undertakings, documents, audit, notifications, and roles.
- [ ] Add migrations and seed data; document idempotent migrations and cascading rules.
- [ ] Index status, current stage, application joins, due dates, and document expiry dates.
- [ ] Implement `GET /evc/queue`, `POST /evc/schedule`, and `GET /evc/schedule/{id}`.
- [ ] Queue ready applications requiring EVC; prioritize high-priority/new institutions and assign applications to sessions/teams.
- [ ] Enforce regional daily capacity and prevent committee double-booking with database constraints/concurrency control.
- [ ] Save meeting date/time and assigned committee; publish scheduling alert and calendar invite.
- [ ] Test queue contents, collision rejection, and overdue expiry index usage (EXPLAIN); load-test representative queries.
- [ ] Encrypt or mask sensitive personal IDs and verify common query performance.

## Part 5 — Simardeep: notifications, messaging, and infrastructure
- [ ] Deploy RabbitMQ (or AWS SQS) and a notification service that consumes events and sends email/SMS/Slack alerts.
- [ ] Publish events such as `application.approved`, `application.pending`, and `deadline.upcoming`; support retries.
- [ ] Configure SES/SendGrid or equivalent email and Slack webhook; use test SMTP for demo.
- [ ] Log notification successes/failures; support short-lived password reset tokens in Redis/RabbitMQ if needed.
- [x] Add a multi-stage Dockerfile for the React build and API, with PostgreSQL/RabbitMQ services in Compose and dependencies pinned in the lockfile.
- [ ] Provide local Docker Compose instructions; the service definitions and health check are present but container startup is not verified in this environment.
- [x] Add GitHub Actions for lint, backend tests, and frontend build on PRs and main/develop pushes. Docker image publishing and staging deployment remain.
- [ ] Use GitHub Secrets for credentials; never hardcode keys.
- [ ] Expose `/healthz` and metrics; add container logging/metrics.
- [ ] Configure cloud staging/prod deployment and rollback to last stable container if health checks fail.
- [ ] Test queue-to-email delivery, intentional lint failure blocking CI, and local container health.

## Part 6 — Niya: integration, testing, and documentation
- [ ] Integrate components into one cohesive system and staging environment.
- [ ] Add end-to-end coverage for key workflows and integration scripts in CI.
- [ ] Write deployment guide, OpenAPI/Swagger docs, technical documentation, and user manual. OpenAPI and architecture/setup docs exist; a complete user manual remains.
- [x] Load demo data and prepare repeatable demo scenarios (local seed plus sample compliance items).
- [ ] Verify application lifecycle, EVC, compliance notifications, role access, and audit trail end to end.

## Architecture, data, and API inventory
- [x] React SPA communicates by REST with workflow, EVC, and compliance demo APIs. Authentication is not implemented.
- [ ] PostgreSQL stores core relational data; RabbitMQ decouples backend events from notification consumers; private S3-compatible storage stores documents; Prometheus/Grafana monitor services, database, and broker.
- [ ] Schema includes applications (institution, current stage, status, submitted/updated dates); institutions (name, region, type, established date); officers (name, role, region, email, password hash); stage history (entered/completed/by); undertakings; compliance docs; EVC meetings; audit logs; notifications; roles; officer-role mapping.
- [ ] API inventory: `POST /api/login`; `GET /api/applications` with status/region/page; `POST /api/applications`; `GET /api/applications/{id}`; `PUT /api/applications/{id}/stage`; `GET /api/applications/{id}/audit`; EVC queue/schedule/read; undertaking list/create/update; `GET /api/notifications`. Implemented application, audit, EVC queue/schedule create, undertaking list/create/update, and notifications; login, pagination, and EVC schedule read remain.
- [ ] Protect endpoints with authentication and RBAC; regional officers only access permitted regional data.
- [ ] Stage API returns application ID, previous/new stage, status, and message; audit API returns timestamp, action, and actor.

## Security and privacy
- [ ] Integrate OAuth2/OIDC (or SAML); if no AICTE IdP, use salted password hashes and support 2FA.
- [ ] Enforce least-privilege RBAC for RegionalOfficer, Evaluator, EVCMember, SAC/SHC, admin, and institution users as agreed.
- [ ] Use TLS in transit and encrypt database/storage at rest; encrypt S3-compatible documents and personal data.
- [ ] Keep uploads private, virus-scanned, type/size restricted, and accessible via expiring links.
- [ ] Validate all inputs (including dates and text); use parameterized queries and output escaping. Core workflow, EVC, and undertaking inputs are validated; comprehensive date validation and security review remain.
- [ ] Rate-limit APIs; deploy behind WAF and private VPC; expose only required ports. A process-local API limit is implemented; shared limiting and network controls remain.
- [ ] Audit critical actions including stage changes, compliance submissions, and logins; protect and periodically review audit logs.
- [ ] Update dependencies regularly, run npm audit/security scans, and review flagged vulnerabilities.

## Deployment, observability, and performance
- [ ] Define cloud resources in Terraform (network, compute/ECS/EKS, RDS, buckets, IAM) for repeatable deployment. Terraform scaffold exists; provider and environment decisions are prerequisites for real resources.
- [ ] Isolate development, staging, and production environments; map branch events to appropriate pipelines.
- [ ] Run lint, unit, security, integration checks before merge; deploy versioned containers with health checks and automatic rollback. CI lint/tests/build and local health endpoint exist; security scans, deployment, and rollback remain.
- [ ] Retain database snapshots; configure high availability/multi-AZ database and broker, read replicas where needed, and persistent queues.
- [ ] Performance targets: API p95 under 200 ms; 100 concurrent dashboard analysts; 50 alerts/hour; 99.5% production uptime. The brief separately specifies 99% test uptime; confirm the target distinction. None are measured; see [`reports.md`](reports.md).
- [ ] Instrument request latency, database time, queue depth, job delay, CPU, memory, request rates, pending applications, errors, failed logins, and audit events.
- [ ] Build Grafana dashboards; aggregate logs (ELK or selected equivalent); alert when HTTP 500 errors exceed 5% per minute, queue depth exceeds 100, jobs are missed, or requests are slow. The >5% value is a proposed threshold, not a measured error rate; see [`reports.md`](reports.md).
- [ ] Load-test key flows with k6/JMeter and demonstrate target performance.

## Demo and evaluation scenarios
- [ ] Show a regional officer logging in and seeing only their region's pending applications.
- [x] Submit applications of different types and demonstrate the brief's APH routing assumptions (team confirmation pending).
- [x] Complete scrutiny → EVC → SAC/SHC → Approved; schedule the EVC and show transitions. (Manual demo actions; scheduling is in-memory.)
- [ ] Add undertaking due in three days, run/advance scheduler, and show the reminder in the dashboard and notification service; show overdue escalation too. Scheduler, dashboard alerts, audit, and outbox events are implemented; email delivery still depends on Simardeep's notification consumer.
- [ ] Open audit trail and show actor, timestamp, and every action including approval, reversion, and document upload.
- [ ] Filter applications near deadlines or pending EVC and export a status report.
- [ ] Compare manual spreadsheet/email follow-up with automated workflow effort.
- [ ] Optionally present a multi-user/load-test summary.
- [ ] Measure workflow accuracy, timely alerts, deadline tracking reliability, pending-case visibility, manual-work reduction, and audit completeness.

## Timeline and milestones from the brief
- [ ] Week 1: repo structure, CI/CD, test-environment IaC, architecture, development environment.
- [ ] Weeks 2–4: workflow engine and DB/EVC in parallel; dashboard and compliance begin; minimal API/UI works end to end by week 4.
- [ ] Weeks 5–6: messaging, notification, service integration, EVC alerts, role views, and UI refinement.
- [ ] Weeks 7–8: QA, documentation, demo preparation, fixes, and polish.
- [ ] M1 end of week 4: working prototype; M2 end of week 6: feature complete; M3 end of week 8: demo ready.
- [ ] Track sprint commitments and task completion predictability.

## Success metrics to verify
- [ ] ≥95% APH workflow test-case pass rate (share of agreed APH scenarios passing automatically).
- [ ] 100% on-time simulated deadline alerts (all alerts arrive within one hour of threshold); zero false-positive alerts.
- [ ] API p95 under 200 ms; test uptime target 99% (confirm distinction from the 99.5% production uptime target).
- [ ] Full system setup from code <30 minutes.
- [ ] Quantify administrative effort reduction (example in brief: ten follow-up emails to one alert).
- [ ] No data loss/corruption under simulated service failure; test by stopping a service.
- [ ] ≥80% code coverage enforced in CI. Current backend suite measures 96.65% line coverage, 83.77% branch coverage, and 95.12% function coverage; CI has no coverage gate and these values exclude frontend code. See [`reports.md`](reports.md).
- [ ] All high-priority SIH rubric stories are implemented and demo-ready.

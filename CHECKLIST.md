# SIH26262 implementation checklist

Source: Executive Summary (1).pdf, pages 1–17. This tracks the full scope in the brief. Checked boxes indicate what the current starter prototype demonstrates; they do not imply production implementation.

## Product goals and prototype outcomes
- [ ] Deliver an end-to-end AICTE approval and compliance platform with workflow routing, role dashboards, EVC scheduling, compliance tracking, document validity monitoring, alerts, and escalations.
- [x] Provide a web dashboard foundation with application pipeline, recent applications, activity feed, and status indicators.
- [x] Demonstrate an application submission, basic workflow advancement, and a visible audit/activity concept with local mock data.
- [ ] Demonstrate APH-based routing, reminder timing, workflow accuracy, alert timeliness, and reduction in manual steps using testable scenarios.
- [ ] Use React frontend, Node.js/Express backend, PostgreSQL, RabbitMQ, Docker/Kubernetes, and Terraform as the agreed target architecture.
- [ ] Implement security controls: RBAC, TLS, secure document storage, input validation, rate limiting, and NIST-aligned practices.

## Repository, collaboration, and delivery practices
- [ ] Organize `/src/frontend`, `/src/backend`, `/infrastructure`, `/scripts`, `/docs`, `/tests`, `/templates`, and a root README.
- [ ] Maintain `main` for production and `develop` for integration.
- [ ] Use `feature/*`, `bugfix/*`, `release/vX.Y.Z`, `hotfix/*`, and `chore/*` branches; lowercase, hyphenated names, optional issue IDs.
- [ ] Use Conventional Commits (`feat`, `fix`, `docs`, `refactor`, `chore`, etc.) and matching PR titles.
- [ ] Merge feature branches into `develop` via reviewed PRs; require CI checks.
- [ ] Configure CI: lint/test on feature pushes, staging on `develop`, release build/test on release branches, production deploy on release-to-main, hotfix merge to both main and develop.
- [ ] Add CONTRIBUTING guide, architecture diagrams, API specifications, issue templates, PR template, coding standards, and CODEOWNERS.
- [ ] Require two different approvals for `main`; add extra review for security-sensitive changes.
- [ ] Create six coordinated workstreams: Isaac (workflow/backend), Jerusha (dashboard/UX), Aaron (compliance), Joshua (database/EVC), Simardeep (messaging/infrastructure), Niya (integration/testing/docs).

## Part 1 — Isaac: workflow engine and core backend
- [ ] Build Node.js/Express REST API for application submissions, stage completion, approval, rejection, clarification, and reversion.
- [ ] Define Application and Stage models and stage history.
- [ ] Implement `POST /applications`, `GET /applications/{id}`, and `PUT /applications/{id}/stage` with appropriate status codes (201 on creation).
- [ ] Encode APH routing: standard/existing institute may use scrutiny-only; new institute routes through scrutiny, EVC, and SAC/SHC as applicable.
- [ ] Advance automatically when a stage is completed; support reviewer reverts and “return for clarification.”
- [ ] Require a comment/reason for reversions and persist it.
- [ ] Record an audit event for every state change and publish a message when a stage completes.
- [ ] Validate stage values and request input.
- [ ] Unit test default submission stage, scrutiny-only approval, scrutiny+EVC flow, reversion/reopen behavior, and audit entries.
- [ ] Reach >80% coverage for this module; pass lint and formatting checks.

## Part 2 — Jerusha: frontend dashboard and UX
- [x] Establish a responsive dashboard visual foundation with status summary, pipeline, application list, activity, and filters.
- [x] Demonstrate local application creation, stage-action affordance, status filtering, search, and CSV report export.
- [ ] Convert the prototype into a React single-page app with React Router and reusable components.
- [ ] Implement token-based login/authentication and role-filtered views.
- [ ] Build application dashboard filters for status, region, and date; add application detail with stage history, documents, and compliance information.
- [ ] Build EVC schedule view for applications awaiting EVC and meeting scheduling.
- [ ] Build compliance view for due tasks and approaching deadlines.
- [ ] Provide stage-level approve/reject/revert actions; integrate APIs with fetch/Axios and handle failures clearly.
- [ ] Add WebSocket or polling updates and live alerts.
- [ ] Ensure responsive, intuitive UI and accessibility basics (semantic HTML, alt text, clear validated forms).
- [ ] Test valid/invalid login, mocked dashboard list, approval API action, EVC schedule confirmation, and deadline alert; add integration/E2E tests (Cypress or equivalent).
- [ ] Pass formatting/linting checks and keep UI modular/reusable.

## Part 3 — Aaron: compliance and undertakings
- [ ] Add Undertakings fields: application ID, description, due date, status, and evidence submitted; add ComplianceDocs type and expiry date.
- [ ] Implement `GET/POST /applications/{id}/undertakings` and `PUT /undertakings/{id}` for evidence submission.
- [ ] Validate evidence; mark undertaking Fulfilled when valid evidence is received before due date.
- [ ] Run daily deadline checks; remind 3 days before due date and avoid duplicate reminders at each threshold.
- [ ] Mark unmet items Overdue after the deadline and send an escalated admin alert.
- [ ] Remind about lease/other document expiry 30 and 15 days in advance.
- [ ] Audit evidence submission and missed deadlines; display expiry reminders on the dashboard.
- [ ] Validate upload type and size; handle dates/time zones, same-day thresholds, and leap years accurately.
- [ ] Test reminder scheduler, evidence fulfillment/no further alerts, overdue audit/admin alert, and 30-day expiry alert.
- [ ] Ensure scheduler does not block the server; add deadline logic unit tests and a simple load test.

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
- [ ] Add Dockerfiles for frontend, backend, and supporting services; use efficient multi-stage builds and pin dependencies.
- [ ] Provide local Docker Compose instructions; containers must start/connect and health endpoint return OK.
- [ ] Add GitHub Actions for tests, builds, Docker images, and staging deployment; gate PRs on passing CI.
- [ ] Use GitHub Secrets for credentials; never hardcode keys.
- [ ] Expose `/healthz` and metrics; add container logging/metrics.
- [ ] Configure cloud staging/prod deployment and rollback to last stable container if health checks fail.
- [ ] Test queue-to-email delivery, intentional lint failure blocking CI, and local container health.

## Part 6 — Niya: integration, testing, and documentation
- [ ] Integrate components into one cohesive system and staging environment.
- [ ] Add end-to-end coverage for key workflows and integration scripts in CI.
- [ ] Write deployment guide, OpenAPI/Swagger docs, technical documentation, and user manual.
- [ ] Load demo data and prepare repeatable demo scenarios.
- [ ] Verify application lifecycle, EVC, compliance notifications, role access, and audit trail end to end.

## Architecture, data, and API inventory
- [ ] React SPA communicates by REST with authentication, workflow, EVC, and compliance services.
- [ ] PostgreSQL stores core relational data; RabbitMQ decouples backend events from notification consumers; private S3-compatible storage stores documents; Prometheus/Grafana monitor services, database, and broker.
- [ ] Schema includes applications (institution, current stage, status, submitted/updated dates); institutions (name, region, type, established date); officers (name, role, region, email, password hash); stage history (entered/completed/by); undertakings; compliance docs; EVC meetings; audit logs; notifications; roles; officer-role mapping.
- [ ] API inventory: `POST /api/login`; `GET /api/applications` with status/region/page; `POST /api/applications`; `GET /api/applications/{id}`; `PUT /api/applications/{id}/stage`; `GET /api/applications/{id}/audit`; EVC queue/schedule/read; undertaking list/create/update; `GET /api/notifications`.
- [ ] Protect endpoints with authentication and RBAC; regional officers only access permitted regional data.
- [ ] Stage API returns application ID, previous/new stage, status, and message; audit API returns timestamp, action, and actor.

## Security and privacy
- [ ] Integrate OAuth2/OIDC (or SAML); if no AICTE IdP, use salted password hashes and support 2FA.
- [ ] Enforce least-privilege RBAC for RegionalOfficer, Evaluator, EVCMember, SAC/SHC, admin, and institution users as agreed.
- [ ] Use TLS in transit and encrypt database/storage at rest; encrypt S3-compatible documents and personal data.
- [ ] Keep uploads private, virus-scanned, type/size restricted, and accessible via expiring links.
- [ ] Validate all inputs (including dates and text); use parameterized queries and output escaping.
- [ ] Rate-limit APIs; deploy behind WAF and private VPC; expose only required ports.
- [ ] Audit critical actions including stage changes, compliance submissions, and logins; protect and periodically review audit logs.
- [ ] Update dependencies regularly, run npm audit/security scans, and review flagged vulnerabilities.

## Deployment, observability, and performance
- [ ] Define cloud resources in Terraform (network, compute/ECS/EKS, RDS, buckets, IAM) for repeatable deployment.
- [ ] Isolate development, staging, and production environments; map branch events to appropriate pipelines.
- [ ] Run lint, unit, security, integration checks before merge; deploy versioned containers with health checks and automatic rollback.
- [ ] Retain database snapshots; configure high availability/multi-AZ database and broker, read replicas where needed, and persistent queues.
- [ ] Target API p95 under 200 ms, 100 concurrent dashboard analysts, 50 alerts/hour, and 99.5% production uptime (the KPI section separately says 99% test uptime; reconcile target).
- [ ] Instrument request latency, database time, queue depth, job delay, CPU, memory, request rates, pending applications, errors, failed logins, and audit events.
- [ ] Build Grafana dashboards; aggregate logs (ELK or selected equivalent); alert on >5% 500 errors/minute, queue depth >100, missed jobs, and slow requests.
- [ ] Load-test key flows with k6/JMeter and demonstrate target performance.

## Demo and evaluation scenarios
- [ ] Show a regional officer logging in and seeing only their region's pending applications.
- [ ] Submit applications of different types and demonstrate correct APH routing.
- [ ] Complete scrutiny → EVC → SAC/SHC → Approved; schedule the EVC and show transitions.
- [ ] Add undertaking due tomorrow, run/advance scheduler, and show reminder in mock email and dashboard; show overdue escalation too.
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
- [ ] ≥95% of APH workflow test cases pass automatically.
- [ ] 100% of simulated deadline alerts arrive within one hour of threshold; zero false-positive alerts.
- [ ] API p95 <200 ms; test uptime 99% (confirm alignment with 99.5% production target).
- [ ] Full system setup from code <30 minutes.
- [ ] Quantify administrative effort reduction (example in brief: ten follow-up emails to one alert).
- [ ] No data loss/corruption under simulated service failure; test by stopping a service.
- [ ] ≥80% code coverage in CI.
- [ ] All high-priority SIH rubric stories are implemented and demo-ready.

# Contributing

## Local setup

Install Node.js 20 or later and pnpm, copy `.env.example` to `.env` if using PostgreSQL and RabbitMQ, then run `pnpm install` and `pnpm dev`. Without service URLs the API uses in-memory workflow storage. The frontend opens on Vite's local URL and proxies `/api` requests to Express.

## Branches and commits

Use `feature/<short-description>`, `bugfix/<short-description>`, `release/vX.Y.Z`, `hotfix/<short-description>`, or `chore/<short-description>`. Keep names lowercase and hyphenated. Use Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, and `chore:`. Open a reviewed pull request into the agreed integration branch and include screenshots for UI changes.

## Before opening a pull request

Run `pnpm lint`, `pnpm test`, and `pnpm build`. Describe changes, verification, and any service configuration still needed. Never commit credentials, personal data, or production documents. Demo role selection is a UI simulation and is not authorization.

## Workstream ownership

The executive summary assigns Isaac to workflow/backend, Jerusha to dashboard/UX, Aaron to compliance, Joshua to database/EVC, Simardeep to messaging/infrastructure, and Niya to integration/testing/docs. Confirm ownership with the team before assigning production approvals.

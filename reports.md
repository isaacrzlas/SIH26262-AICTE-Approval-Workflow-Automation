# Verification and metrics report

**Updated:** 30 October 2026  
**Scope:** Current local prototype on `feature/isaac-workflow-persistence`  
**Metric source:** `pnpm test:coverage` (Node.js built-in test coverage)

## Measured results

| Value | What the percentage measures | Scope and interpretation |
|---|---|---|
| **96.65% line coverage** | Executed source lines ÷ instrumented source lines | Backend JavaScript under `src/backend`; across the 20 automated tests. This is the overall line-coverage figure. It does not include React frontend coverage. |
| **83.77% branch coverage** | Executed conditional paths ÷ instrumented conditional paths | Backend JavaScript under `src/backend`. |
| **95.12% function coverage** | Functions called ÷ instrumented functions | Backend JavaScript under `src/backend`. |

These are code coverage measurements, not workflow correctness, production reliability, or security scores. The command used to reproduce them is:

```powershell
pnpm test:coverage
```

## Other checks run

- **20 automated backend tests passed**; this count is a test count, not a percentage.
- `pnpm lint` passed for the backend and React frontend.
- `pnpm build` passed for the Vite/React frontend.
- Local preview API responded with `status: ok`; the local demo contained five sample applications.
- EVC schedule creation and compliance evidence submission were exercised against the local in-memory API.

PostgreSQL and RabbitMQ were not connected for this preview run. EVC schedules and compliance records are temporary in-memory demo data. No production traffic, alert delivery, load, or uptime measurement was performed.

## Percentage targets from the project brief

The values below are requirements or proposed thresholds from the brief, **not achieved results**:

| Value | Metric it applies to | Status |
|---|---|---|
| **≥95% APH workflow test-case pass rate** | Share of the agreed APH workflow scenarios that pass automatically | Not measured against an approved APH test suite; routing assumptions still need team confirmation. |
| **100% on-time simulated deadline alerts** | Share of simulated alerts delivered within one hour of each deadline threshold | Not measured; automated scheduler and notification delivery are not implemented. |
| **99% test uptime** | Availability target during the brief's test period | Not measured. |
| **99.5% production uptime** | Production availability target in the brief | Not measured; no production deployment exists. The brief also gives a **99% test uptime** target, so the owners should confirm that these targets refer to different environments. |
| **≥80% code coverage** | Minimum requested coverage gate for CI | The measured **96.65% backend line coverage** exceeds this numeric threshold for the backend suite only; CI does not yet enforce a coverage threshold and frontend coverage is not included. |
| **>5% HTTP 500 errors per minute** | Proposed error-rate alert threshold | Not configured or measured; monitoring is not connected. |

Other quantitative performance goals in the brief are **API p95 under 200 ms**, **100 concurrent dashboard analysts**, **50 alerts per hour**, and **zero false-positive deadline alerts**. These are not percentages and have not been benchmarked or demonstrated.

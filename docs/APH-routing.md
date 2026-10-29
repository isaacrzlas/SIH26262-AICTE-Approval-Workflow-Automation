# APH workflow routing assumptions

This note captures the prototype rules stated in the SIH26262 executive summary. Confirm these against the applicable AICTE Approval Process Handbook and with the project team before production use.

## Current prototype paths

| Application category | Route | Final state |
| --- | --- | --- |
| Existing institute (`instituteType: "existing"`) | Scrutiny | Approved |
| New institute (`instituteType: "new"`) | Scrutiny → Pending EVC → SAC / SHC | Approved |

## Action behavior

- Approving a stage completes it and advances to the next stage in the route.
- Rejection is terminal and requires a reviewer comment.
- Returning for clarification keeps the application at its current stage, changes its status to `Clarification Requested`, and records the reason in the audit log. A later approval resumes that stage.
- Reversion reopens the prior stage in the configured route. A non-empty comment is mandatory and is recorded in the audit log.

## Team decisions to confirm

- Which application categories, institute types, and change requests require EVC.
- Whether SAC and SHC are one shared stage or separate stages, and their ordering relative to EVC.
- Whether any application category skips, repeats, or branches from scrutiny.
- Which roles can approve, reject, request clarification, and revert at each stage.
- Whether rejection is terminal or can be appealed/reopened, and which stage reversion should target.
- Which APH version and effective date govern applications already in progress.

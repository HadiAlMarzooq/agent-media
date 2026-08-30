---
'@hadialmarzooq/agent-media-core': minor
'@hadialmarzooq/agent-media-ffmpeg': minor
'@hadialmarzooq/agent-media-cli': minor
'@hadialmarzooq/agent-media-mcp': minor
---

Plan repair, execution receipts, a canonical schema, resumability, and content verification.

- **Plan repair.** `inspectPlanIssues` and `repairPlan` detect and fix mechanical plan problems
  before FFmpeg sees them: trims past the source, frame timestamps past the end, resize dimensions
  that contradict the reframed aspect ratio. Every repair is reported as `{ field, action, from,
to }`; anything unrepairable fails with `INVALID_PLAN`. Concatenation inputs that disagree on
  stream layout are reported with a ready-to-run normalization plan per conflicting clip, since
  reconciling them means re-encoding other files. Surfaced as `validate-plan` / `repair-plan` on
  the CLI and `validate_plan` / `repair_plan` over MCP.
- **Execution receipts.** `writeReceipt` leaves a versioned JSON record beside the output holding
  the plan and its fingerprint, the source fingerprint, the backend, the executed steps, the
  output, and the verification report. Failed runs write one too, carrying the stable error code.
- **Resumability.** `resumeFromReceipt`, `agent-media resume`, and `resume_execution` continue from
  a receipt: the work is skipped when the recorded output still satisfies the same plan against an
  unchanged source, and re-executed when it does not.
- **Canonical schema.** The Media IR JSON Schema is generated from the Zod models and published
  both as a GitHub-hosted URL and as the `./schema.json` export of the core package. Plans and
  receipts declaring another version are rejected at the boundary with both versions named.
- **Content verification.** Opt into `blackFrames`, `silence`, `freeze`, and `completeness` checks
  and the output is decoded once and inspected for what it actually contains. `verifyMedia` takes
  `customChecks` and `warnOnly`; a custom check that throws is isolated as a warning, never a
  silent pass.

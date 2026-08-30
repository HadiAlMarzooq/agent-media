---
'@hadialmarzooq/agent-media-core': minor
'@hadialmarzooq/agent-media-ffmpeg': minor
'@hadialmarzooq/agent-media-cli': minor
'@hadialmarzooq/agent-media-mcp': minor
---

Add plan validation and repair helpers (inspectPlanIssues, repairPlan), durable execution receipts with idempotent resume, JSON Schema generated from the canonical Zod models with drift protection, and extensible verification with custom checks and warn-only levels. Surface validate-plan, repair-plan, receipt, and schema commands in the CLI and validate_plan, repair_plan, get_media_plan_schema, inspect_receipt tools in MCP.

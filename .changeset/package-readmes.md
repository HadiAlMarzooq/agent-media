---
'@hadialmarzooq/agent-media-core': patch
'@hadialmarzooq/agent-media-ffmpeg': patch
'@hadialmarzooq/agent-media-cli': patch
'@hadialmarzooq/agent-media-mcp': patch
---

Bring the per-package READMEs up to date with what the packages actually do.

These are the pages npm renders, and they had drifted: the MCP package advertised "Ten semantic
tools" against sixteen, and none of them mentioned plan repair, receipts and resume, content checks,
operator-set limits, or the single ordered `inputs` list that `concatenate` now takes. Documentation
only, no runtime changes.

Also retires `docs/pre-public-review.md`, a pre-release checklist that outlived its purpose and had
gone stale in public, and refreshes `docs/security-review.md` for the operator limits and GitHub's
private vulnerability reporting.

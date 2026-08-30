---
'@hadialmarzooq/agent-media-core': patch
'@hadialmarzooq/agent-media-ffmpeg': patch
'@hadialmarzooq/agent-media-mcp': patch
---

Close the remaining agent-facing traps in the MCP surface.

- `concatenate_media` takes one ordered `inputs` list (minimum two clips) instead of a separate
  `input` plus additional `inputs`, where passing the full list silently duplicated the first clip.
- Concatenation plans record the summed duration of every clip instead of assuming each clip
  matches the first, and omit the expectation entirely when a duration is unknown rather than
  guessing one a wrong output could satisfy.
- Concatenation inspects every input up front, so plans carry resolved paths and replay from any
  working directory, and a missing clip fails before FFmpeg starts.
- `execute_media_plan` now fails with `VERIFICATION_FAILED` when the output does not satisfy the
  plan, matching the workflow tools instead of returning a success envelope carrying
  `passed: false`.
- All eleven MCP tools declare an `outputSchema` and return `structuredContent`.

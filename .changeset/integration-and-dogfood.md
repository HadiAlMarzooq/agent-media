---
'@hadialmarzooq/agent-media-core': minor
'@hadialmarzooq/agent-media-ffmpeg': minor
'@hadialmarzooq/agent-media-cli': minor
'@hadialmarzooq/agent-media-mcp': minor
---

Integrate both lines of work, and fix what installing the packaged tarballs and following the docs
turned up.

**Aspect-ratio verification is numeric, within a 1% tolerance.** Cropping 1920x1080 to 9:16 wants a
607.5px width and encoders need even dimensions, so the honest output is 606x1080 — visually 9:16,
arithmetically 101:180. Exact reduced-fraction equality failed correct output: `agent-media plan
--aspect 9:16` followed by `execute` reported a failed verification for a file that was right. A
genuinely wrong ratio still fails.

**`agent-media execute` reports its receipt and fails when verification fails.** It printed neither
the receipt it had just written nor a non-zero exit for an output that did not satisfy its plan, and
it re-probed the output to verify something execution had already verified.

**`concatenate` takes one ordered `inputs` list on every surface.** The SDK kept the `input` plus
additional-`inputs` split that was removed from MCP; passing the whole list to either half silently
duplicated a clip. The CLI keeps its `concatenate <first> --inputs <rest...>` shape.

**Content checks are available over MCP.** `contentChecks` and `warnOnly` are accepted by the six
workflow tools and `execute_media_plan`, not just the SDK.

Breaking, all pre-1.0: `concatenate({ input, inputs })` becomes `concatenate({ inputs })`;
`inspect_receipt` returns `{ receipt }` so its result has a declarable shape; `agent-media execute`
exits non-zero on a failed verification; MCP workflow results no longer carry `serializedPlan`,
which was a verbatim escaped copy of `plan`.

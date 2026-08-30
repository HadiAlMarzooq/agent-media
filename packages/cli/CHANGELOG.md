# @hadialmarzooq/agent-media-cli

## 0.4.1

### Patch Changes

- d4e657b: Bring the per-package READMEs up to date with what the packages actually do.

  These are the pages npm renders, and they had drifted: the MCP package advertised "Ten semantic
  tools" against sixteen, and none of them mentioned plan repair, receipts and resume, content checks,
  operator-set limits, or the single ordered `inputs` list that `concatenate` now takes. Documentation
  only, no runtime changes.

  Also retires `docs/pre-public-review.md`, a pre-release checklist that outlived its purpose and had
  gone stale in public, and refreshes `docs/security-review.md` for the operator limits and GitHub's
  private vulnerability reporting.

- Updated dependencies [d4e657b]
  - @hadialmarzooq/agent-media-core@0.3.1
  - @hadialmarzooq/agent-media-ffmpeg@0.4.1

## 0.4.0

### Minor Changes

- 63d3767: Give encoding a realistic time budget, and give the operator the controls.

  A single 30-second timeout covered both probing and encoding, so a ten-minute 1080p source failed
  with `OPERATION_TIMEOUT` after 30.7 seconds — through the MCP server, with no way for the caller or
  the operator to raise it. Probing and encoding now have separate defaults: 30 seconds for a probe,
  which reads a header and returns, and 30 minutes for an execution, which is minutes of real work.
  Cancellation remains the way to stop a run early; it is immediate and leaves no partial file.

  The MCP server and the CLI now read their limits from the environment, so they belong to whoever
  runs the tool rather than to the model calling it — no tool argument can widen them:

  - `AGENT_MEDIA_ALLOWED_OUTPUT_DIR` confines every write to one directory tree.
  - `AGENT_MEDIA_TIMEOUT_MS` caps how long any single FFmpeg run may take.
  - `AGENT_MEDIA_FFMPEG_PATH` and `AGENT_MEDIA_FFPROBE_PATH` locate binaries that are not on `PATH`.

  The CLI also accepts `--timeout <ms>` and `--allowed-output-dir <path>` for one invocation. An
  unusable `AGENT_MEDIA_TIMEOUT_MS` fails immediately instead of being silently ignored.

  `allowedOutputDirectory` and `timeoutMs` were previously reachable only from the SDK, while the
  README advertised both as safety defaults.

### Patch Changes

- Updated dependencies [63d3767]
  - @hadialmarzooq/agent-media-ffmpeg@0.4.0

## 0.3.0

### Minor Changes

- aebf07e: Integrate both lines of work, and fix what installing the packaged tarballs and following the docs
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

- aebf07e: Plan repair, execution receipts, a canonical schema, resumability, and content verification.

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

### Patch Changes

- Updated dependencies [aebf07e]
- Updated dependencies [aebf07e]
- Updated dependencies [aebf07e]
  - @hadialmarzooq/agent-media-core@0.3.0
  - @hadialmarzooq/agent-media-ffmpeg@0.3.0

## 0.2.0

### Minor Changes

- 9efdea9: Fix vacuous verification, add concatenate workflow, strict goal schema, MCP tool annotations, extract-frame expectations, output directory and extension validation, per-path execution locking, full path in error messages, still-image rejection.

### Patch Changes

- Updated dependencies [9efdea9]
  - @hadialmarzooq/agent-media-core@0.2.0
  - @hadialmarzooq/agent-media-ffmpeg@0.2.0

## 0.1.1

### Patch Changes

- Add README and LICENSE to published package files so npm registry pages show documentation.
- Updated dependencies
  - @hadialmarzooq/agent-media-core@0.1.1
  - @hadialmarzooq/agent-media-ffmpeg@0.1.1

## 0.1.0

### Minor Changes

- Initial public release. Five verified workflows (makeVertical, optimizeForWeb, normalize, extractAudio, extractFrame), versioned Media IR v1, structured verification, monotonic progress, 13-scenario reliability corpus, CLI and MCP adapters, automated release pipeline with artifact validation.
- 0dd4533: Add optimizeForWeb, normalize, extractAudio, and extractFrame verified workflows with CLI commands, MCP tools, expanded 13-scenario reliability corpus, and visual demo GIF.

### Patch Changes

- Updated dependencies
- Updated dependencies [0dd4533]
  - @hadialmarzooq/agent-media-core@0.1.0
  - @hadialmarzooq/agent-media-ffmpeg@0.1.0

## 0.0.11

### Patch Changes

- Add a verified `makeVertical` workflow with SDK, CLI, and MCP progress reporting; preflight
  incompatible concatenation streams; and ship executable recovery and cross-platform reliability
  evidence. Harden packaged executable entrypoint detection.
- Updated dependencies
  - @hadialmarzooq/agent-media-core@0.0.9
  - @hadialmarzooq/agent-media-ffmpeg@0.0.10

## 0.0.10

### Patch Changes

- 5d7efd3: Validate Media IR at every runtime boundary, verify compatibility metadata, prevent silent step
  loss, and dogfood real transformations through the SDK, CLI, and MCP protocol.
- Updated dependencies [5d7efd3]
  - @hadialmarzooq/agent-media-core@0.0.8
  - @hadialmarzooq/agent-media-ffmpeg@0.0.9

## 0.0.9

### Patch Changes

- Updated dependencies [6d4bd2f]
  - @hadialmarzooq/agent-media-core@0.0.7
  - @hadialmarzooq/agent-media-ffmpeg@0.0.8

## 0.0.8

### Patch Changes

- 29dbc6c: Record the pre-public readiness audit and move packages to the owner-scoped namespace.
- Updated dependencies [29dbc6c]
  - @hadialmarzooq/agent-media-core@0.0.6
  - @hadialmarzooq/agent-media-ffmpeg@0.0.7

## 0.0.7

### Patch Changes

- Updated dependencies [ec3ea0c]
  - @agent-media/core@0.0.5
  - @agent-media/ffmpeg@0.0.6

## 0.0.6

### Patch Changes

- 41dfc7d: Add JSON-first CLI commands and MCP tools for the Agent Media workflow.

## 0.0.5

### Patch Changes

- Updated dependencies [2d2a2b3]
  - @agent-media/core@0.0.4
  - @agent-media/ffmpeg@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [2a023a3]
  - @agent-media/ffmpeg@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [160f253]
  - @agent-media/core@0.0.3
  - @agent-media/ffmpeg@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [68bad08]
  - @agent-media/core@0.0.2
  - @agent-media/ffmpeg@0.0.2

## 0.0.1

### Patch Changes

- cccc9ac: Establish the private Agent Media monorepo foundation and quality gates.
- Updated dependencies [cccc9ac]
  - @agent-media/core@0.0.1
  - @agent-media/ffmpeg@0.0.1

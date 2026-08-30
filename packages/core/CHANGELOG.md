# @hadialmarzooq/agent-media-core

## 0.3.1

### Patch Changes

- d4e657b: Bring the per-package READMEs up to date with what the packages actually do.

  These are the pages npm renders, and they had drifted: the MCP package advertised "Ten semantic
  tools" against sixteen, and none of them mentioned plan repair, receipts and resume, content checks,
  operator-set limits, or the single ordered `inputs` list that `concatenate` now takes. Documentation
  only, no runtime changes.

  Also retires `docs/pre-public-review.md`, a pre-release checklist that outlived its purpose and had
  gone stale in public, and refreshes `docs/security-review.md` for the operator limits and GitHub's
  private vulnerability reporting.

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

- aebf07e: Close the remaining agent-facing traps in the MCP surface.

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

## 0.2.0

### Minor Changes

- 9efdea9: Fix vacuous verification, add concatenate workflow, strict goal schema, MCP tool annotations, extract-frame expectations, output directory and extension validation, per-path execution locking, full path in error messages, still-image rejection.

## 0.1.1

### Patch Changes

- Add README and LICENSE to published package files so npm registry pages show documentation.

## 0.1.0

### Minor Changes

- Initial public release. Five verified workflows (makeVertical, optimizeForWeb, normalize, extractAudio, extractFrame), versioned Media IR v1, structured verification, monotonic progress, 13-scenario reliability corpus, CLI and MCP adapters, automated release pipeline with artifact validation.

## 0.0.9

### Patch Changes

- Add a verified `makeVertical` workflow with SDK, CLI, and MCP progress reporting; preflight
  incompatible concatenation streams; and ship executable recovery and cross-platform reliability
  evidence.

## 0.0.8

### Patch Changes

- 5d7efd3: Validate Media IR at every runtime boundary, verify compatibility metadata, prevent silent step
  loss, and dogfood real transformations through the SDK, CLI, and MCP protocol.

## 0.0.7

### Patch Changes

- 6d4bd2f: Remove the stale hard-coded runtime version export.

## 0.0.6

### Patch Changes

- 29dbc6c: Record the pre-public readiness audit and move packages to the owner-scoped namespace.

## 0.0.5

### Patch Changes

- ec3ea0c: Harden execution with cancellation, timeout classification, and output path safety.

## 0.0.4

### Patch Changes

- 2d2a2b3: Add structured output verification against semantic plan expectations.

## 0.0.3

### Patch Changes

- 160f253: Add versioned semantic Media IR, serialization, planning, explanations, and constraint validation.

## 0.0.2

### Patch Changes

- 68bad08: Add normalized media inspection, FFmpeg capability detection, and stable backend errors.

## 0.0.1

### Patch Changes

- cccc9ac: Establish the private Agent Media monorepo foundation and quality gates.

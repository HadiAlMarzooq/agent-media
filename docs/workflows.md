# Workflows

## `makeVertical`

`makeVertical` is the opinionated high-level workflow. It performs the complete contract:

1. inspect the source;
2. detect FFmpeg capabilities;
3. create a 9:16 high-compatibility Media IR plan;
4. serialize that plan;
5. execute it;
6. inspect the output again; and
7. verify every recorded expectation.

It returns all semantic artifacts rather than only a path:

```ts
const { source, plan, serializedPlan, output, verification } = await makeVertical({
  input: 'landscape.mp4',
  output: 'short.mp4',
  width: 720,
  height: 1280,
  trimStartSeconds: 12,
  durationSeconds: 20,
  maxSizeMB: 18,
});
```

This is intentionally a convenience layer over Media IR. The plan can still be persisted and
replayed with `parsePlan` and `executePlan`; there is no separate workflow compiler.

### Progress

Both `makeVertical` and `executePlan` accept `onProgress`. Events are monotonic and use this shape:

```ts
interface MediaProgress {
  phase: 'inspecting' | 'planning' | 'executing' | 'verifying' | 'completed';
  percent: number; // 0 through 100
  message: string;
  processedSeconds?: number;
  totalSeconds?: number;
  speed?: number;
}
```

Execution progress comes from FFmpeg's `-progress` machine channel, not from scraping human log
lines. Callback exceptions are isolated so an observational UI cannot change execution semantics.
CLI `--progress` writes the same events as NDJSON to stderr. MCP maps them to standard
`notifications/progress` messages when the client supplies a progress token.

Progress is best effort. A stream without a known duration can remain at its phase start until
completion; consumers must not treat a missing intermediate event as failure.

## Explicit plan and replay

The explicit pipeline is appropriate when an agent needs a review checkpoint:

```ts
const source = await inspectMedia(input);
const plan = planMedia({ source, capabilities, goals });

await approvalQueue.submit(serializePlan(plan));

const approved = parsePlan(await approvalQueue.receive());
await executePlan(approved, { output });
const report = verifyMedia(await inspectMedia(output), approved.expectations);
```

Every public Media IR boundary validates the plan. Invalid JSON, unknown versions, duplicate step
IDs, unsafe operation combinations, and inconsistent constraints become `INVALID_PLAN` errors before
execution.

## Structured recovery demo

Run:

```bash
pnpm demo
```

The executable demo requests a 180×320 H.264 clip with audio under 1 KB. FFmpeg successfully creates
a file, but fresh verification correctly reports:

```json
{
  "passed": false,
  "checks": {
    "maxFileSize": {
      "passed": false,
      "expected": "<= 1000 bytes (2% tolerance)",
      "actual": 18763,
      "message": "Output exceeds the requested maximum file size."
    }
  },
  "failures": ["maxFileSize: Output exceeds the requested maximum file size."]
}
```

The exact byte count can vary with FFmpeg builds. The decision does not: the agent branches on the
failed `maxFileSize` check, reads `actual`, chooses a feasible explicit ceiling, creates a new plan,
serializes and parses it again, executes it, and requires the final report to pass.

Artifacts are placed under `artifacts/demo/`:

| Artifact              | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `initial-plan.json`   | original impossible but valid semantic plan  |
| `first-attempt.mp4`   | process-success / verification-failure proof |
| `recovered-plan.json` | revised replayable plan                      |
| `recovered.mp4`       | verified output                              |
| `transcript.json`     | complete machine-readable event sequence     |

This distinction is fundamental: `EXECUTION_FAILED` means the backend could not carry out the plan;
a failed `VerificationReport` means the backend produced media that did not satisfy the requested
outcome.

## Safe execution controls

Use these controls for long-running or multi-tenant environments:

```ts
const controller = new AbortController();

await executePlan(plan, {
  output,
  overwrite: false,
  allowedOutputDirectory: '/srv/agent-media/outputs',
  timeoutMs: 10 * 60_000,
  signal: controller.signal,
  onProgress,
});
```

Agent Media rejects source/output identity and output-directory escape before inspecting or spawning
FFmpeg. Existing output files require explicit overwrite. Failed, timed-out, and cancelled operations
remove partial output on a best-effort basis.

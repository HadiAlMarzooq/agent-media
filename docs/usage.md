# Usage

Every surface — TypeScript, CLI, MCP — drives the same contract:

```text
goal → inspect → validated plan → execute → inspect again → verify → receipt
```

This guide is task-oriented. For the exhaustive signature list, see the
[API reference](api.md).

## Prerequisites

Node.js 22 or newer, with `ffmpeg` and `ffprobe` on `PATH`.

```bash
ffmpeg -version   # any recent build; hardware acceleration is detected, not required
```

Check what your build can actually do before planning anything demanding:

```bash
npx @hadialmarzooq/agent-media-cli capabilities
```

```json
{
  "ffmpegVersion": "8.0.1",
  "encoders": { "h264": true, "hevc": true, "av1": true, "aac": true },
  "hardwareAcceleration": ["videotoolbox"],
  "filters": { "scale": true, "crop": true, "concat": true, "subtitles": false }
}
```

---

## Use it from an agent (MCP)

### Setup

Install the server and point a client at it over stdio:

```bash
npm install -g @hadialmarzooq/agent-media-mcp
```

**Claude Code** — one command, project scope:

```bash
claude mcp add agent-media -- agent-media-mcp
```

**Claude Desktop / any MCP client** — in the client's config file:

```json
{
  "mcpServers": {
    "agent-media": {
      "command": "agent-media-mcp"
    }
  }
}
```

Paths in tool arguments resolve against the server's working directory. Pass absolute paths unless
you know what that directory is.

### Limits you set, not the model

The server reads its limits from the environment. No tool argument can widen them, so the model
driving the tools cannot write outside the directory you allow or run longer than you permit:

```json
{
  "mcpServers": {
    "agent-media": {
      "command": "agent-media-mcp",
      "env": {
        "AGENT_MEDIA_ALLOWED_OUTPUT_DIR": "/Users/you/Movies/agent-output",
        "AGENT_MEDIA_TIMEOUT_MS": "600000"
      }
    }
  }
}
```

| Variable                         | Effect                                                           |
| -------------------------------- | ---------------------------------------------------------------- |
| `AGENT_MEDIA_ALLOWED_OUTPUT_DIR` | writes outside this tree fail with `PATH_NOT_ALLOWED`            |
| `AGENT_MEDIA_TIMEOUT_MS`         | any single FFmpeg run beyond this fails with `OPERATION_TIMEOUT` |
| `AGENT_MEDIA_FFMPEG_PATH`        | an `ffmpeg` that is not on `PATH`                                |
| `AGENT_MEDIA_FFPROBE_PATH`       | an `ffprobe` that is not on `PATH`                               |

Without `AGENT_MEDIA_TIMEOUT_MS`, probes get 30 seconds and encodes get 30 minutes. Encoding a long
source is minutes of real work, so the execution budget is deliberately generous; cancel a run you
no longer want, which stops FFmpeg immediately and leaves no partial file.

### The one-call workflows

Six tools do the whole loop — plan, execute, and verify — and fail loudly if the output does not
match what was planned:

| Tool                | Ask for                                                  |
| ------------------- | -------------------------------------------------------- |
| `make_vertical`     | 9:16, H.264/yuv420p, faststart, optional size cap        |
| `optimize_for_web`  | smaller file at a quality tier, still broadly compatible |
| `normalize_media`   | same geometry, made broadly compatible                   |
| `extract_audio`     | m4a, mp3, or wav                                         |
| `extract_frame`     | a still at a timestamp                                   |
| `concatenate_media` | several clips joined, in playback order                  |

```jsonc
// make_vertical
{ "input": "/clips/talk.mp4", "output": "/out/talk-9x16.mp4", "maxSizeMB": 25 }
```

The result carries the source metadata, the plan that ran, the output metadata, and the
verification report. `verification.passed` is `true` or the call is an error — there is no third
state where the file is wrong and the call succeeded.

```jsonc
{
  "verification": {
    "passed": true,
    "checks": {
      "aspectRatio": {
        "passed": true,
        "expected": "9:16",
        "actual": "9:16",
        "message": "Constraint satisfied.",
      },
      "maxFileSize": {
        "passed": true,
        "expected": "<= 25000000 bytes (2% tolerance)",
        "actual": 8_912_004,
      },
    },
    "failures": [],
    "warnings": [],
  },
}
```

`concatenate_media` takes **every** clip in one ordered list:

```jsonc
{ "inputs": ["/clips/intro.mp4", "/clips/body.mp4", "/clips/outro.mp4"], "output": "/out/full.mp4" }
```

### The explicit loop

When the agent should reason about the plan before anything is written:

1. `inspect_media` — normalized metadata for the source.
2. `plan_media` — semantic goals in, a validated Media IR plan out. Nothing has run yet.
3. `execute_media_plan` — run that exact plan.
4. `verify_media` — re-verify an output against a plan at any later time.

```jsonc
// plan_media
{
  "input": "/clips/talk.mp4",
  "goals": {
    "aspectRatio": "9:16",
    "width": 1080,
    "height": 1920,
    "compatibility": "high",
    "maxSizeMB": 25,
  },
}
```

Every step in the returned plan carries a `reason`, so the agent can explain the transformation
before it runs and a human can review it:

```jsonc
{
  "id": "reframe-1",
  "operation": "reframe",
  "aspectRatio": "9:16",
  "strategy": "center",
  "reason": "The requested output aspect ratio differs from the source.",
}
```

Unknown goal keys are rejected rather than ignored, so a misspelled goal fails instead of silently
producing a plan that does not do what was asked.

### Repairing a plan that no longer fits

Plans get persisted, handed between agents, and replayed against a different file. `validate_plan`
reports what no longer holds; `repair_plan` fixes what is mechanically fixable and says exactly what
it changed.

```jsonc
// validate_plan → issues
[{ "field": "steps.trim.endSeconds", "message": "Trim end 99s extends beyond the source duration 6s.", "repairable": true }]

// repair_plan → repairs
[{ "field": "steps.trim.endSeconds", "action": "clamped into source duration", "from": 99, "to": 6 }]
```

Concatenation inputs that disagree on stream layout are reported but **not** silently repaired —
reconciling them means re-encoding other files. The issue carries a ready-to-run normalization plan
per conflicting clip, which you can execute with `execute_media_plan` and then retry the join.

### Receipts and resuming

Pass `writeReceipt: true` to `execute_media_plan` and a durable record lands at
`<output>.receipt.json`: the plan and its fingerprint, the source fingerprint, the backend, the
executed steps, the output, and the verification report. Failed runs write one too, carrying the
error code.

`resume_execution` takes that receipt back:

```jsonc
{ "receipt": "<contents of talk-9x16.mp4.receipt.json>" }
```

If the recorded output still exists and still satisfies the same plan against an unchanged source,
nothing is re-encoded and `resumed` comes back `true`. If the source changed, the plan changed, or
the output is gone, it runs again. This is what makes a retried agent step idempotent.

### Checking what is actually in the output

Metadata verification proves the file has the right shape. It cannot prove there is a picture in it.
Content checks decode the output once and look:

```jsonc
{
  "input": "/clips/talk.mp4",
  "output": "/out/talk-9x16.mp4",
  "contentChecks": { "blackFrames": true, "silence": true, "completeness": true },
}
```

Add `warnOnly: ["silence"]` when a silent stretch is expected and should be reported without failing
the call.

---

## Use it from the CLI

Every successful command writes one JSON document to stdout. Progress is newline-delimited JSON on
stderr, so a pipeline never receives mixed output.

The CLI reads the same variables, and `--timeout <ms>` / `--allowed-output-dir <path>` override
them for one invocation.

```bash
# One-call workflows
agent-media vertical talk.mp4 --output talk-9x16.mp4 --max-size 25 --progress
agent-media optimize talk.mp4 --output web.mp4 --max-size 10 --quality balanced
agent-media normalize talk.mp4 --output normalized.mp4
agent-media extract-audio talk.mp4 --output audio.m4a
agent-media extract-frame talk.mp4 --output thumb.jpg --at 2
agent-media concatenate intro.mp4 --inputs body.mp4 outro.mp4 --output full.mp4

# The explicit loop
agent-media inspect talk.mp4
agent-media plan talk.mp4 --aspect 9:16 --max-size 25 --out plan.json
agent-media validate-plan plan.json
agent-media repair-plan plan.json --out repaired.json
agent-media execute repaired.json --output talk-9x16.mp4 --write-receipt --progress
agent-media verify talk-9x16.mp4 --against repaired.json

# Receipts
agent-media receipt talk-9x16.mp4.receipt.json
agent-media resume talk-9x16.mp4.receipt.json

# The canonical plan schema, for validating Media IR outside TypeScript
agent-media schema > media-plan.schema.json
```

Piping into `jq` is the intended use:

```bash
agent-media inspect talk.mp4 | jq '.video.aspectRatio, .durationSeconds'
agent-media vertical talk.mp4 --output out.mp4 | jq '.verification.passed'
```

Failures are JSON on stderr with a stable `code`, so a shell script can branch on them:

```bash
if ! agent-media vertical talk.mp4 --output out.mp4 2>error.json; then
  jq -r '.code, .message, .suggestedActions[]' error.json
fi
```

---

## Use it from TypeScript

```bash
npm install @hadialmarzooq/agent-media-core @hadialmarzooq/agent-media-ffmpeg
```

### One call

```ts
import { makeVertical } from '@hadialmarzooq/agent-media-ffmpeg';

const result = await makeVertical({
  input: 'talk.mp4',
  output: 'talk-9x16.mp4',
  maxSizeMB: 25,
  onProgress: ({ phase, percent }) => console.error(`${phase} ${percent}%`),
});

result.verification.passed; // true, or the call threw VERIFICATION_FAILED
```

### The explicit loop, with the plan crossing a process boundary

```ts
import { parsePlan, planMedia, serializePlan, verifyMedia } from '@hadialmarzooq/agent-media-core';
import { executePlan, getCapabilities, inspectMedia } from '@hadialmarzooq/agent-media-ffmpeg';

const source = await inspectMedia('talk.mp4');
const plan = planMedia({
  source,
  capabilities: await getCapabilities(),
  goals: { aspectRatio: '9:16', width: 1080, height: 1920, compatibility: 'high' },
});

// Review it, log it, send it somewhere else, store it — it is just JSON.
const wire = serializePlan(plan);

const execution = await executePlan(parsePlan(wire), {
  output: 'talk-9x16.mp4',
  writeReceipt: true,
});
const report = verifyMedia(await inspectMedia(execution.output), plan.expectations);
```

### Recovering from a failed verification

This is the loop the library exists for: a failure is evidence, not an exception to swallow.

```ts
import { MediaError } from '@hadialmarzooq/agent-media-core';
import { optimizeForWeb } from '@hadialmarzooq/agent-media-ffmpeg';

try {
  await optimizeForWeb({ input: 'talk.mp4', output: 'web.mp4', maxSizeMB: 2 });
} catch (error) {
  if (error instanceof MediaError && error.code === 'VERIFICATION_FAILED') {
    const { verification } = error.context as { verification: { failures: string[] } };
    // ["maxFileSize: Output exceeds the requested maximum file size."]
    // Loosen the constraint the evidence names, and retry with a smaller quality tier.
    await optimizeForWeb({
      input: 'talk.mp4',
      output: 'web.mp4',
      maxSizeMB: 2,
      quality: 'small',
      overwrite: true,
    });
  }
}
```

Run `pnpm demo` for the complete version of this loop against a generated fixture.

### Custom verification

```ts
import { verifyMedia } from '@hadialmarzooq/agent-media-core';
import { analyzeContent, inspectMedia } from '@hadialmarzooq/agent-media-ffmpeg';

const output = await inspectMedia('web.mp4');
const content = await analyzeContent(output, { blackFrames: true, silence: true });

const report = verifyMedia(output, plan.expectations, {
  customChecks: [
    () => content,
    (media) => ({
      under30s: {
        passed: (media.durationSeconds ?? 0) <= 30,
        expected: '<= 30s',
        actual: media.durationSeconds,
        message: 'Output is longer than the platform limit.',
      },
    }),
  ],
  warnOnly: ['silence'],
});
```

A custom check that throws is isolated as a warning — it never crashes verification, and it is never
recorded as a pass.

---

## Cancellation, timeouts, and confinement

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

await makeVertical({
  input: 'talk.mp4',
  output: 'out.mp4',
  signal: controller.signal, // kills FFmpeg, removes the partial output
  timeoutMs: 60_000, // OPERATION_TIMEOUT if exceeded
  allowedOutputDirectory: '/var/out', // PATH_NOT_ALLOWED for anything outside
});
```

Over MCP, client cancellation is wired to the same signal.

## When something fails

Every failure carries a stable `code`, the context that produced it, and suggested actions. Branch
on the code, not the message:

```json
{
  "code": "OUTPUT_EXISTS",
  "message": "The output path already exists.",
  "context": { "output": "/out/talk-9x16.mp4" },
  "suggestedActions": ["Choose a different output path or explicitly enable overwrite."]
}
```

The full list, and what to do about each, is in [Errors and recovery](errors.md).

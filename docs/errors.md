# Errors and recovery

Operational failures throw `MediaError`. Its JSON representation is stable and safe for agents:

```ts
interface MediaErrorDetails {
  code: MediaErrorCode;
  message: string;
  context?: Record<string, unknown>;
  suggestedActions?: string[];
  debug?: { backend?: string; stderr?: string };
}
```

CLI failures write this object to stderr and exit non-zero. MCP tool failures return it in text
content with `isError: true`. Backend stderr is diagnostic; branch on `code`, not message text.

## Codes

| Code                        | Meaning                                      | Typical recovery                               |
| --------------------------- | -------------------------------------------- | ---------------------------------------------- |
| `FFMPEG_NOT_FOUND`          | FFmpeg or ffprobe could not start            | install it or configure the executable path    |
| `PROBE_FAILED`              | ffprobe started but could not read the input | replace/repair the file or use another format  |
| `UNSUPPORTED_INPUT`         | stream topology cannot satisfy the operation | normalize streams or choose another workflow   |
| `INVALID_PLAN`              | goals or Media IR violate a contract         | revise semantic goals and create a new plan    |
| `EXECUTION_FAILED`          | FFmpeg returned a non-zero result            | inspect debug stderr and retry supported media |
| `VERIFICATION_FAILED`       | a high-level workflow output missed its plan | inspect failed checks and replan               |
| `PATH_NOT_ALLOWED`          | source overwrite or directory escape         | choose a distinct permitted output path        |
| `OUTPUT_EXISTS`             | overwrite was not authorized                 | choose a new path or explicitly opt in         |
| `OUTPUT_DIR_MISSING`        | the output directory does not exist          | create the directory before execution          |
| `OUTPUT_EXTENSION_MISMATCH` | output extension conflicts with the plan     | use the correct extension or adjust the plan   |
| `OPERATION_TIMEOUT`         | configured execution deadline expired        | raise the timeout or reduce the operation      |
| `OPERATION_CANCELLED`       | the supplied abort signal was triggered      | retry only if the caller still wants the work  |

## Verification is a report

The low-level `verifyMedia` API does not throw when constraints fail. It returns all checks so an
agent can reason once instead of fixing one condition at a time:

```ts
const report = verifyMedia(outputMetadata, plan.expectations);

if (!report.passed) {
  for (const [name, check] of Object.entries(report.checks)) {
    if (!check.passed) {
      console.error({ name, expected: check.expected, actual: check.actual });
    }
  }
}
```

`makeVertical` is opinionated: because it promises a verified end-to-end result, it turns a failed
report into `VERIFICATION_FAILED` and includes the complete report in `error.context.verification`.

## Recovery pattern

```ts
try {
  await makeVertical(options);
} catch (error) {
  if (!(error instanceof MediaError)) throw error;

  switch (error.code) {
    case 'OUTPUT_EXISTS':
      return makeVertical({ ...options, output: nextAvailablePath() });
    case 'OPERATION_TIMEOUT':
      return makeVertical({ ...options, timeoutMs: 10 * 60_000 });
    case 'VERIFICATION_FAILED':
      return replanFromChecks(error.context?.verification);
    default:
      throw error;
  }
}
```

Recovery should produce a new plan when intent changes. Do not mutate serialized plan JSON by string
replacement or expose raw FFmpeg flags to an agent.

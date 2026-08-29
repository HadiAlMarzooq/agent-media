# Reliability

Agent Media benchmarks semantic outcomes, not merely process completion or encoded-byte identity.
Different FFmpeg builds can emit different bytes while producing equivalent media; therefore the
cross-platform gate compares normalized behavior.

## Representative corpus

The corpus is generated locally with FFmpeg, so it has no checked-in binary fixtures and runs the
same way on all CI operating systems.

| Case                            | Contract under test                                               |
| ------------------------------- | ----------------------------------------------------------------- |
| `size-limit`                    | 16:9 H.264/AAC → 9:16, 180×320, one second, verified below 150 KB |
| `malformed-file`                | arbitrary bytes produce `PROBE_FAILED` with suggested recovery    |
| `audio-only-vertical-rejection` | a visual workflow on audio-only input produces `INVALID_PLAN`     |
| `incompatible-concatenation`    | mismatched geometry/fps/audio is rejected as `UNSUPPORTED_INPUT`  |

Run it from a built checkout:

```bash
pnpm benchmark:reliability
```

The command writes `artifacts/reliability/<platform>-<architecture>.json` and prints the same report.
Each case includes wall-clock duration and stable semantic evidence.

## Current local baseline

Baseline captured on 2026-08-30 with macOS arm64, Node.js 26.5.1, and FFmpeg 8.0.1:

| Case                          | Result |  Duration |
| ----------------------------- | ------ | --------: |
| size limit                    | pass   | 126.29 ms |
| malformed file                | pass   |  20.92 ms |
| audio-only vertical rejection | pass   |  52.25 ms |
| incompatible concatenation    | pass   |  44.10 ms |

Total: 4/4 passed. Semantic fingerprint:
`5b7f0a8ccb79a75d1ae7a9a967056c8cdc9441340ec1ad2ec70ec5e22cf805d9`.

Durations are diagnostic rather than release thresholds; shared runners and encoder builds have
different performance. Correct semantic evidence is the gate.

## Cross-platform reproducibility

The CI matrix runs formatting, linting, type checking, build, tests, demo, and corpus on Ubuntu,
macOS, and Windows. Each platform uploads its JSON report. A dependent job then executes:

```bash
node benchmarks/compare-reliability.mjs artifacts/reliability
```

The comparator requires:

- every report to have zero failed cases;
- at least two platform reports; and
- one identical SHA-256 semantic fingerprint across all reports.

The fingerprint includes case IDs, pass/fail state, codec, pixel format, dimensions, audio presence,
and structured error evidence. It excludes paths, timestamps, runtimes, FFmpeg versions, and encoded
byte counts.

## Size-limit interpretation

Planning a byte-perfect encode in one pass is not generally possible. Agent Media calculates a
conservative bitrate and then verifies the actual file. Verification permits 2% above the requested
byte ceiling for container and encoder variance. If the result is still over the tolerated ceiling,
the report fails and exposes expected and actual sizes for structured recovery.

The corpus currently exercises a short, low-resolution target. Broader public-launch evidence should
add long-form material, variable-frame-rate sources, rotation metadata, more containers, high-motion
content, multichannel audio, and hardware encoder variants without weakening the semantic checks.

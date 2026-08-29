# Pre-public security review

Phase 6 review covers the current local runtime boundary:

- FFmpeg and ffprobe are executed without a shell; user paths are individual process arguments.
- Output collisions are rejected by default and source paths cannot be overwritten.
- Embedders can limit output to an allowed directory.
- Process timeouts and cancellation return stable structured error codes.
- Failed, cancelled, and timed-out executions remove partial outputs on a best-effort basis.
- Concatenation uses direct FFmpeg inputs rather than temporary command files, so it has no
  intermediary list files to clean up.
- No telemetry, network calls, credentials, or paid services are included.

Run `pnpm audit:prod` before each private release and investigate any production dependency issue.

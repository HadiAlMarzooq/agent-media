# Security review

What the local runtime boundary guarantees today:

- FFmpeg and ffprobe are executed without a shell; user paths are individual process arguments.
- Output collisions are rejected by default and source paths cannot be overwritten.
- Output can be confined to an allowed directory. Embedders pass `allowedOutputDirectory`; the CLI
  and MCP server read `AGENT_MEDIA_ALLOWED_OUTPUT_DIR` from the environment, so the limit belongs to
  whoever runs the tool and no tool argument can widen it.
- Process timeouts and cancellation return stable structured error codes. Probing and encoding have
  separate default budgets, and `AGENT_MEDIA_TIMEOUT_MS` caps both.
- Failed, cancelled, and timed-out executions remove partial outputs on a best-effort basis.
- Concatenation uses direct FFmpeg inputs rather than temporary command files, so it has no
  intermediary list files to clean up.
- No telemetry, network calls, credentials, or paid services are included.

Run `pnpm audit:prod` before each release and investigate any production dependency issue.

Report a suspected vulnerability through [private vulnerability reporting](https://github.com/HadiAlMarzooq/agent-media/security/advisories/new)
rather than a public issue. See [SECURITY.md](../SECURITY.md).

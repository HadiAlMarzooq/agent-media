---
'@hadialmarzooq/agent-media-ffmpeg': minor
'@hadialmarzooq/agent-media-cli': minor
'@hadialmarzooq/agent-media-mcp': minor
---

Give encoding a realistic time budget, and give the operator the controls.

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

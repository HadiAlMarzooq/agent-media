# Documentation

Agent Media is easiest to understand as a contract, not as an FFmpeg wrapper:

```text
goal → normalized source → validated plan → deterministic execution → fresh verification
```

Start with the guide that matches your task:

| Guide                                            | Use it when you want to…                               |
| ------------------------------------------------ | ------------------------------------------------------ |
| [Getting started](getting-started.md)            | install prerequisites and run the first transformation |
| [Workflows](workflows.md)                        | use `makeVertical`, progress, replay, or recovery      |
| [API reference](api.md)                          | integrate the TypeScript SDK, CLI, or MCP surface      |
| [Reliability](reliability.md)                    | understand corpus coverage and cross-platform evidence |
| [Errors](errors.md)                              | branch on stable failures and choose a recovery        |
| [Architecture](../ARCHITECTURE.md)               | understand package boundaries and design invariants    |
| [Security](../SECURITY.md)                       | operate safely with untrusted media and output paths   |
| [Media Plan JSON Schema](media-plan.schema.json) | validate persisted Media IR outside TypeScript         |

The runnable examples are:

- [`agent-recovery.mjs`](../examples/agent-recovery.mjs): complete failed-verification and recovery loop;
- [`vertical-video.ts`](../examples/vertical-video.ts): explicit inspect-plan-execute-verify pipeline;
- [`mcp-config.json`](../examples/mcp-config.json): minimal MCP stdio configuration.

Packages remain unpublished during the private release-candidate stage. API documentation describes
the current repository build and GitHub prerelease artifacts.

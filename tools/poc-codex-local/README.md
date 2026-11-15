# Codex Local Provider PoC

This is an isolated, read-only proof of concept for calling the official
`@openai/codex-sdk` through the local Codex CLI session. It does not connect to
Nova's database, BullMQ worker, or application runtime.

## Run

1. Sign in locally with `codex login`.
2. From the repository root, run `pnpm --dir tools/poc-codex-local run run`.

The PoC starts a Codex thread in this directory with `sandboxMode: "read-only"`
and `approvalPolicy: "never"`. It requests a deliberately small 30-day business
plan, applies a 120-second timeout, and validates the final JSON with Zod.

No API key is passed by the PoC. Authentication is inherited by the Codex CLI
from its officially supported local ChatGPT sign-in when one is available.

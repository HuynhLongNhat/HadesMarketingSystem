# SIWC integration decision record

## Status

**Blocked for active ChatGPT Plan inference.** This record prepares Nova AI
Solutions to adopt Sign in with ChatGPT (SIWC) only after OpenAI approval and a
compliant user-controlled execution runtime are available.

## Confirmed requirements

OpenAI's SIWC Terms require persistent authentication tokens to remain local
and under the user's control. ChatGPT Plan requests must originate from the
user's local runtime, or a remote runtime only that user controls. Background
use requires express consent. A shared Nova BullMQ worker is not a
user-controlled runtime, so it must not receive or use SIWC tokens.

SIWC identity and ChatGPT Plan inference are distinct: a valid OpenID Connect
identity connection does not grant `chatgpt.tokens.use.direct` or permission to
make inference requests. Commercial partner availability is a limited trial and
requires a registered OAuth client/approval. Plan usage must be available to
users without a Nova payment or upgrade, cannot be pooled/shared/resold, and
continues to be subject to user plan eligibility and limits.

Sources (checked 2026-11-15):

- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/website
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://openai.com/policies/sign-in-with-chatgpt-terms/

## Current architecture

- Better Auth establishes Nova sessions and organization membership.
- `ai_provider_connections` holds organization-owned encrypted API keys.
- `TaskAiExecutionService` decrypts an organization provider key and calls the
  provider from the shared BullMQ worker.
- CEO Planning creates an `ai_tasks` row, persists immutable CEO context, then
  enqueues that task. Retry creates a child plan using the original snapshots.
- The existing shared worker is appropriate for API-key providers, but is not
  permitted to hold SIWC authentication tokens under the current SIWC terms.

## Preparation implemented

`ceo_plans.execution_source` snapshots the execution routing decision without
storing credentials. Current supported value is `api_provider` and contains:

- organization ID and requesting Nova user ID;
- provider connection ID and model ID;
- schema version.

Existing plans remain readable with a null source snapshot. Retries reuse a
valid existing source snapshot; legacy plans create a new `api_provider`
snapshot. The API rejects `chatgpt_plan` fail-closed. The UI explains that
ChatGPT Plan is unavailable and does not show a connect/test action.

## Future approved design

1. Obtain an OpenAI SIWC client registration and approval for Nova's exact
   commercial use case.
2. Keep Better Auth as Nova identity; link the verified OpenAI `issuer + sub`
   to a Nova user only through OAuth/OIDC with PKCE, state, nonce, issuer,
   audience and consent validation.
3. Store authentication tokens only in a user-controlled local runtime. Do not
   store tokens, refresh tokens, client secrets or ChatGPT credentials in Neon,
   Redis, BullMQ payloads, logs, or Nova cloud secrets.
4. A user-controlled runtime requests Responses API inference with the required
   SIWC scope, `store: false`, streaming and the approved request contract.
   It validates CEO structured output locally, then sends only the validated
   result and safe metadata to Nova through an authenticated, scoped result
   delivery API.
5. Each request must be initiated by that authenticated user or an automation
   for which they provided express consent. Retry/cancel must preserve the same
   source and authorization context; no fallback to an API-key provider.

## Security boundaries

- Never use Codex CLI sessions as SIWC credentials.
- Never expose a public endpoint that can invoke a user's ChatGPT plan.
- Never use one user's plan for another user's request.
- A plan/result query remains organization-scoped through existing Better Auth
  and permissions; source metadata is scoped by the same `ceo_plans` row.
- Connection state must not reveal another user's OpenAI identity or token
  status.

## Open questions before activation

1. Is Nova accepted into the commercial SIWC trial for identity, Plan usage, or
   both?
2. Which remote runtime pattern will OpenAI confirm as user-controlled for this
   product? Nova-hosted per-user containers must not be assumed compliant.
3. Which model IDs, structured-output features, streaming fields and background
   execution rules are enabled for the issued client/scopes?
4. What consent record and renewal/revocation contract does OpenAI require for
   CEO Planning background retries?

Until all four are resolved, `chatgpt_plan` remains unavailable.

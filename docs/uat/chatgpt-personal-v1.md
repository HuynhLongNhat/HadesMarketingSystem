# ChatGPT personal V1 — feasibility and acceptance gate

## Goal
Support ordinary ChatGPT Free/Plus/Pro users without requiring an OpenAI API key, while preserving the existing Hades Task/Agent services.

## Verified limitations (OpenAI Help Center, November 2026)
- Custom remote MCP write/modify tools are currently documented as full MCP for Business and Enterprise/Edu.
- Pro personal can use read/fetch custom MCP in supported developer flows; do not promise create-task access.
- Free and Plus personal custom MCP write eligibility is not established.
- A ChatGPT subscription does not grant arbitrary API usage for Hades workers.
Sources:
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt

## Existing code audit
- apps/api/src/integrations/mcp/hades-mcp.controller.ts is an internal JSON-RPC adapter, not a remotely interoperable MCP server. It uses Better Auth session cookies.
- Existing AgentsService and TasksService already implement the business operations.
- No OAuth authorization-server discovery, bearer token validation, remote transport interoperability or user consent screen has been implemented.
- Do not publicly expose this endpoint or label it connected.

## Next implementation gates
1. Test eligibility on a real personal ChatGPT account. Record which tools and permissions are available.
2. Add a standards-compliant remote MCP transport with OAuth and explicit organization-scoped authorization. Reuse existing Hades authentication and permissions; no static keys in frontend or .env user settings.
3. Build connection/revoke UI only after actual token flow is implemented.
4. If write actions are unavailable on personal plans, build a user-confirmed handoff/import workflow in Hades, without scraping ChatGPT sessions or automating the consumer UI.
5. Test cross-organization isolation, token expiry/revocation, task idempotency, quotas, and unauthorized requests. Run build, tests, and browser UAT before claiming ready.

## Acceptance
- Free, Plus, Pro separately report Supported / Read-only / Unsupported, based on real tests.
- Never show a green Connected status until OAuth and an authenticated MCP call succeed.
- No changes to existing Task/Agent execution logic.

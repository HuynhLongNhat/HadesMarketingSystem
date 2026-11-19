# Hades MCP foundation — scope and UAT

## Scope
This is an **authenticated internal JSON-RPC/MCP tool adapter**, reusing AgentsService and TasksService. No new agent runtime, model API key or task database. Supports initialize, ping, tools/list and tools/call with four tools.

**Not yet a ChatGPT remote MCP connector:** this endpoint uses the existing Better Auth browser session cookie. Remote ChatGPT requires a supported HTTPS endpoint, OAuth authorization-server discovery, token validation, consent, transport negotiation and compatibility testing. Do not expose this cookie-auth endpoint publicly as a remote connector.

## Manual UAT
1. Run API and log into the Hades web app, selecting an organization.
2. With a valid same-origin authenticated browser session, POST JSON-RPC to /integrations/mcp: initialize; tools/list; tools/call for hades_list_agents.
3. Verify a read-only organization member cannot call hades_create_task.
4. As an authorized user, call hades_create_task with a real agentId and verify the task appears in the existing task list and Worker queue.
5. Call hades_get_task for that ID; verify an ID from another organization cannot be read.
6. Verify unauthenticated requests receive 401, invalid arguments fail, and unknown tool names are rejected.
7. Run pnpm check-types, pnpm --filter @workspace/api build, and existing tasks integration tests.

## Deferred
- Remote ChatGPT OAuth + HTTPS transport and tool-write approval
- Research import into Market Intelligence (not a task re-run)
- Web integration management UI and audit log
- Idempotency key for task creation, rate limits, per-tool scopes
- Browser UAT and CI verification

No environment variable is introduced for MCP settings.

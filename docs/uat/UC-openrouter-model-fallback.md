# UC — OpenRouter free-model fallback (opt-in)

## Context
Research tasks use the Agent's saved provider and primary model. Both the
research decision and generation calls previously submitted a single model ID.
A 404 is **not proof of exhausted quota**: it can also mean the selected model
is no longer available or has an invalid identifier.

## Configuration
Set the following variable in the **API/Worker environment** (restart Worker):

```dotenv
OPENROUTER_TASK_FALLBACK_MODELS=vendor/backup-one:free,vendor/backup-two:free
```

Use actual model IDs currently offered by OpenRouter. These example IDs are
placeholders, **not** valid models. The server accepts only backup IDs ending
in `:free`, removes duplicates, and caps the ordered list to five including
the Agent's primary model. The Agent's primary model remains unchanged.
If the primary model is paid, it can still incur charges; configure a
`:free` primary model as well for a free-only task.

This setting is a temporary server-level opt-in, not a per-Agent UI control.
It does not provide cross-provider fallback or guarantee a successful request.
OpenRouter must support the specified models and the account must have quota.

## Manual UAT
1. Configure an OpenRouter connection and a currently available free primary
   model on Research Agent.
2. Set two verified `:free` backup IDs in the Worker environment; restart.
3. Submit a task through Assistant. Confirm research decision and generation
   can complete and return a saved report.
4. Use a known unavailable primary model (in a development environment only)
   with valid backups; confirm OpenRouter attempts the fallback.
5. Remove the environment variable and confirm requests revert to a single
   model.
6. Check that no paid backup ID is accepted. Verify usage/credits in the
   OpenRouter account dashboard.

## Limitations / pending
- The runtime currently records the requested primary model, not necessarily
  the actual model used by OpenRouter. Accurate attribution requires response
  metadata handling and further changes.
- No UI for editing the fallback list yet.
- No build, integration test or live-provider UAT has been run by this PR.

# Agent API authentication

The agent-facing endpoints `POST /api/walrus/store` and `POST /api/walrus/recall` require a bearer key whenever `RECALLLOOP_API_KEYS` is configured. The variable is a JSON object mapping each logical agent ID to a high-entropy secret of at least 32 characters:

```sh
export RECALLLOOP_API_KEYS='{"support-agent-prod":"REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS"}'
```

Generate secrets using a cryptographically secure generator, keep them in deployment secrets, and never commit them or expose them to browser code. Send `Authorization: Bearer <key>`. The request body's `agentId` must exactly match the key's configured agent ID; one agent's key cannot store or recall under another agent ID.

In `NODE_ENV=production`, missing key configuration fails closed with HTTP 503. In local development only, missing configuration leaves these prototype endpoints unauthenticated. Never expose that development mode to an untrusted network.

```sh
curl -X POST http://localhost:3000/api/walrus/recall \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_AGENT_KEY' \
  -d '{"agentId":"support-agent-prod","query":"provider timeout"}'
```

## Dashboard and control route authentication

The developer-console/control endpoints use a separate admin key: `GET /api/walrus/state`, `GET /api/walrus/blob/{blobId}`, `POST /api/walrus/task/outcome`, `POST /api/walrus/plan/generate`, and `POST /api/walrus/slice/run`.

Set a separate high-entropy secret (at least 32 characters):

```sh
export RECALLLOOP_ADMIN_API_KEY='REPLACE_WITH_A_DIFFERENT_RANDOM_SECRET_AT_LEAST_32_CHARACTERS'
```

Send it as `Authorization: Bearer <admin-key>` from a trusted server-side client. Do not put this key in `src/App.tsx`, browser JavaScript, or any public frontend configuration. In production, these routes fail closed with HTTP 503 if the admin key is missing. To operate the browser dashboard in production, put it behind an authenticated reverse proxy or implement a proper session-based admin login; do not expose the admin key to the browser. Local development without an admin key remains convenient but is not safe for untrusted network exposure.

## Scope and remaining limitations

- Agent keys protect only `POST /api/walrus/store` and `POST /api/walrus/recall`; the separate admin key protects the dashboard/control routes listed above.
- Key configuration is re-read per request to allow deployment-managed key rotation without restarting the process.
- Rate limiting, key revocation/audit logs, and managed multi-instance key storage are not implemented.

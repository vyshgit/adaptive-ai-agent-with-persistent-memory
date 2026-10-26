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

## Scope and remaining limitations

- This middleware protects only `POST /api/walrus/store` and `POST /api/walrus/recall`. Other dashboard/control endpoints are not covered and must not be treated as production-secure.
- Key configuration is re-read per request to allow deployment-managed key rotation without restarting the process.
- Rate limiting, key revocation/audit logs, and managed multi-instance key storage are not implemented.

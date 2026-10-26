# RecallLoop API (prototype)

RecallLoop is designed as agent-independent memory middleware. External agents call the HTTP API; the web dashboard is an optional developer console.

## Store an experience

`POST /api/walrus/store`

```json
{
  "agentId": "support-agent-prod",
  "title": "Refund workflow timed out",
  "taskTitle": "Process a refund request",
  "outcome": "failed",
  "feedback": "The provider timed out after the request was submitted.",
  "plannedDurationMinutes": 5,
  "lesson": "Check the provider's request status before retrying.",
  "metadata": {
    "conversationId": "conv-123",
    "tags": ["payments", "timeout"]
  }
}
```

A successful response includes `memory.blobId`, the Walrus blob identifier. Keep this identifier if your agent needs to retrieve that exact memory later. The API returns HTTP 502 when the Walrus write fails or no blob ID is returned.

`agentId` is required and scopes memories to a logical agent. Use a stable, non-secret identifier; do not use an end-user's private data as the identifier.

## Recall relevant experiences

`POST /api/walrus/recall`

```json
{
  "agentId": "support-agent-prod",
  "query": "provider timeout before retrying refund",
  "limit": 5
}
```

The service ranks indexed memories using simple keyword overlap and returns the highest-scoring matches. A query with no matching terms returns an empty list. The metadata index is written to `data/memories.json` by default; set `RECALLLOOP_DATA_DIR` to a persistent writable volume path in deployment.

## Retrieve a known blob

`GET /api/walrus/blob/{blobId}`

Use the exact `blobId` returned by a successful store operation.

## Current limitations (important)

- **The metadata index is file-backed, not a managed database.** It survives process restarts when the data directory is retained. Container filesystems may be ephemeral, so set `RECALLLOOP_DATA_DIR` to a persistent mounted volume in deployment. This prototype index is intended for a single server process; it does not coordinate concurrent writes across multiple server instances.
- Recall is lexical, not semantic. MemWal is installed but not yet integrated into this retrieval path.
- The API does not yet authenticate callers or enforce per-agent access control. Run it only in a trusted development environment; do not expose it as a public multi-tenant service until authentication, authorization, rate limits, and request-size limits are implemented.
- This is a prototype contract, not a production SLA. Configure the publisher and aggregator for the same Walrus network.

## Next implementation milestone

Move the file-backed index to a managed database/object index suitable for multiple instances. Then add semantic retrieval, end-to-end restart-persistence tests against Walrus, and API authentication. A useful acceptance test is: store a memory, restart the server, and retrieve it using the same agent ID and a related query.

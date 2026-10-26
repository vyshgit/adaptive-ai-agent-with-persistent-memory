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

The prototype ranks indexed memories using simple keyword overlap and returns the highest-scoring matches. A query with no matching terms returns an empty list.

## Retrieve a known blob

`GET /api/walrus/blob/{blobId}`

Use the exact `blobId` returned by a successful store operation.

## Current limitations (important)

- **Walrus stores the memory payload, but the recall index is currently in process memory.** The index is lost when the server restarts. Blob contents remain on Walrus for their configured storage lifetime, but the service cannot discover all blobs for an agent after a restart yet.
- Recall is lexical, not semantic. MemWal is installed but not yet integrated into this retrieval path.
- The API does not yet authenticate callers or enforce per-agent access control. Run it only in a trusted development environment; do not expose it as a public multi-tenant service until authentication, authorization, rate limits, and request-size limits are implemented.
- This is a prototype contract, not a production SLA. Configure the publisher and aggregator for the same Walrus network.

## Next implementation milestone

Replace the process-local metadata index with a durable index that maps `agentId` to Walrus blob IDs and metadata. Then add semantic retrieval, automated restart-persistence tests, and API authentication. A useful acceptance test is: store a memory, restart the server, and retrieve it using the same agent ID and a related query.

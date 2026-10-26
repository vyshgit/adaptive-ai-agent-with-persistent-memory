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

## Dashboard state visibility

`GET /api/walrus/state` is intended for the developer console and returns demo/dashboard memories, not agent-owned memory content. Agent-owned memories are retrieved through the authenticated recall endpoint.

## Authentication

Configure agent and admin keys as described in [API authentication](AUTHENTICATION.md). In production, store/recall fail closed if `RECALLLOOP_API_KEYS` is missing, and dashboard/control routes fail closed if `RECALLLOOP_ADMIN_API_KEY` is missing. Keep both keys in deployment secrets, never in browser code or the repository. The dashboard needs a trusted reverse proxy or a proper session-based admin login in production; do not embed the admin key in the frontend.

## Current limitations (important)

- **The metadata index is file-backed, not a managed database.** It survives process restarts when the data directory is retained. Container filesystems may be ephemeral, so set `RECALLLOOP_DATA_DIR` to a persistent mounted volume in deployment. This prototype index is intended for a single server process; it does not coordinate concurrent writes across multiple server instances.
- The API still uses lexical retrieval. MemWal is installed but not integrated into the production retrieval path. `npm run benchmark:retrieval` runs a small lexical smoke test; `npm run evaluate:retrieval` reports Recall@3, MRR, hard-negative rate, and cross-agent leakage on synthetic labelled paraphrases. `server/vector-retrieval-candidate.mjs` defines an injectable cosine-similarity candidate, but it is not wired into the API. `server/openai-embedding-provider.mjs` adds an OpenAI-compatible adapter defaulting to `text-embedding-3-small` with 384 dimensions; configure `OPENAI_API_KEY`, optionally `RECALLLOOP_EMBEDDING_MODEL` and `RECALLLOOP_EMBEDDING_DIMENSIONS`. Run `npm run evaluate:vector` to call the real embeddings API and compare results on the same synthetic labelled cases. This requires a valid API key and incurs API usage costs; it is not part of CI. The automated provider tests mock HTTP responses, and the controlled-vector candidate tests validate mechanics only. Production recall remains lexical until real-model results are reviewed.
- Agent API authentication covers store/recall, and separate admin-key authentication covers dashboard state, blob retrieval, task outcomes, plan generation, and slice execution. Rate limiting, session-based dashboard login, audit logs, and managed multi-instance key storage are not implemented; do not treat this prototype as production-ready.
- This is a prototype contract, not a production SLA. Configure the publisher and aggregator for the same Walrus network.

## Next implementation milestone

The first real-provider adapter and evaluation command are checked in. Run both `npm run evaluate:retrieval` and `npm run evaluate:vector` with a configured key, record model, metrics, latency, and API cost, and expand the labelled set before deciding whether to integrate vector retrieval. For the provider contract, see the [OpenAI embeddings documentation](https://developers.openai.com/api/docs/guides/embeddings). For deployment beyond one server process, replace the file-backed index with a transactional shared store. A full end-to-end Walrus store/restart/recall test still requires a controlled publisher fixture or test seam; the current process-restart test verifies the local metadata index only. Agent routes and dashboard/control routes have separate authorization middleware, but rate limiting, session-based dashboard login, audit logs, and multi-instance key storage remain unfinished.

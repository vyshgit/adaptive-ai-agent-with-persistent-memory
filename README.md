# RecallLoop

RecallLoop is an agent-independent memory middleware prototype. External agents interact with the backend over HTTP; the web dashboard is an optional developer console for inspection and debugging.

## Architecture

- **Agent-facing API:** store an experience, recall relevant experiences for a named agent, and retrieve a known Walrus blob.
- **Persistence:** experience payloads are written to Walrus. A separate file-backed metadata index maps agent IDs to stored memory records so recall can discover them after a process restart.
- **Developer console:** displays memory and task activity; it is not required for an external agent to integrate.
- **Current retrieval:** keyword-overlap ranking. The MemWal package is installed but not integrated into semantic retrieval yet.

## Quick start

Requirements: Node.js 20+ and a configured Walrus publisher/aggregator that use the same network.

```bash
npm install
npm run dev
```

The server listens on port 3000 by default. The default Walrus endpoints target Testnet. Configure `WALRUS_PUBLISHER_URL` and `WALRUS_AGGREGATOR_URL` together if using different endpoints.

The metadata index defaults to `data/memories.json`. For deployments, set `RECALLLOOP_DATA_DIR` to a writable persistent volume. If the hosting platform uses an ephemeral filesystem, memories will still be stored on Walrus, but the service's discovery index can disappear when the instance is replaced.

## External agent example

See [docs/API.md](docs/API.md) for request/response details and [examples/python/quickstart.py](examples/python/quickstart.py) for a standard-library Python example.

Store a memory:

```http
POST /api/walrus/store
Content-Type: application/json

{
  "agentId": "support-agent-prod",
  "title": "Provider timeout",
  "outcome": "failed",
  "lesson": "Check provider request status before retrying."
}
```

Recall by query:

```http
POST /api/walrus/recall
Content-Type: application/json

{
  "agentId": "support-agent-prod",
  "query": "provider timeout before retrying",
  "limit": 5
}
```

## Tests

```bash
npm run test:memory
npm test
```

GitHub Actions runs the memory-index tests on pushes to the development branch and pull requests.

## Prototype limitations and safety

- The metadata index is file-backed and designed for a single server process, not concurrent multi-instance deployment.
- Recall uses lexical matching, not semantic embeddings.
- The API currently lacks caller authentication and per-agent authorization. Do not expose it as a public multi-tenant service until authentication, authorization, rate limiting, request-size limits, and operational controls are implemented.
- A successful Walrus write and a durable metadata-index write are separate operations. If the second fails, the API returns an error with the blob ID so the caller can reconcile the stored blob.
- The dashboard includes illustrative bootstrap data. Agent-scoped recall only considers memories carrying the requested agent ID.

# RecallLoop API

Three independent surfaces share one Express process:

| Surface | Identity and configuration |
| --- | --- |
| `/api/agent/*` | Signed wallet session (or explicit offline demo); isolated user credentials. |
| `/api/memory/*` | External agent/admin bearer keys; operator environment memory configuration. |
| `/api/walrus/*` | Preserved legacy publisher/index API; not the wallet memory backend. |

See [authentication](AUTHENTICATION.md) before exposing any route remotely. Examples are
request contracts, **not live storage evidence**. JSON bodies are limited to 1 MB on the
workspace/new-memory routers; the legacy parser remains 32 KB. Compressed workspace bodies
are rejected. `GET /api/health` reports process health, not provider readiness.

## Wallet workspace — `/api/agent`

All requests pass the origin/operator-token policy. An operator bearer token does not
replace wallet login. After login/demo, obtain `sessionTag` from `/auth/session` and send
**`X-RecallLoop-Session: <sessionTag>`** with the session cookie on protected and
session-changing requests. A stale tag returns `409 session_changed`; reload identity
before sending conversation/project data. The UI handles binding automatically.

### Authentication routes

| Method | Path | Body / purpose |
| --- | --- | --- |
| GET | `/auth/session` | Public session state; no key or cookie value returned. |
| POST | `/auth/challenge` | `{ "address": "0x…" }`; single-use, five-minute personal-message challenge. |
| POST | `/auth/verify` | `{ "address": "0x…", "challengeId": "…", "signature": "…" }`; verify exact Sui signature and rotate cookie. |
| POST | `/auth/demo` | `{}`; explicit one-hour, isolated mock session when enabled. |
| POST | `/auth/logout` | `{}`; drop credentials/session and abort attached requests. |

Session state contains `authenticated`, `demo`, `address`, `agentId`, `sessionTag`,
`expiresAt`, and `demoAvailable`. Login issues an httpOnly, SameSite=Strict cookie scoped to
`/api/agent`; HTTPS uses Secure. Merely submitting an address never authenticates a wallet.

### Connections and status

All remaining routes require a live, bound wallet/demo session. Browser callers do **not**
choose `agentId`; the server derives it from the signed wallet or demo identity.

| Method | Path | Body / result |
| --- | --- | --- |
| GET | `/status` | Identity/auth, public LLM configuration, memory health, Tatum/delegate verification, coding limits. |
| GET | `/models` | Array of `{ id, label }` from the session's bounded model list. |
| POST | `/connect` | Model connection below; returns key-free `connection`. |
| POST | `/verify` | `{ "checkCapabilities": false, "toolsEnabled": true }` (optional booleans); recheck the saved live model credential. |
| POST | `/disconnect` | `{}`; remove model connection without owner-key fallback. |
| POST | `/connections/tatum` | `{ "apiKey": "…" }`; verify a Sui Mainnet checkpoint with this user's key. |
| POST | `/connections/memwal` | `{ "accountId": "0x…", "delegateKey": "…" }`; Tatum must be connected first. |
| POST | `/connections/tatum/verify` | `{}`; fresh checkpoint read with the saved session key. |
| POST | `/connections/memwal/verify` | `{}`; recheck account owner and signed delegate access using saved session credentials, without writes. |
| POST | `/connections/tatum/disconnect` | `{}`; remove Tatum and its dependent memory connection. |
| POST | `/connections/memwal/disconnect` | `{}`; remove memory connection, not stored remote records. |
| GET | `/chain` | Checkpoint/account-object observation and an explicit storage-proof warning. |

Live model connection:

```json
{
  "mode": "live",
  "baseUrl": "https://agentrouter.org/v1",
  "apiKey": "YOUR_MODEL_KEY",
  "model": "EXACT_MODEL_ID_FROM_YOUR_ACCOUNT",
  "apiStyle": "responses",
  "toolsEnabled": true,
  "checkCapabilities": false
}
```

Use `apiStyle: "chat"` for Chat Completions providers. HTTPS hosts are allowlisted; custom
hosts require `AGENT_LLM_ALLOWED_HOSTS`. Redirects, URL credentials, query strings, and
arbitrary remote/private hosts are refused. Development loopback model servers are
supported on another port; production requires `AGENT_LLM_ALLOW_LOCAL=true`. Loopback
refers to the **RecallLoop server**, not a user's PC.

`{ "mode": "mock" }` selects a scripted model without changing memory mode. Demo sessions
cannot submit live credentials. Discovery falls back to the entered model only for an
unsupported discovery route. `/connect` stages credentials until one small non-streamed
coding generation succeeds (up to 256 output tokens; provider costs apply). `/models`
success **never** sets `verified`. Public `verification` records the checked model,
protocol, time, discovery availability, generation, streaming, and tools. Optional
`checkCapabilities: true` adds a streaming check and, if tools are enabled, a forced dummy
function-call check. Neither executes tools or writes memories; unchecked capabilities
remain `not_checked`. Capabilities apply only to that model/protocol, not the entire list.
A failed candidate cannot replace the saved connection. Failed `/verify` keeps its key
but exposes `lastVerificationFailure` and clears the current verified indicator.
AgentRouter authorization errors are never bypassed; see [provider setup](./PROVIDER_SETUP.md).

MemWal connection checks the official Mainnet deployment, account ID/type, Shared object's
JSON `owner`, signed-in address, healthy/write-ready relayer, and signed delegate metadata
access via SDK `listNamespaces()`. Public health alone is not authorization.

### Memory actions

| Method | Path | Body / result |
| --- | --- | --- |
| GET | `/memory` | `{ status, inventory }`, confirmed records and recent-write hints. |
| POST | `/remember` | `{ "text": "I prefer npm.", "tier": "profile" }`; confirmed blob record. Default tier: `facts`. |
| POST | `/memory/seed` | `{ "confirm": "seed-mainnet" }`; 12 synthetic writes, re-read inventory, verification result, public key, checkpoint. |
| POST | `/memory/restore` | `{}`; bounded restore of three namespaces, inventory, warning. |

Direct remembering accepts 20,000 characters; UI/tool teaching limits are 2,000. Seed
requires the official healthy production relayer, explicit Mainnet, write readiness, and
confirmation. It does not write a repository evidence file; use the opt-in CLI exporter.
`success: false` means the required verification is incomplete even if some writes
succeeded. Restore is capped at 20 per namespace and does not promise full recovery/replay.

### Chat request

`POST /api/agent/chat`:

```json
{
  "sessionId": "session-1",
  "message": "Fix greet for empty names using my preferences.",
  "history": [],
  "model": "gpt-6.1-sol",
  "mode": "build",
  "stream": true,
  "capture": true,
  "occurredAt": "2026-11-08T14:00:00.000Z",
  "project": {
    "name": "Selected project",
    "activeFile": "src/greet.ts",
    "files": [{ "path": "src/greet.ts", "content": "export const greet = () => 'hello'\n" }]
  }
}
```

- Required `sessionId`: up to 128 characters, `[A-Za-z0-9._:-]`. Required `message`: up to
  4,000 characters. Model must be in the connected list and defaults to its selected model.
- `mode`: `talk`, `plan`, or `build` (default). `stream` and `capture`: booleans, default
  true. Optional `occurredAt` must be UTC ending in `Z`; preserve it on raw-write retries.
- `history`: user/assistant only, up to 200 submitted entries / 20,000 characters per entry.
  Keep at most 20 previous entries; previous content plus the new message is capped at
  12,000 characters before generation.
  Client-supplied system/tool history is refused.
- Optional `project`: at most 64 safe relative text files, 20,000 characters each / 160,000
  total. Only selected files are sent by the UI. No server filesystem path, persistent
  upload, shell execution, or automatic project export occurs.
- Capture off disables automatic turn capture and the model's `remember` tool; explicit
  UI teaching/outcome routes are independent writes.

### SSE protocol

Streaming uses `text/event-stream; charset=utf-8`, no-cache/no-transform, and
`X-Accel-Buffering: no`. Heartbeat comments occur every 15 seconds. Parse blank-line frames
across arbitrary byte boundaries; `EventSource` cannot submit this POST body.

| Event | Data / meaning |
| --- | --- |
| `memory` | `{ context, memories, strategy, tokenEstimate, memoryUnavailable }`; before generation, possibly refreshed after a recall tool. |
| `delta` | `{ text }`; redacted answer fragments. |
| `tool` | `{ id, name, args?, status, preview? }`; actual call ID, `running`, then `done`/`error`. |
| `proposal` | `{ id, path, before, after, baseHash, reason, status: "pending" }`; nothing applied. |
| `done` | `{ model, finishReason }`; answer finished, **not** memory confirmation. |
| `stored` | `{ verbatim, facts, failed, blobs, chainAnchor?, pending?, skipped?, message? }`; capture result after `done`. |
| `error` | `{ code, message, retryable }`; terminal generation/protocol failure; no later `done`. |

Keep reading after `done`. Capture waits at most 10 seconds on the response; `pending`
means SDK work may finish later, not that it succeeded. Capture failure is a `stored`
result, not failure of a completed answer. Only confirmed `done` writes with non-empty
blob IDs count. Inspect inventory before retrying accepted work.

Stop/disconnect aborts generation. An accepted capture can finish after disconnect; logout
destroys local services but cannot undo an accepted remote job. Output is capped at 40,000
characters. Provider 401/403 errors are not retried; explicit unsupported streaming may
trigger one non-streamed provider request. Incomplete Responses output is reported as
`finishReason: "length"`, not silently treated as complete.

`stream: false` returns `{ answer, memories, memory, tools, proposals, stored, model,
finishReason }` as JSON; generation failure is a non-2xx JSON error. Logout during an
active JSON turn ends it with `401 wallet_required`.

### Bounded tools and concurrency

Tools: `list_files`, `read_file`, `search_files`, `propose_file`, `recall_memory`, `remember`,
`sui_read`. Only Build exposes `propose_file`: full text replacements, never applied or
run server-side. `sui_read` allows checkpoint/object reads through fixed Tatum GraphQL
queries, not arbitrary queries or transactions.

Limits: 3 tool rounds, 4 calls per round, 6 proposals / 64,000 proposed characters, and
40,000 cumulative tool-result characters. Each tool has a 15-second turn deadline;
unsettled remote writes stay unconfirmed and hold SDK-write slots until they settle.

Workspace: 48 protected requests globally, 8 per session, 4 chats globally, and one chat or
mutating connection/memory-route operation per session. Up to 8 mutating route operations
run globally. Pending SDK writes: 8 globally / 2 per memory service, including after
disposal. These are not distributed scheduling or complete production abuse controls.

## External memory API — `/api/memory`

This service uses **operator environment credentials**, not wallet cookies/connections.
Agent routes bind `agentId` to its bearer key; GET inventory uses query `agentId`, other
agent routes use body `agentId`. Production fails closed; unconfigured development keys
are dev-open and must remain local. See [authentication](AUTHENTICATION.md).

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/ingest` | Agent |
| POST | `/recall` | Agent |
| GET | `/inventory?agentId=NAME` | Agent |
| POST | `/restore` | Agent |
| GET | `/status` | Admin |
| POST | `/seed` | Admin; operator `RECALLLOOP_AGENT_ID` scope |

Capture:

```json
{
  "agentId": "support-agent-prod",
  "sessionId": "session-1",
  "mode": "both",
  "occurredAt": "2026-11-08T14:00:00.000Z",
  "messages": [
    { "role": "user", "content": "Check provider status before retrying a timeout." },
    { "role": "assistant", "content": "Understood." }
  ]
}
```

`mode`: `both`, `verbatim`, or `facts`. Messages: 1–50, each at most 20,000 characters /
200,000 total, roles user/assistant/tool/system. Tool entries need a safe `name` up to 64
characters. Raw capture has provenance and SDK chunks of 20; facts analyze **user statements
only**. Raw batch keys are deterministic. Analysis deduplication is process-local, not
exactly-once across restarts. Keep `occurredAt` stable on retries of the same raw batch.

Ingest returns `{ success, stored: { verbatim, facts, failed }, blobs, chainAnchor }`.
Partial success: HTTP 200 with `failed > 0`; no confirmed success: HTTP 502. Idempotency
conflict: HTTP 409. The checkpoint is provenance, not storage proof.

Recall:

```json
{
  "agentId": "support-agent-prod",
  "query": "provider timeout before retrying",
  "limit": 8,
  "maxTokens": 800,
  "maxDistance": 0.8,
  "includeRaw": false
}
```

Query: required, at most 2,000 characters. Limit is clamped 1–20, token budget 64–4,000,
distance 0.01–2. Default scope: pinned recent profiles and relevant facts; raw is opt-in.
Hits are deduplicated by blob ID and budgeted. Response: `{ success, strategy, context,
memories, meta, chainAnchor }`; hits contain `blobId`, `text`, `distance`, `createdAt`, and
`tier` where available. Strategies: `semantic`, `mock-lexical`, `unavailable`. Failed recall
is HTTP 200 with empty/partial hits and `meta.error: "memory_unavailable"`, never invented
memories or a silent relayer-to-mock fallback.

Inventory returns `{ success, agentId, total, truncated, meetsHackathonMinimum, namespaces,
memories, recentWrites }`. It follows cursors/`has_more`, handles tombstones, excludes
unconfirmed/expired/wrong-scope records, and rejects resync or repeated/missing cursors.
The listing scan is capped at 2,000 records and 20 seconds; truncated counts are not
exhaustive. `meetsHackathonMinimum` requires 10+ confirmed non-mock blobs **and** verified
Mainnet status; large mock counts do not qualify.

`/status`: mode, health/write readiness, configured account, relayer URL/version, checked
time, namespaces. Mainnet requires the official URL, healthy `production` relayer mode,
and `WALRUS_NETWORK=mainnet`. `/seed`: `{ "confirm": "seed-mainnet" }`. `/restore`:
`{ "agentId": "…" }`, bounded as in the workspace.

## Legacy API — `/api/walrus`

The existing console and [Python example](../examples/python/quickstart.py) retain these
contracts. Testnet-default publisher/aggregator, file-backed lexical index; not MemWal
semantic retrieval or wallet namespaces.

| Method | Path | Auth / purpose |
| --- | --- | --- |
| POST | `/store` | Agent; experience with `agentId`, `title`, `outcome`, `lesson`, optional task/metadata fields. |
| POST | `/recall` | Agent; `{ agentId, query, limit }`, lexical retrieval. |
| GET | `/state` | Admin; demo/dashboard state, excludes external-agent memory content. |
| GET | `/blob/:blobId` | Admin; retrieve a known publisher blob. |
| POST | `/task/outcome` | Admin; legacy task feedback. |
| POST | `/plan/generate` | Admin; legacy plan generation. |
| POST | `/slice/run` | Admin; legacy workflow slice. |

Legacy store example (send the configured agent bearer key as described in
[authentication](AUTHENTICATION.md#external-agent-bearer-keys)):

```json
{
  "agentId": "support-agent-prod",
  "title": "Refund workflow timed out",
  "taskTitle": "Process a refund request",
  "outcome": "failed",
  "feedback": "The provider timed out after the request was submitted.",
  "plannedDurationMinutes": 5,
  "lesson": "Check the provider's request status before retrying.",
  "metadata": { "conversationId": "conv-123", "tags": ["payments", "timeout"] }
}
```

A store must return a real blob ID or fail with HTTP 502. A subsequent local-index write
can fail separately; preserve the returned blob ID for reconciliation. A successful store
returns `memory.blobId`; use that exact identifier when retrieving a known legacy blob.
Use a stable, non-sensitive logical `agentId`, and configure publisher and aggregator for
the same Walrus network.

The legacy index defaults to `data/memories.json`; `RECALLLOOP_DATA_DIR` selects its
directory. It only survives where that directory is retained and writable. The preview has
**no durable runtime filesystem**. New MemWal work does not write this index. It is intended
for one server process, not coordinated multi-instance writes.

### Parked legacy retrieval experiments

Legacy recall remains keyword-overlap ranking; queries with no matching terms return no
hits. `npm run benchmark:retrieval` runs a small synthetic lexical smoke test.
`npm run evaluate:retrieval` reports Recall@3, MRR, hard-negative rate, and cross-agent
leakage on synthetic labelled paraphrases. Both commands are credential-free and remain
in CI; expected paraphrase misses are a baseline, not a production quality claim.

The injectable cosine-similarity candidate in `server/vector-retrieval-candidate.mjs` and
OpenAI-compatible adapter in `server/openai-embedding-provider.mjs` are preserved research,
not the legacy API or wallet workspace retrieval path. The optional
`npm run evaluate:vector` uses separate operator environment configuration:

| Variable | Purpose / default |
| --- | --- |
| `OPENAI_API_KEY` | Required embedding-provider credential; never commit it. |
| `RECALLLOOP_EMBEDDING_MODEL` | `text-embedding-3-small`. |
| `RECALLLOOP_EMBEDDING_DIMENSIONS` | 384. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1`. |
| `RECALLLOOP_EMBEDDING_TIMEOUT_MS` | 15,000 milliseconds. |

Vector evaluation sends query and memory text to the configured provider and incurs API
usage costs. Run it only after explicit approval; do not use private or production content
without the required data-processing approval. It is **not run in CI** and does not reuse
browser credentials. The adapter rejects provider errors or invalid vectors/dimensions.
Automated provider tests mock HTTP responses; controlled-vector tests establish mechanics
only. Review real-model metrics, latency, and cost before integrating a semantic candidate.
Synthetic checks and local-index restart tests are not proof of a live Walrus
store/restart/recall flow or Mainnet durability.

## Errors and safety

JSON errors: `{ success: false, code, error, retryable }`; SSE errors use `message` instead.

| Code | Typical HTTP | Meaning |
| --- | --- | --- |
| `invalid_request` | 400 / 413 / 415 | Input/request-size limit or unsupported compression. |
| `unauthorized` | 401 / 403 / 503 | Origin/token/bearer policy or missing production configuration. |
| `wallet_required` | 401 / 403 | Missing/ended session or live credentials in demo. |
| `session_changed` | 409 | Stale tab; reload before sending data. |
| `invalid_challenge`, `invalid_signature` | 401 | Expired/replayed/mismatched proof. |
| `unsupported_wallet` | 400 | Unsupported local signature scheme. |
| `busy`, `memory_busy`, `memory_limit` | 429 | Request/write/mock-capacity limit. |
| `tatum_required`, `seed_refused` | 412 | Verification/confirmation prerequisite. |
| `account_mismatch`, `memory_unauthorized` | 403 / 502 | Wrong account or unverified delegate access. |
| `memory_not_configured`, `llm_not_configured` | 503 | No usable connection; no automatic mock fallback. |
| `memory_unavailable`, `inventory_resync`, `chain_unavailable` | 502 / 503 | Upstream/deadline/snapshot failure; recall degrades at HTTP 200. |
| `llm_failed` | 502 or SSE | Provider/protocol failure; inspect retryability. |
| `provider_*` | 502 or SSE | Sanitized key, client approval, quota, model, protocol, streaming/tools, network, timeout, or output diagnostic; see [provider setup](./PROVIDER_SETUP.md#sanitized-diagnostics). |
| `capture_failed` | 502 or `stored` | No confirmed memory; answer may have succeeded. |

Known-key redaction runs before prompts, capture, proposals, JSON, and SSE; it is
best-effort, not a general secret detector. Memories/files are untrusted context, not
privileged instructions. No model retraining, remote delete, full transcript recovery,
or production multi-instance readiness is claimed.

# RecallLoop action plan — Total Recall

Status: draft for review · Updated: 8 November 2026 · Submission deadline: 10 November 2026, 17:00 UTC

This plan turns the current prototype into the product described by the Total Recall brief:
an agent workspace that remembers everything, with Walrus Memory as the durable, semantic
store. It is scoped against the code in this repository at commit `0dc1a2a`, the installed
`@mysten-incubation/memwal` 0.1.10 package, and the platform rules in `AGENTS.md`.

The implementation prompt that accompanies this plan lives in
[IMPLEMENTATION_PROMPT.md](./IMPLEMENTATION_PROMPT.md). Treat that file as the build
contract and this file as the reasoning and scheduling document.

---

## 1. Decision summary

| Question | Decision |
| --- | --- |
| Is the "OpenCode Desktop-like agent UI" a good idea? | **Yes, with a narrower definition.** Build an agent workspace with a desktop-style layout (sessions rail, chat, memory rail), not a full coding-agent clone. |
| Native desktop app? | **No — web only (decided 8 November).** The workspace is a desktop-style **web** UI at `#/agent`. It runs in the same Express + Vite process, deploys with the existing preview, and needs no packaging, IPC, or separate key handling. Electron/Tauri is dropped entirely, not deferred. |
| Where does context live? | **Walrus is the memory source of truth.** The browser keeps a transcript cache for UI replay because the relayer has no ordered transcript API. Recall always comes from Walrus. |
| What makes the demo different? | Memory is visible: every answer shows which Walrus blobs influenced it, and a fresh browser still gets a personalised answer. |
| Which agent capabilities? | Chat, streaming, and a small read-mostly tool set (memory recall/remember, Tatum Sui read). No file editing, terminal, or diffs. |
| What is cut? | Embedding-provider experiments, vector candidate work, Bayesian hypotheses, multi-tenant hardening, Electron. |

### Why the UI idea is good enough — and where it is risky

**Good:** The hackathon rewards a visible learning loop, not infrastructure. A chat surface
is the clearest way to show a memory changing an answer. It also turns the existing
dashboard from "inspection console" into "product demo", and it gives the judges something
they can use in 60 seconds.

**Risky:** "OpenCode Desktop" implies a coding agent with file trees, diffs, terminals, and
tool execution. Reproducing that in roughly two and a half days while also shipping the
Mainnet memory layer is not realistic. The plan keeps the *layout and feel* and drops the
*coverage*. The memory loop, not the editor, is the product.

**Gating dependency:** a live LLM requires an OpenAI-compatible API key. The plan therefore
defines a deterministic `mock` LLM mode so the entire UI, streaming, and memory loop can be
built, tested, and demoed without credentials. Live mode is a configuration switch, not a
rewrite.

---

## 2. Product definition

> **RecallLoop is a drop-in memory layer and agent workspace: every session is captured,
> consolidated into durable facts on Walrus Mainnet, and recalled before the agent answers.**

Two surfaces share one memory layer:

- **Agent workspace (`/#/agent`)** — the product surface. Sessions, chat, streaming, visible
  memory.
- **Memory console (`/#/console`, today's `App.tsx`)** — the developer surface. Inventory,
  recall debugging, seed and restore controls.

External agents keep using the HTTP API. The workspace is a reference client, not a
privileged back door.

### What "remembers everything" means

Storing every raw message and semantically recalling all of them is not a product: recall
gets noisy, latency grows, and the agent drowns in its own logs. RecallLoop separates
capture from recall.

| Tier | Namespace | Content | Recall behaviour |
| --- | --- | --- | --- |
| Episodic | `rl:<agentId>:raw` | Every message, tool call, and result; timestamped and session-tagged | On demand, for audit and "what exactly happened" |
| Semantic | `rl:<agentId>:facts` | Durable facts extracted by `analyzeAndWait()`: preferences, decisions, lessons, corrections | Default; injected before each answer |
| Identity | `rl:<agentId>:profile` | Stable preferences and constraints | Always pinned |

Nothing is discarded. The prompt only receives what is relevant.

---

## 3. Current state audit

| Area | Today | Required |
| --- | --- | --- |
| Memory storage | `PUT /v1/blobs?epochs=1` against a **Testnet** publisher; two bootstrap blobs | `MemWal` relayer → encrypted, indexed, **Mainnet** writes |
| Discovery and index | `data/memories.json`, file-backed; `/data` is read-only in preview | Relayer vector index, `listMemories()`, `restore()` |
| Retrieval | Keyword overlap in `server/memory-retrieval.mjs` | Semantic `recall()` with `maxDistance` and `maxTokens` |
| Write path | Hand-entered "lesson" records | Automatic capture of messages, tool calls, and decisions |
| Mainnet proof | Zero verified writes | 12 seeded memories verified via inventory and recall |
| Tatum | `sui-checkpoint` and `status` only | Chain-anchored writes and an account panel |
| UI | One dashboard with in-memory demo state | Agent workspace plus a console backed by real inventory |
| LLM | None | OpenAI-compatible adapter with a deterministic mock mode |
| Blog post | Missing | Required deliverable |
| Retrieval research | Vector evaluation, embedding provider, benchmarks | **Parked.** MemWal owns embedding and indexing |
| Tests | 33 passing | Existing suite green, plus new unit and integration tests |

### Risks visible in the current code

- The bootstrap memories in `server/routes/walrus.mjs` carry hard-coded blob IDs and an
  ambiguous "Mainnet/Testnet" comment. Label them as demo data or replace them with real
  seeded records before submission.
- `MEMWAL_DELEGATE_KEY` and `MEMWAL_ACCOUNT_ID` are read but only reported in a status
  string. The UI advertises Walrus while the integration is inactive.
- The dashboard renders a "Walrus Mainnet Config" badge regardless of configuration. Badges
  must reflect verified state (`relayer` + health check, never `mock`).
- The global JSON body limit is 32 KB, which is small for chat history. Agent routes need
  their own parser before the global one (see the prompt).

---

## 4. Target architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Browser — Agent workspace (/#/agent)                                        │
│  sessions rail │ chat + streaming │ memory rail                             │
│  local: transcript cache (localStorage), model choice                       │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │  POST /api/agent/chat  (SSE)
                                │  GET  /api/agent/status, /models
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Express (single process, port 3000)                                         │
│                                                                              │
│  agent/llm.mjs      OpenAI-compatible client, live or deterministic mock     │
│  agent/tools.mjs    recall_memory · remember · sui_rpc (read-only allowlist) │
│  agent/prompt.mjs   system prompt + pinned profile + recalled context        │
│  memory/*.mjs       MemWal client, consolidation, context, chain anchor      │
│                                                                              │
│  /api/agent/*  → server-held agent identity (no keys in the browser)         │
│  /api/memory/* → external agents, bearer-key authenticated                    │
└───────────────┬───────────────────────────────┬──────────────────────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────────┐   ┌──────────────────────────────────────────┐
│ Walrus Memory relayer         │   │ Tatum Sui RPC (Mainnet)                  │
│ embed → SEAL encrypt →        │   │ checkpoint anchor, account balance,      │
│ Walrus Mainnet + vector index │   │ read-only onchain context                │
└───────────────────────────────┘   └──────────────────────────────────────────┘
```

### Why MemWal instead of the current publisher path

`MemWal` performs embedding, SEAL encryption, Walrus upload, vector indexing, and restore
within a single `owner + namespace` scope. Adopting it:

- satisfies the Mainnet requirement without running a wallet or publisher;
- removes the need for a local index, which cannot persist in this runtime;
- replaces lexical retrieval with semantic recall;
- provides `listMemories()` and `restore()` as evidence and recovery paths.

The legacy publisher path stays behind an explicit `legacy` mode so existing routes and
tests keep working.

---

## 5. Agent workspace UI specification

### Layout

```
┌───────────────┬────────────────────────────────────────────┬─────────────────────┐
│ Sessions      │  Chat                                      │  Walrus Memory      │
│               │                                            │                     │
│ + New session │  system banner: "Recalled 3 memories"      │  mode badge         │
│ ▸ Today       │  ┌──────────────────────────────────────┐  │  total / by tier    │
│   • Session 1 │  │ user                                 │  │  recent writes      │
│   • Session 2 │  ├──────────────────────────────────────┤  │  [Seed 12] [Restore]│
│               │  │ assistant (streaming)                │  │                     │
│               │  │ ▸ memory used (3)                    │  │  recalled for this  │
│               │  │ ▸ tool: recall_memory                │  │  turn:              │
│               │  └──────────────────────────────────────┘  │  • blob… distance   │
│               │  composer: model picker · send             │  • blob… distance   │
└───────────────┴────────────────────────────────────────────┴─────────────────────┘
```

### Screens and states

| Surface | Required states |
| --- | --- |
| Session rail | empty (first run), list, active, rename/delete, "clear local cache" |
| Chat | empty with suggested prompts, streaming, stopped, error with retry, tool card, memory chips |
| Composer | idle, sending, disabled while streaming, `Enter` sends / `Shift+Enter` newline |
| Memory rail | `relayer` (Mainnet), `mock`, `legacy`, unconfigured; loading; error; inventory counts |
| Status banner | "Recalled N memories before this session" / "No relevant memories yet" |

### Hero features (the things judges must see)

1. **Memory chips per answer.** Expandable list of recalled blobs with distance and a
   `blob_id` copy action. Proves the answer was grounded in Walrus.
2. **Fresh device demo.** A "Clear local cache" action keeps Walrus intact. After clearing,
   the session list is empty but the next answer still reflects stored preferences.
3. **Memory rail inventory.** Live counts by namespace from `listMemories()`, plus the
   Mainnet badge only when the relayer is healthy.
4. **Remember this.** A per-message action that writes the message as a `facts` memory,
   showing the returned `blob_id` inline.

### Transcript persistence — the honest limitation

The relayer exposes metadata listing (`GET /v1/owners/{owner}/memories`) but not an ordered
"fetch every message in a session" content API. The default client returns content only
through semantic `recall()`. Therefore:

- **P0:** transcripts are cached in browser `localStorage` (session metadata + messages,
  capped at 50 sessions and 200 messages per session). Walrus remains the source of truth
  for *memory*; the cache is explicitly labelled "this browser only".
- **Stretch:** one namespace per session plus `recall({ sort: "recent", limit: 100 })` to
  approximate replay. Only attempt after credentials exist and the behaviour is verified.
- **Never** claim the transcript itself is replayable from Walrus unless that spike passes.

This distinction is a feature in the demo, not a weakness: it shows local conversation
history and portable memory are different things.

### Visual rules

- Reuse the existing Tatum design tokens (`bg-primary`, `text-tertiary`, `border-secondary`,
  `rounded-xl`, `p-xl`, `shadow-xs`, …). No new palette, no hardcoded colours.
- Icons come from `lucide-react`, already a dependency.
- Desktop-first; collapse the right rail below `lg` and the session rail below `md`.
- Keyboard: `Cmd/Ctrl+K` new session, `Esc` stop streaming, focus trap in modals.
- Accessibility: `aria-live="polite"` for streaming text, labelled icon buttons, visible
  focus rings using `focus-visible:ring-focus-ring`.

---

## 6. Server API

### Memory routes (`/api/memory`, external agents)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/ingest` | agent | Capture messages as raw memories and extracted facts |
| `POST` | `/recall` | agent | Semantic recall, token budget, context block |
| `GET` | `/inventory?agentId=` | agent | Paginated inventory and hackathon minimum check |
| `GET` | `/status` | admin | Mode, relayer health, configured account |
| `POST` | `/seed` | admin | Write 12 curated Mainnet memories and return proof |

Contract details (request/response shapes, error codes) are in
[IMPLEMENTATION_PROMPT.md](./IMPLEMENTATION_PROMPT.md) §6. They are normative there.

### Agent routes (`/api/agent`, workspace)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/status` | same-origin/admin | LLM mode, model list, memory mode, agent identity |
| `GET` | `/models` | same-origin/admin | Allowlisted models for the picker |
| `GET` | `/memory` | same-origin/admin | Inventory and recent writes for the memory rail |
| `POST` | `/memory/seed` | same-origin/admin | Guarded seed of the 12 Mainnet memories |
| `POST` | `/chat` | same-origin/admin | SSE chat turn: recall → stream → capture |
| `POST` | `/remember` | same-origin/admin | "Remember this" for a single message |

The workspace never receives LLM or agent secrets. It talks to `/api/agent/*`; the server
holds `AGENT_LLM_API_KEY` and calls the memory layer in-process. In production, put
`/api/agent/*` behind the same authenticated proxy as the console.

### SSE protocol for `POST /api/agent/chat`

Request:

```jsonc
{
  "sessionId": "s-2026-11-08-a",
  "message": "Plan my integration work for tonight.",
  "history": [{ "role": "user|assistant", "content": "..." }],  // capped, client-owned
  "model": "vendor/model-id"
}
```

Event sequence:

```
event: memory
data: {"context":"...","memories":[{"blobId":"...","text":"...","distance":0.31}],"tokenEstimate":412}

event: delta
data: {"text":"Based on"}

event: tool                      # only when the model calls a tool
data: {"name":"recall_memory","args":{"query":"integration plan"},"status":"running"}

event: tool
data: {"name":"recall_memory","status":"done","preview":"3 memories"}

event: done                      # the answer is complete
data: {"model":"...","finishReason":"stop"}

event: stored                    # capture result; may arrive after `done`
data: {"verbatim":2,"facts":3,"failed":0,"blobs":[{"tier":"facts","blobId":"..."}]}

event: error                     # terminal on failure; no `done` follows
data: {"message":"...","code":"llm_failed","retryable":true}
```

Implementation rules:

- `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`,
  `X-Accel-Buffering: no`, `res.flushHeaders()`.
- Send a `: heartbeat` comment every 15 seconds.
- Abort upstream model and memory work when the client disconnects (`req.on('close')`).
- A failed capture must **not** fail the answer: emit `stored` with `failed > 0`.
- Provide a non-streaming JSON fallback (`stream: false`) in case the preview proxy buffers
  SSE.

### Tools exposed to the model

| Tool | Arguments | Behaviour |
| --- | --- | --- |
| `recall_memory` | `{ query, limit? }` | Calls the same recall path as the pre-answer injection; returns JSON hits |
| `remember` | `{ text, tier: "facts"\|"profile" }` | Writes one memory; returns `blobId` |
| `sui_rpc` | `{ method, params? }` | Read-only allowlist: `sui_getLatestCheckpointSequenceNumber`, `sui_getObject`, `suix_getBalance`, `suix_getOwnedObjects`, `suix_queryTransactionBlocks` |

Maximum three tool rounds per turn. Tool arguments must be validated server-side; reject
anything outside the allowlist.

---

## 7. Data, privacy, and security rules

1. **No secrets in the browser.** LLM key, delegate key, admin key, and agent API keys stay
   server-side. The workspace calls server routes only.
2. **No durable local storage on the server.** No SQLite, no JSON files, no uploads. Browser
   `localStorage` is allowed and explicitly labelled.
3. **Fail closed and tell the truth.** `relayer` mode without credentials returns
   `503 memory_not_configured`; the UI shows "Memory not configured", never "Mainnet".
4. **Provenance on every write.** Capture `{ sessionId, occurredAt, sourceRole, toolName?,
   checkpoint? }` so memories are auditable.
5. **Idempotency.** `sha256(agentId + sessionId + role + content)` prevents duplicate writes
   on retry.
6. **Redaction.** Never log memory text at info level. Never log keys. The credential guard
   already redacts `TATUM_API_KEY`; extend it to `MEMWAL_PRIVATE_KEY` and `AGENT_LLM_API_KEY`.
7. **Cross-agent isolation.** Recall always filters by the resolved agent identity. A test
   must prove agent A cannot see agent B.
8. **Right to forget.** The default MemWal client has no delete. Document that deletion is
   currently an on-chain/relayer operation and out of scope for P0; do not claim it.

---

## 8. Work plan

Estimates assume one developer and are deliberately pessimistic. "P0" is the submission
gate.

### P0 — must ship (about 22–26 hours)

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| 1 | MemWal client, mode detection, namespaces | `server/memory/memwal-client.mjs` | `relayer`, `mock`, `legacy`; never silently falls back; `getStatus()` |
| 2 | Consolidation and idempotency | `server/memory/consolidate.mjs` | Messages → timestamped raw items; facts transcript; stable keys; chunking |
| 3 | Context formatter | `server/memory/context.mjs` | Token-budgeted markdown block, no invented content |
| 4 | Tatum chain anchor | `server/memory/chain-anchor.mjs` | Checkpoint via `tatumRpc`; `null` on failure; never blocks a write |
| 5 | Memory routes + DI factories | `server/routes/memory.mjs` | Ingest, recall, inventory, status, seed per contract |
| 6 | LLM adapter, live + mock | `server/agent/llm.mjs` | Streaming deltas; deterministic mock; configurable base URL/model |
| 7 | Agent chat route + SSE | `server/routes/agent.mjs` | Recall → stream → capture; heartbeat; abort; fallback JSON |
| 8 | Workspace UI shell and chat | `src/agent/AgentApp.tsx`, `ChatPane.tsx`, `Message.tsx`, `useAgentSession.ts` | Streaming, stop, retry, memory chips |
| 9 | Session rail + local cache | `src/agent/SessionSidebar.tsx`, `src/agent/sessionStore.ts` | Create, rename, delete, clear cache, caps enforced |
| 10 | Memory rail | `src/agent/MemoryRail.tsx` | Mode badge, inventory, recent writes, seed/restore actions |
| 11 | Entry switch | `src/AppShell.tsx`, `src/main.tsx` | `#/agent` workspace, `#/console` existing dashboard |
| 12 | Tests | `tests/memory-*.test.mjs`, `tests/agent-*.test.mjs` | Unit + mock integration; existing 33 green |
| 13 | Seed + evidence | `scripts/seed-mainnet-memories.mjs`, `docs/MAINNET_EVIDENCE.md` | 12 real blob IDs, account, relayer version, checkpoint |
| 14 | Demo script | `scripts/memory-agent-demo.mjs` | Two sessions; second recalls facts from the first |
| 15 | Submission docs | `README.md`, `docs/MEMORY_API.md`, blog draft | Setup, architecture, learning story, evidence |

### P1 — scoring lift (about 6 hours)

- Tool-call cards and the three-tool allowlist.
- "Remember this" per message.
- Model picker backed by `/api/agent/models`.
- Tatum account panel (address + balance) in the memory rail.
- Restore button with a visible before/after count.
- Replace hard-coded bootstrap blobs with labelled demo data.

### P2 — optional and bonus

- x402 or MPP paid deep recall verified through Tatum Sui RPC ($500 Agent Payments award).
- Session-namespace transcript replay spike.
- Demo video and social post.

### Cut lines (in order)

1. Tool-call loop → keep the single pre-answer recall, drop `remember`/`sui_rpc` tools.
2. Session rail persistence → one session in memory, no cache.
3. Memory rail inventory → keep chips and the mode badge only.
4. Model picker → one configured model.

**Never cut:** 12 verified Mainnet writes, recall visibly changing an answer, the blog post,
and the public repo.

---

## 9. Timeline

| When | Work |
| --- | --- |
| Nov 8, morning | Get credentials (`MEMWAL_*`, `TATUM_API_KEY`, LLM key). Verify relayer health. Memory modules and routes in mock mode. |
| Nov 8, afternoon | LLM adapter, mock streaming, `/api/agent/chat`, SSE. |
| Nov 8, evening | Workspace shell, chat, streaming, memory chips. |
| Nov 9, morning | Session rail, memory rail, entry switch, responsive pass. |
| Nov 9, midday | Real seed of 12 Mainnet memories; capture evidence; live recall check. |
| Nov 9, afternoon | Tests, P1 items, bug pass, demo script. |
| Nov 10, morning | Blog post, README, screenshots, video. |
| Nov 10, 15:00 UTC | Freeze. Submit by 17:00 UTC. |

---

## 10. Test plan

| Layer | Test | Tool |
| --- | --- | --- |
| Unit | Mode selection, fail-closed behaviour, namespace sanitisation | `node:test` |
| Unit | Message normalisation, idempotency determinism, chunking, limits | `node:test` |
| Unit | Context formatting and token budget | `node:test` |
| Integration | Ingest → recall through `MemWalMock` | `node:test` + mock |
| Integration | Agent A cannot recall Agent B's memories | `node:test` + mock |
| Integration | Inventory pagination via an injected lister | `node:test` |
| Integration | SSE event order with a mock LLM | `node:test` |
| Regression | Existing 33 tests | `npm test` |
| Live smoke | Health, 12 writes, 3 recall queries, inventory, restore | Script against relayer |

`MemWalMock` does not implement `listMemories()`. Inventory takes an injectable lister so it
can be tested without credentials. Live checks require `MEMWAL_PRIVATE_KEY` and
`MEMWAL_ACCOUNT_ID` and are never part of CI.

---

## 11. Hackathon mapping

| Requirement or criterion | Covered by |
| --- | --- |
| Walrus Memory on Mainnet, 10+ writes | P0 items 1 and 13, `inventory.meetsHackathonMinimum` |
| Tatum RPC for onchain data | Chain anchor, `sui_rpc` tool, account panel |
| Blog post | P0 item 15, drafted 10 November at the latest |
| Working demo and public repo | Workspace UI, `memory-agent-demo.mjs`, README |
| 30% Walrus and Tatum integration | MemWal semantic memory plus chain anchor |
| 30% technical quality | Mode discipline, idempotency, partial-failure handling, tests |
| 20% creativity | Desktop-style workspace with visible, portable memory |
| 20% presentation | Fresh-device demo, memory chips, real blob evidence |
| $500 AI Builder | Optional; only if the shell is rebuilt in `ai.tatum.io` |
| $500 Agent Payments | P2 x402, only after P0 is green |

---

## 12. Decisions to confirm

1. **Web only — decided.** Desktop-style layout in the browser at `#/agent`; no Electron or Tauri.
2. **Namespace scheme.** `rl:<agentId>:facts`, `:raw`, `:profile`.
3. **Default recall scope.** Facts and profile; raw opt-in.
4. **Capture granularity.** Turn pairs plus tool results, not every token event.
5. **Transcript cache.** Browser `localStorage`, clearly labelled, with "clear cache"
   preserving Walrus.
6. **LLM provider — decided and probed.** AgentRouter, model `gpt-6.1-sol`.
   - Base URL: `https://agentrouter.org/v1`
   - Models endpoint: `https://agentrouter.org/v1/models`
   - **Generation endpoint: `https://agentrouter.org/v1/responses`.** Live probe confirms
     `gpt-6.1-sol` returns HTTP 400 on `/v1/chat/completions` and instructs the caller to
     use `/v1/responses`. The adapter must implement the Responses API.
   - Live model list: `gpt-5.6-sol`, `gpt-6.1-sol`, `gpt-6-astra`.
   - The gateway allowlists client fingerprints: plain `curl`/Node `fetch` gets
     `401 unauthorized_client_error` even with a valid key. Do not impersonate another
     client; demo with `RECALLLOOP_LLM_MODE=mock` unless AgentRouter allowlists the app.
7. **Seed content.** Expand the ten demo memories in
   `scripts/demo-memories.mjs` (worktree `agents/walrus-memory-integration-docs`) to twelve,
   or curate a new set.
8. **Product boundary.** External agents use `/api/memory/*`; the workspace uses
   `/api/agent/*` with a server-held identity.

---

## 13. Blockers

| Blocker | Impact | Action |
| --- | --- | --- |
| `MEMWAL_PRIVATE_KEY` and `MEMWAL_ACCOUNT_ID` absent | No Mainnet writes, no evidence | Create an agent at https://memory.walrus.xyz/dashboard and copy the delegate key |
| AgentRouter WAF rejects non-allowlisted clients | No live answers from the Express server, even with a valid key | Run the demo with `RECALLLOOP_LLM_MODE=mock`; optionally request an allowlist from AgentRouter support. Do not impersonate another client. |
| `TATUM_API_KEY` absent | No chain anchor or account panel | Create a key at https://dashboard.tatum.io |
| Preview runtime has no durable storage | Local index cannot survive restarts | Relayer index; `restore()` is the fallback |
| Preview proxy may buffer SSE | Streaming looks frozen | Send heartbeats and support `stream: false` |

---

## 14. Definition of done

P0 is done when all of the following are true:

1. `npm test` is green, including the existing 33 tests.
2. With no credentials, `RECALLLOOP_MEMORY_MODE=mock` and `RECALLLOOP_LLM_MODE=mock` run the
   full workspace loop: chat → recall → stream → capture → inventory.
3. With credentials, `npm run seed:memory` writes 12 memories to Walrus Mainnet and
   `GET /api/memory/inventory` reports at least 10 with real blob IDs.
4. A second session, after clearing local cache, answers using facts captured in the first
   session.
5. The memory rail reports Mainnet only when the relayer is healthy; otherwise it reports
   `mock`, `legacy`, or `unconfigured`.
6. `docs/MAINNET_EVIDENCE.md` contains blob IDs, timestamps, account ID, relayer version,
   and a Sui checkpoint.
7. The blog post, README, and public repository are ready before 10 November 17:00 UTC.

---

## 15. Build contract

The detailed, self-contained prompt for the implementing agent is
[IMPLEMENTATION_PROMPT.md](./IMPLEMENTATION_PROMPT.md). It contains the file map, verified
SDK signatures, API schemas, SSE protocol, UI states, environment variables, test commands,
and the reporting format. Hand that file to the agent unchanged; update this plan instead
if scope changes.

---

## Appendix A — MemWal account setup

Prerequisites: a Sui wallet on **Mainnet** with a small SUI balance for the account-creation
and delegate-key transactions.

1. Open <https://memory.walrus.xyz/dashboard> and connect the wallet.
2. Create the memory account (one per address) and approve the transaction.
3. Open **Delegate keys** and create a key labelled `recallloop-server`.
   - Copy the **public key**. That is the `MEMWAL_AGENT_ID` requested on the hackathon
     submission form.
   - Copy the **private key** (hex or `suiprivkey1...`). That is `MEMWAL_PRIVATE_KEY`. It is
     shown once; store it in deployment secrets, never in the repository or a chat.
4. Copy the account object ID (`0x...`) from the account panel. That is
   `MEMWAL_ACCOUNT_ID`.
5. Configure the server (see [IMPLEMENTATION_PROMPT.md](./IMPLEMENTATION_PROMPT.md) §8),
   then verify:
   ```bash
   curl -s https://relayer.memory.walrus.xyz/health
   npm run seed:memory
   ```
6. To rotate, remove the delegate key in the dashboard and add a new one. Memories written
   before removal stay readable by the old key until they are re-encrypted; treat rotation
   as a security event, not a routine action.

The key is only needed by the server. AgentRouter, the browser, and the implementing agent
never receive it.

# Workspace provider setup

RecallLoop has three independent connections in **Workspace settings → Model / Tatum / Walrus Memory**. Choose **Connect Wallet** and sign in with a Sui Mainnet account first; an address alone is not authentication. The single-use personal-message signature opens an isolated one-hour session. It is **not a transaction**, grants no spending permission, and does not authorize Walrus Memory. The wallet session dialog shows the full address/network, expiry, and disconnect progress/errors. Server logout finishes before optional extension permission removal; an extension decline cannot restore authentication.

Credentials are held in the trusted server process for that session, never inherited from the operator's `.env`. Password fields and redaction buffers use temporary tab memory. They are not written to browser caches, project downloads, prompts, or Walrus. Use localhost or HTTPS on a server you trust. Disconnect, expiry, logout, and server restart remove session credentials. Browser history/project caches are separate, unencrypted local conveniences; do not put unrelated secrets in chat or files.

## Model provider

Start in the **Model** tab. Select a provider to populate its API base and protocol, with official **Get an API key**, **Available models**, and **API documentation** links. Base/protocol fields are under **Advanced connection options**; custom APIs expose them immediately. Changing providers clears the unsent key/model fields rather than reusing unrelated credentials. Enter that provider's key and an **exact model ID available to your account**. IDs listed by `/models` are discovery results, not generation or tool guarantees.

**Connect & verify model** makes one small coding-generation request, limited to 256 output tokens, without your conversation, project, memory, or real tools. Provider billing and quotas apply. Streaming and function tools remain **not checked** unless you select **Also check streaming & enabled tools** under **Verification & tool options**. Those add up to two small requests: a streamed coding response and a forced, non-executing dummy function call. They do not run code, touch files, or write memories. Some reasoning models cannot produce an answer within the small check budget; this is reported as incomplete, not as verified.

Verification applies only to the checked model and wire protocol, not every discovered model. It is an observation at the displayed time, not a service-availability guarantee. Re-verification uses the saved session credential; a failed recheck is shown separately and removes the current verified indicator without discarding the saved key. A failed replacement never overwrites a working connection. Checks are user-initiated; there is no automatic polling, authentication retry, protocol switching, or approval bypass.

Normal turns are memory-first and default to Talk. With tools enabled, the selected model can
share a short proposed plan or ask an inline clarification; a question pauses the turn for
your real reply. Function-call verification proves only transport support, not that a model
will plan well, use memories correctly, or ask every necessary question. With tools disabled,
plans/questions use ordinary text. Build alone exposes review-required code proposals; no
provider choice adds shell, booking, or transaction access.

**Verify model**, **Reconnect model**, and **Disconnect model** operate independently of Tatum/memory. Submitted key fields clear after success, failure, or cancellation. **Cancel check**, Escape, and **Close & cancel check** can race a completed verification: saved connection status is refreshed even after the dialog closes, rather than claiming rollback. Late completions from an ended wallet workspace cannot install status in a new one. A failed workspace-token refresh is reported, not labeled unlocked.

| Provider | API base | Default protocol | Key/dashboard and official docs |
| --- | --- | --- | --- |
| AgentRouter | `https://agentrouter.org/v1` | Responses | [Tokens](https://ps.air-outer.com/console/token), [account models](https://ps.air-outer.com/console/personal), [exact IDs/endpoints](https://ps.air-outer.com/pricing), [Codex guide](https://agentrouter.org/docs/codex.html), [compatible-client guide](https://agentrouter.org/docs/cline.html), [terms](https://agentrouter.org/docs/terms.html) |
| OpenAI | `https://api.openai.com/v1` | Responses | [API keys](https://platform.openai.com/api-keys), [models](https://developers.openai.com/api/docs/models), [Responses reference](https://developers.openai.com/api/reference/resources/responses) |
| OpenRouter | `https://openrouter.ai/api/v1` | Chat Completions | [API keys](https://openrouter.ai/settings/keys), [models](https://openrouter.ai/models), [API reference](https://openrouter.ai/docs/api_reference/overview) |
| Groq | `https://api.groq.com/openai/v1` | Chat Completions | [API keys](https://console.groq.com/keys), [models](https://console.groq.com/docs/models), [OpenAI compatibility](https://console.groq.com/docs/openai) |
| DeepSeek | `https://api.deepseek.com` | Chat Completions | [API keys](https://platform.deepseek.com/api_keys), [models/pricing](https://api-docs.deepseek.com/quick_start/pricing), [API docs](https://api-docs.deepseek.com) |
| Gemini compatibility | `https://generativelanguage.googleapis.com/v1beta/openai` | Chat Completions | [API keys](https://aistudio.google.com/apikey), [models](https://aistudio.google.com/docs/models), [OpenAI compatibility](https://aistudio.google.com/docs/openai) |
| Ollama | `http://127.0.0.1:11434/v1` | Chat Completions | [Compatibility docs](https://docs.ollama.com/api/openai-compatibility); pull a local model and use its exact name |

Custom OpenAI-compatible APIs remain available in advanced options. Their HTTPS hostname must be in `AGENT_LLM_ALLOWED_HOSTS`. Local model servers cannot use the RecallLoop app port and require `AGENT_LLM_ALLOW_LOCAL=true` in production. URL credentials, queries, fragments, redirects, encoded paths, and full generation/discovery endpoint URLs are refused. Do not enter an Anthropic `/messages` endpoint: Anthropic-native transport is not implemented.

DeepSeek's root base is the current preset; a previously saved `/v1` base is still recognized without rewriting the connection. Presets and documentation links are setup guidance, not proof that your key/model supports every field or tool mode.

### AgentRouter corrections and limits

Sources checked on **8 November 2026**: the public [service status](https://agentrouter.org/api/status) links its official docs to `https://agentrouter.org/docs/index.html`. The Codex guide explicitly uses `/v1` and `wire_api = "responses"`. OpenAI-compatible client guides also use `/v1`; their Anthropic-native instructions omit it and must not be mixed with RecallLoop's transports. These guides link `ps.air-outer.com` for token management, account models, and pricing; the model API remains on `agentrouter.org`.

Model availability and endpoint support are dynamic and account-specific. Documentation examples and public announcements use different IDs; the former placeholder `gpt-6.1-sol` was **not established as valid** and is no longer offered as a default/example. Copy the spelling, punctuation, and supported endpoint from your account rather than guessing a nearby name. A wrong or offline model can return `503 no available channel`.

Supported-client guides and public announcements do **not establish RecallLoop approval**. AgentRouter can apply client/account restrictions and higher-cost groups. Ask the service to approve this application if needed, or use another provider. Every request identifies itself honestly as `RecallLoop/0.2.0`. Only legitimate attribution and OpenAI organization/project headers are allowed; no Codex, OpenCode, Claude Code, or other application's identity is forged. The terms prohibit restriction circumvention, abusive automation, account/credit resale, and training-data acquisition. Memory adaptation is not model training.

Authenticated discovery, live generation, streaming, tool support, and RecallLoop approval have **not been live-verified in this redesign environment**, which has no configured workspace API credentials. Fixture tests prove our handling, not upstream acceptance.

### Stateless Responses context

Responses requests use `store: false` and reconstruct context from the local transcript,
without `previous_response_id`, provider conversation references, stored message/reasoning
item IDs, or encrypted reasoning state. Tool rounds preserve the actual matching `call_id`
for each locally reconstructed function call/output pair; follow-ups resend plain text.
A mocked HTTP integration regression verifies both paths.

The previously reported **“The requested item was created under a different Azure OpenAI
resource”** error has not been reproduced with a live provider here. The regression establishes
that RecallLoop does not reuse provider-stored state; it is not a live routing diagnosis or
a claim that the upstream error is fixed. No blind retries, client impersonation, or
provider-storage workaround was added.

### Sanitized diagnostics

Upstream error bodies are used only to choose a fixed diagnostic; they are never returned or logged.

| Code | Meaning / next action |
| --- | --- |
| `provider_invalid_key` | Key rejected; check provider, expiry, and revocation. |
| `provider_client_unapproved` | Explicit client restriction; request RecallLoop approval or change providers. |
| `provider_forbidden` | Other access denial; check account/project scopes and client policy. |
| `provider_model_unavailable` | Wrong, offline, or unavailable model/endpoint combination; check exact account IDs. |
| `provider_protocol_unsupported` | Wrong API base or unsupported Responses/Chat protocol. |
| `provider_streaming_unsupported` | Use non-streamed transport. Ordinary streamed chat retries once only after an explicit unsupported-stream rejection; authentication, quota, and model failures are never retried this way. Capability probes never retry. |
| `provider_tools_unsupported` | Disable tools or choose a tool-capable model; do not silently remove the review boundary. |
| `provider_quota` | Billing, credits, or quota exhausted, including AgentRouter's `402 Budget pool quota has been exhausted.` |
| `provider_rate_limited` | Wait; do not use repeated verification as a load test. |
| `provider_network` / `provider_timeout` | Check DNS, proxy, base URL, local server, or service availability. |
| `provider_invalid_response` / `provider_incomplete` | Malformed or incomplete output is not verification success. |

## Tatum

Create a Mainnet-scoped key in the [Tatum dashboard](https://dashboard.tatum.io); see [official documentation](https://docs.tatum.io). This connection reads Sui Mainnet checkpoints and Walrus account ownership through Tatum. It never submits transactions. Verification is a fresh checkpoint read with your session key.

Tatum is needed for live Walrus ownership checks, but it is not needed to use a model without portable memory. **Verify Tatum** uses the saved session key; **Disconnect Tatum & Walrus** also disconnects its dependent Walrus authorization and reopens both connection forms. Stored remote memories are not deleted. Model credentials are unaffected.

## Walrus Memory

Use the official [Walrus Memory dashboard](https://memory.walrus.xyz/dashboard), [documentation](https://docs.wal.app/walrus-memory/), and [quick start](https://docs.wal.app/walrus-memory/getting-started/quick-start). The official site also links the [Walrus Console memory view](https://console.walrus.xyz/buckets?tab=memory).

1. Create a **Mainnet Walrus Memory account owned by the signed-in wallet**. Its account object ID is not the wallet address.
2. Create a dedicated, revocable delegate key authorized for that account. **Never enter a seed phrase or your wallet's private key.**
3. Connect Tatum, then enter the account object ID and delegate key in **Walrus Memory** settings. **Connect Tatum first** opens the Tatum tab when that dependency is missing.

RecallLoop checks the official deployment/network, on-chain account type/owner through Tatum, relayer readiness, and signed delegate access. Public relayer health alone is not authorization. Verification and re-verification do not store memories; signed metadata reads may consume delegate budget. Account creation/delegate grants in the external dashboard may involve real transactions and costs, unlike RecallLoop login.

Capture sends chat transcripts and extracted user facts to the configured backend; the default relayer sees plaintext and performs embedding/encryption/storage. Walrus storage and relayer/delegate quotas apply. Confirm individual accepted writes in **Memory**; connection verification is **not proof of a successful write or Mainnet submission evidence**. Capture-off in **Turn options** disables implicit remembering; explicit teaching/outcome actions still write. **Verify Walrus** rechecks the saved connection without writes. Disconnecting Walrus preserves Tatum, the model connection, and stored remote memories. Reconnect the same account to recall them. Restore and explicitly confirmed seeding remain under **Memory → Index & Mainnet evidence tools**.

## Embeddings are separate

Portable Walrus memory uses the relayer's embedding service. The workspace model API key is **not** used as an embedding key.

The optional operator-only `npm run evaluate:vector` experiment uses the separate `OPENAI_API_KEY` and embedding configuration in `server/openai-embedding-provider.mjs` (`text-embedding-3-small`, 384 dimensions, 15-second timeout by default). It is billable, CLI-only, and excluded from CI. It does not become a wallet credential and no embedding-key browser form is provided. See [the parked retrieval experiments](./API.md#parked-legacy-retrieval-experiments) for its scope.

## Offline and advanced controls

The offline demo uses a scripted model and isolated, ephemeral process memory; neither establishes live model compatibility or Mainnet evidence. Switching only the model to scripted mock does **not** disconnect an existing live memory backend: capture can still write there, so check memory status first.

**Workspace settings → Advanced** contains the scripted-model switch, separate embedding guidance, and optional workspace access token. That token remains a temporary tab-only operator gate, not a replacement for signed wallet login. It is separate from provider keys and external-agent bearer credentials. The committed original implementation/action-plan documents remain unchanged; newer local edits were left untouched and excluded from the continuation commits. See [scope amendments](SCOPE_AMENDMENTS.md).

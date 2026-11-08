# Workspace provider setup

RecallLoop has three independent connections. Sign in with a Sui Mainnet wallet first; an address alone is not authentication. The single-use personal-message signature opens an isolated one-hour session. It is **not a transaction**, grants no spending permission, and does not authorize Walrus Memory.

Credentials are held in the trusted server process for that session, never inherited from the operator's `.env`. Password fields and redaction buffers use temporary tab memory. They are not written to browser caches, project downloads, prompts, or Walrus. Use localhost or HTTPS on a server you trust. Disconnect, expiry, logout, and server restart remove session credentials. Browser history/project caches are separate, unencrypted local conveniences; do not put unrelated secrets in chat or files.

## Model provider

Select a provider to populate its API base and protocol. Enter that provider's key and an **exact model ID available to your account**. IDs listed by `/models` are discovery results, not generation or tool guarantees.

**Connect & verify** makes one small coding-generation request, limited to 256 output tokens, without your conversation, project, memory, or real tools. Provider billing and quotas apply. Streaming and function tools remain **not checked** unless you explicitly request capability checks. Those add up to two small requests: a streamed coding response and a forced, non-executing dummy function call. They do not run code, touch files, or write memories. Some reasoning models cannot produce an answer within the small check budget; this is reported as incomplete, not as verified.

Verification applies only to the checked model and wire protocol, not every discovered model. It is an observation at the displayed time, not a service-availability guarantee. Re-verification uses the saved session credential; a failed recheck is shown separately and removes the current verified indicator without discarding the saved key. A failed replacement never overwrites a working connection. Checks are user-initiated; there is no automatic polling, authentication retry, protocol switching, or approval bypass.

| Provider | API base | Default protocol | Key/dashboard and official docs |
| --- | --- | --- | --- |
| AgentRouter | `https://agentrouter.org/v1` | Responses | [Tokens](https://ps.air-outer.com/console/token), [account models](https://ps.air-outer.com/console/personal), [exact IDs/endpoints](https://ps.air-outer.com/pricing), [Codex guide](https://agentrouter.org/docs/codex.html), [compatible-client guide](https://agentrouter.org/docs/cline.html), [terms](https://agentrouter.org/docs/terms.html) |
| OpenAI | `https://api.openai.com/v1` | Responses | [API keys](https://platform.openai.com/api-keys), [Responses reference](https://developers.openai.com/api/reference/resources/responses) |
| OpenRouter | `https://openrouter.ai/api/v1` | Chat Completions | [API keys](https://openrouter.ai/settings/keys), [API reference](https://openrouter.ai/docs/api_reference/overview) |
| Groq | `https://api.groq.com/openai/v1` | Chat Completions | [API keys](https://console.groq.com/keys), [OpenAI compatibility](https://console.groq.com/docs/openai) |
| DeepSeek | `https://api.deepseek.com/v1` | Chat Completions | [Platform](https://platform.deepseek.com), [API docs](https://api-docs.deepseek.com) |
| Gemini compatibility | `https://generativelanguage.googleapis.com/v1beta/openai` | Chat Completions | [API keys](https://aistudio.google.com/apikey), [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) |
| Ollama | `http://127.0.0.1:11434/v1` | Chat Completions | [Compatibility docs](https://docs.ollama.com/api/openai-compatibility); pull a local model and use its exact name |

Custom OpenAI-compatible APIs remain available in advanced options. Their HTTPS hostname must be in `AGENT_LLM_ALLOWED_HOSTS`. Local model servers cannot use the RecallLoop app port and require `AGENT_LLM_ALLOW_LOCAL=true` in production. URL credentials, queries, fragments, redirects, encoded paths, and full generation/discovery endpoint URLs are refused. Do not enter an Anthropic `/messages` endpoint: Anthropic-native transport is not implemented.

### AgentRouter corrections and limits

Sources checked on **8 November 2026**: the public [service status](https://agentrouter.org/api/status) links its official docs to `https://agentrouter.org/docs/index.html`. The Codex guide explicitly uses `/v1` and `wire_api = "responses"`. OpenAI-compatible client guides also use `/v1`; their Anthropic-native instructions omit it and must not be mixed with RecallLoop's transports. These guides link `ps.air-outer.com` for token management, account models, and pricing; the model API remains on `agentrouter.org`.

Model availability and endpoint support are dynamic and account-specific. Documentation examples and public announcements use different IDs; the former placeholder `gpt-6.1-sol` was **not established as valid** and is no longer offered as a default/example. Copy the spelling, punctuation, and supported endpoint from your account rather than guessing a nearby name. A wrong or offline model can return `503 no available channel`.

Supported-client guides and public announcements do **not establish RecallLoop approval**. AgentRouter can apply client/account restrictions and higher-cost groups. Ask the service to approve this application if needed, or use another provider. Every request identifies itself honestly as `RecallLoop/0.2.0`. Only legitimate attribution and OpenAI organization/project headers are allowed; no Codex, OpenCode, Claude Code, or other application's identity is forged. The terms prohibit restriction circumvention, abusive automation, account/credit resale, and training-data acquisition. Memory adaptation is not model training.

Authenticated discovery, live generation, streaming, tool support, and RecallLoop approval have **not been live-verified in this redesign environment**, which has no configured workspace API credentials. Fixture tests prove our handling, not upstream acceptance.

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

Tatum is needed for live Walrus ownership checks, but it is not needed to use a model without portable memory. Disconnecting Tatum also disconnects its dependent Walrus authorization; stored remote memories are not deleted. Model credentials are unaffected.

## Walrus Memory

Use the official [Walrus Memory dashboard](https://memory.walrus.xyz/dashboard), [documentation](https://docs.wal.app/walrus-memory/), and [quick start](https://docs.wal.app/walrus-memory/getting-started/quick-start). The official site also links the [Walrus Console memory view](https://console.walrus.xyz/buckets?tab=memory).

1. Create a **Mainnet Walrus Memory account owned by the signed-in wallet**. Its account object ID is not the wallet address.
2. Create a dedicated, revocable delegate key authorized for that account. **Never enter a seed phrase or your wallet's private key.**
3. Connect Tatum, then enter the account object ID and delegate key in Walrus settings.

RecallLoop checks the official deployment/network, on-chain account type/owner through Tatum, relayer readiness, and signed delegate access. Public relayer health alone is not authorization. Verification and re-verification do not store memories; signed metadata reads may consume delegate budget. Account creation/delegate grants in the external dashboard may involve real transactions and costs, unlike RecallLoop login.

Capture sends chat transcripts and extracted user facts to the configured backend; the default relayer sees plaintext and performs embedding/encryption/storage. Walrus storage and relayer/delegate quotas apply. Confirm individual accepted writes in Memory; connection verification is **not proof of a successful write or Mainnet submission evidence**. Capture-off disables implicit remembering. Disconnecting Walrus preserves Tatum, the model connection, and stored remote memories. Reconnect the same account to recall them.

## Embeddings are separate

Portable Walrus memory uses the relayer's embedding service. The workspace model API key is **not** used as an embedding key.

The optional operator-only `npm run evaluate:vector` experiment uses the separate `OPENAI_API_KEY` and embedding configuration in `server/openai-embedding-provider.mjs` (`text-embedding-3-small`, 384 dimensions, 15-second timeout by default). It is billable, CLI-only, and excluded from CI. It does not become a wallet credential and no embedding-key browser form is provided. See [the parked retrieval experiments](./API.md#parked-legacy-retrieval-experiments) for its scope.

## Offline and advanced controls

The offline demo uses a scripted model and isolated, ephemeral process memory; neither establishes live model compatibility or Mainnet evidence. Switching only the model to scripted mock does **not** disconnect an existing live memory backend: capture can still write there, so check memory status first.

The optional workspace access token remains a temporary tab-only operator gate, not a replacement for signed wallet login. It is separate from provider keys and external-agent bearer credentials. Original implementation/action-plan documents are preserved unchanged.

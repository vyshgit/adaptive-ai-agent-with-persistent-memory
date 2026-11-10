# Workspace provider setup

RecallLoop supports up to **12 simultaneous model-provider profiles**, alongside Tatum and Walrus Memory in **Workspace settings**. Choose **Connect Wallet** and sign in with a Sui Mainnet account first; an address alone is not authentication. The single-use personal-message signature opens an isolated one-hour session. It is **not a transaction**, grants no spending permission, and does not authorize Walrus Memory. The wallet session dialog shows the full address/network, expiry, and disconnect progress/errors. Server logout finishes before optional extension permission removal; an extension decline cannot restore authentication.

Credentials are held in the trusted server process for that session, never inherited from the operator's `.env`. Password fields and redaction buffers use temporary tab memory. Plaintext keys are not written to browser caches, project downloads, prompts, or Walrus. After you create and unlock the optional [encrypted device vault](DEVICE_VAULT.md), verified connections save encrypted by default with a per-connection opt-out. Without an unlocked vault they are session-only. Use localhost or HTTPS on a server you trust. Disconnect, expiry, logout, and server restart remove session credentials, not saved ciphertext. Hosted conversation/project caches use revocable wallet-plus-login `sessionStorage`; logout/inactive-login checks remove them, and new logins never import old persistent caches. The local project workspace keeps drafts and task history in page memory only, with no hidden hosted cache. See [memory privacy](MEMORY_PRIVACY.md).

## Optional: stop re-entering every API key

Before entering connections you want to remember, open **Advanced**, create an encrypted
device vault with a confirmed unique passphrase and explicit consent. **Save this connection
in device vault** is selected while unlocked; uncheck it for session-only use. Saving happens
only after normal verification succeeds. Existing cleared form/server
keys cannot be recovered to populate a new vault.

On a returning login with the same wallet/profile/origin: **unlock locally → explicitly
Reconnect saved connections → inspect verification status**. Unlock makes no API requests.
Reconnect verifies all saved model profiles, Tatum, then Walrus, can consume quota, performs no memory writes,
and skips Walrus after a Tatum failure. It does not repeat optional capability probes or
bypass revoked credentials/account ownership. A completed unlock survives Settings closure
and tab switches; explicit lock, page exit/reload, expiry or logout removes it. Each page
needs its own unlock. Individual model profiles can also be reconnected or forgotten separately.
No passphrase recovery or device sync is provided. See [the full guide](DEVICE_VAULT.md).

## Model provider

Start in the **Model** tab. Select a provider to populate its API base and protocol, with official **Get an API key**, **Available models**, and **API documentation** links. Enter that provider's key, choose **Load models**, then select a model from the returned catalogue. Discovery does not install the credential or generate an answer. The list is bound to its provider URL and key; changing either, or a failed/cancelled refresh, clears model eligibility. IDs are discovery results, not generation or tool guarantees. An advanced exact-ID fallback is available only when the endpoint does not support discovery, not when a supported endpoint returns an empty list. Base/protocol fields are under **Advanced connection options**; custom APIs expose them immediately. Changing providers clears the unsent key/model fields rather than reusing unrelated credentials.

Use **Add provider** for another provider or account. An optional profile name distinguishes
accounts in Settings and the workspace's grouped model picker. Selections bind the profile
ID, endpoint, protocol and model, so identical model IDs never select another profile's key.
**Verify**, **Reconnect** and **Disconnect** target the selected profile. Adding or verifying
one profile preserves the others; a failed replacement retains its prior working connection.

**Connect & verify model** makes one small coding-generation request, limited to 256 output tokens, without your conversation, project, memory, or real tools. Provider billing and quotas apply. Streaming and function tools remain **not checked** unless you select **Also check streaming & enabled tools** under **Verification & tool options**. Those add up to two small requests: a streamed coding response and a forced, non-executing dummy function call. They do not run code, touch files, or write memories. Some reasoning models cannot produce an answer within the small check budget; this is reported as incomplete, not as verified.

Verification applies only to the checked model and wire protocol, not every discovered model. It is an observation at the displayed time, not a service-availability guarantee. Re-verification uses the saved session credential; a failed recheck is shown separately and removes the current verified indicator without discarding the saved key. A failed replacement never overwrites a working connection. Checks are user-initiated; there is no automatic polling, authentication retry, protocol switching, or approval bypass.

Hosted conversation turns are memory-first and default to Talk. With tools enabled, the selected model can
share a short proposed plan or ask an inline clarification; a question pauses the turn for
your real reply. Function-call verification proves only transport support, not that a model
will plan well, use memories correctly, or ask every necessary question. With tools disabled,
plans/questions use ordinary text. Conversation Build alone exposes browser-project proposals;
choosing a provider grants no command, booking, or transaction approval. Local launch opens
the integrated project agent instead: Build or read-only Plan, Standard or Strict permissions,
and opt-in Walrus context. Higher-risk file/command actions always require exact approval.

Unsubmitted fields and in-flight checks survive section changes and browser-tab switches while Settings remains open. Closing Settings cancels checks and disposes secret drafts; non-secret setup preferences survive same-login reloads. Failed/cancelled connections retain their key and selected catalogue model for retry. Successful connections clear only submitted credential fields. Saved-model rechecks and selecting the mock preserve unfinished reconnect forms. **Cancel check**, Escape, and **Close & cancel check** can race a completed verification: connection status is refreshed even after closure. Late completions from an ended wallet workspace cannot install status in a new one. A failed status refresh blocks new model tasks while retaining local drafts and selection.

| Provider | API base | Default protocol | Key/dashboard and official docs |
| --- | --- | --- | --- |
| AgentRouter | `https://agentrouter.org/v1` | Responses | [Tokens](https://ps.air-outer.com/console/token), [account models](https://ps.air-outer.com/console/personal), [exact IDs/endpoints](https://ps.air-outer.com/pricing), [Codex guide](https://agentrouter.org/docs/codex.html), [compatible-client guide](https://agentrouter.org/docs/cline.html), [terms](https://agentrouter.org/docs/terms.html) |
| OpenAI | `https://api.openai.com/v1` | Responses | [API keys](https://platform.openai.com/api-keys), [models](https://developers.openai.com/api/docs/models), [Responses reference](https://developers.openai.com/api/reference/resources/responses) |
| Anthropic Chat compatibility | `https://api.anthropic.com/v1` | Chat Completions | [API keys](https://platform.claude.com/settings/keys), [models](https://platform.claude.com/docs/en/models/overview), [OpenAI SDK compatibility](https://platform.claude.com/docs/en/api/openai-sdk) |
| OpenRouter | `https://openrouter.ai/api/v1` | Chat Completions | [API keys](https://openrouter.ai/settings/keys), [models](https://openrouter.ai/models), [API reference](https://openrouter.ai/docs/api_reference/overview) |
| Hugging Face | `https://router.huggingface.co/v1` | Chat Completions | [Access tokens](https://huggingface.co/settings/tokens), [inference models](https://huggingface.co/models?inference_provider=all), [Inference Providers](https://huggingface.co/docs/inference-providers/index); enable **Make calls to Inference Providers** on the token |
| Groq | `https://api.groq.com/openai/v1` | Chat Completions | [API keys](https://console.groq.com/keys), [models](https://console.groq.com/docs/models), [OpenAI compatibility](https://console.groq.com/docs/openai) |
| DeepSeek | `https://api.deepseek.com` | Chat Completions | [API keys](https://platform.deepseek.com/api_keys), [models/pricing](https://api-docs.deepseek.com/quick_start/pricing), [API docs](https://api-docs.deepseek.com) |
| Gemini compatibility | `https://generativelanguage.googleapis.com/v1beta/openai` | Chat Completions | [API keys](https://aistudio.google.com/apikey), [models](https://ai.google.dev/gemini-api/docs/models), [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) |
| Ollama | `http://127.0.0.1:11434/v1` | Chat Completions | [Compatibility docs](https://docs.ollama.com/api/openai-compatibility); pull a local model and use its exact name |

Custom OpenAI-compatible APIs remain available in advanced options. Their HTTPS hostname must be in `AGENT_LLM_ALLOWED_HOSTS`. Local model servers cannot use the RecallLoop app port and require `AGENT_LLM_ALLOW_LOCAL=true` in production. URL credentials, queries, fragments, redirects, encoded paths, and full generation/discovery endpoint URLs are refused. Do not enter an Anthropic `/messages` endpoint: Anthropic-native transport is not implemented.

DeepSeek's root base is the current preset; a previously saved `/v1` base is still recognized without rewriting the connection. Presets and documentation links are setup guidance, not proof that your key/model supports every field or tool mode.

### Shared gateway and compatibility

Model discovery, verification, hosted chat and local SDK generation share one request gateway
on the existing server/worker fetch paths. Provider profiles bind credentials to an exact
endpoint, method, protocol and selected model. The browser never supplies request headers to
the SDK. These are the authentication pairings used by this connector:

| Provider / operation | Authentication and request conventions |
| --- | --- |
| OpenAI | Bearer key; Responses instructions or Chat system messages, according to the selected protocol. Modern OpenAI Chat models use `max_completion_tokens`. |
| Anthropic | Native `/v1/models` discovery uses `x-api-key`; `/v1/chat/completions` compatibility generation uses Bearer auth. Both send `anthropic-version: 2023-06-01`. Generation uses system messages and omits sampling overrides. |
| Gemini | `/v1beta/openai/models` and `/v1beta/openai/chat/completions` use Bearer auth. Chat uses system messages and `max_tokens`; unsupported `parallel_tool_calls` is removed. |
| OpenRouter | Bearer key at `/api/v1`; default `HTTP-Referer: http://localhost:3000` and `X-Title: RecallLoop`. |
| Ollama | No credential for key-free local discovery/generation; an explicitly configured local key is sent only to that selected endpoint. |
| Hugging Face / other compatible APIs | Bearer credential with the selected compatible protocol and admitted host. |

Google's native `generateContent` API uses a different URL, `systemInstruction` and native
key handling. Mixing those fields with the OpenAI compatibility payload causes invalid
requests; the Gemini preset deliberately keeps the documented compatible pairing together.
Native Google URLs and Responses are rejected before an upstream request. Anthropic's native
Messages API is also separate. Anthropic describes its compatibility layer primarily as an
evaluation/comparison path and recommends its native API for production feature completeness.
This connector exposes the compatible subset, not native Messages or `generateContent` features.

Request descriptors and the SDK registry contain no credential. Dispatch creates a fresh header
set, adds only the selected profile's authentication, refuses redirects, and clears mutable
authentication headers after fetch settles, including failure/abort. The session/vault still
intentionally retains its credential for later requests. JavaScript/HTTP internals may retain
copies; cleanup is not secure heap erasure.

`AGENT_LLM_EXTRA_HEADERS` accepts only non-secret, bounded attribution or provider organization/
workspace values. `HTTP-Referer` and `X-Title` apply only to OpenRouter; OpenAI organization/
project headers only to OpenAI; `anthropic-workspace-id` only to Anthropic. This policy also
applies in the private builder worker, without forwarding the server environment. Credentials
and client-identity overrides are refused. OpenRouter attribution is optional upstream; it
does not resolve credit limits, account restrictions or every HTTP 403.

Tool eligibility uses explicit disablement first, then a generation/capability check for the
exact model/protocol, then OpenRouter's `supported_parameters`. Names and `:free` suffixes do
not establish tool support. Explicit verification can override a catalogue hint. A rejected
**forced** function check is reported separately: automatic tools may still work. Rechecking
capabilities deliberately probes again even when an earlier check said unsupported.

Disabled or known-unsupported tools omit tool definitions, directives and orphaned tool history.
They produce text-only responses; hosted tool dispatch and both local worker/parent authorities
deny unsolicited execution. Switching to a tool-capable profile re-enables only that task's
eligible tools under its existing project permissions.

### Gemini HTTP 400

Use **Gemini · OpenAI compatibility**, **Chat Completions**, a Google AI Studio API key and an
exact ID from **Load models**. A successful catalogue read does not prove generation access.
The error panel distinguishes invalid keys, project/billing/region prerequisites, unsupported
parameters, and tool-signature errors using sanitized provider diagnostics. If the key and
endpoint are correct, follow the indicated account or capability check rather than repeatedly
re-entering the key. Failed connects retain the typed key and selected model for a deliberate retry.

Gemini's opaque thought signatures are preserved exactly for parallel/sequential tool replay,
bounded to 64,000 characters, and discarded with the task. They never appear in browser events,
follow-up history, exports or memory. Offline JSON/SSE and actual SDK regressions verify this
adapter behavior; they do not establish the cause of a particular live HTTP 400.

### Local and free-model options

- A signed-in **local launch** reads Ollama's fixed loopback catalogue once on page startup,
  with **Refresh local models** for a manual refresh. Only installed, key-free local models
  enter the picker, labelled **Local · no API key**. Discovery does not download or run a
  model, and cloud-backed entries are excluded. Generation/tool support is still unverified.
- Hosted launches and the offline demo do not perform that local discovery. Ordinary provider
  setup still supports an explicitly chosen Ollama endpoint under the server's local-host policy.
- OpenRouter catalogue models with genuine zero prices appear first, labelled **Free
  (provider limits)**. A `:free` name alone is insufficient. An account key and provider
  limits still apply; no permanent free access is promised.
- **No tools advertised** uses explicit OpenRouter capability metadata. It enables text-only
  assistance until an exact-model capability check establishes otherwise.
- Hugging Face and other providers use their account-specific catalogue, credits and quotas.
  Their presence in the picker does not imply zero cost. Local compute also uses your resources.

### AgentRouter corrections and limits

Sources checked on **8 November 2026**: the public [service status](https://agentrouter.org/api/status) links its official docs to `https://agentrouter.org/docs/index.html`. The Codex guide explicitly uses `/v1` and `wire_api = "responses"`. OpenAI-compatible client guides also use `/v1`; their Anthropic-native instructions omit it and must not be mixed with RecallLoop's transports. These guides link `ps.air-outer.com` for token management, account models, and pricing; the model API remains on `agentrouter.org`.

Model availability and endpoint support are dynamic and account-specific. Documentation examples and public announcements use different IDs; the former placeholder `gpt-6.1-sol` was **not established as valid** and is no longer offered as a default/example. Copy the spelling, punctuation, and supported endpoint from your account rather than guessing a nearby name. A wrong or offline model can return `503 no available channel`.

Supported-client guides and public announcements do **not establish RecallLoop approval**. AgentRouter can apply client/account restrictions and higher-cost groups. Ask the service to approve this application if needed, or use another provider. Every request identifies itself honestly as `RecallLoop/0.2.0`. Extra headers follow the host-scoped policy above; no Codex, OpenCode, Claude Code, or other application's identity is forged. The terms prohibit restriction circumvention, abusive automation, account/credit resale, and training-data acquisition. Memory adaptation is not model training.

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

### Model use in the local builder

The [local builder](LOCAL_BUILDER.md) uses the session's explicitly connected base URL,
protocol, credential, and an advertised model selected in the composer, not saved OpenCode
logins or operator defaults. The current catalogue is not a guarantee that every listed
model supports tools; only the checked model/protocol gets a verified indicator.
Opening a folder or recalling memory does not connect/reconnect a provider. Local model tasks
use streaming; tool-disabled/known-unsupported profiles answer from supplied prose with no
tool authority. Local actions require supported enabled tools. Plain-generation verification
alone is not evidence that this SDK path works with a live account.

Each task starts a private OpenCode V2 worker with fresh SDK history. Follow-ups replay only
bounded visible page prose (six runs, twelve messages, 24,000 characters), never old file/tool
logs or approvals; relevant disk files must be read afresh. Its fetch gate admits
only that active task's selected endpoint/model, with fixed explicit headers and bounded
bodies, `store: false`, full local function-call/output replay, and no hosted tools or
provider-stored response/message/reasoning references. Other SDK providers, discovery,
updates, OAuth, references, warming, title generation, retries, and paid compaction are disabled.
No other client's identity is forged. Native command environments do not receive model keys.

The coding budget is at most **six requests / 4,096 output tokens per request / five minutes**.
Token-truncated output cannot automatically issue another paid continuation; unfinished
budget-limited work reports `budget_exhausted`, not completion. Builder limits are fixed
application policy; conversation `AGENT_LLM_MAX_OUTPUT_TOKENS` is not inherited into the private
worker. Only validated, host-scoped non-secret extra headers are handed off. Settings generation/capability checks are separate
explicit requests and can still consume quota.

The actual SDK paths are validated against scripted loopback Chat/Responses endpoints, not
live provider acceptance. Inspect partial results before a new smaller task; do not use retries,
client impersonation, or disabled review gates to bypass an account/model restriction.

### Sanitized diagnostics

Upstream error bodies are used only to choose a fixed diagnostic; they are never returned or logged.
HTTP errors, SSE error envelopes and HTTP 200 JSON error envelopes use the same sanitization;
numeric Google error codes are recognized. A failed task retains partial output, bounded
conversation and project drafts, releases task authority, and leaves connected profiles
available for an explicit follow-up. Authentication, quota and restriction errors never
trigger automatic retries or account switching.

| Code | Meaning / next action |
| --- | --- |
| `provider_invalid_key` | Key rejected; check provider, expiry, and revocation. |
| `provider_client_unapproved` | Explicit client restriction; request RecallLoop approval or change providers. |
| `provider_forbidden` | Other access denial; check account/project scopes and client policy. |
| `provider_region_restricted` / `provider_network_restricted` / `provider_account_restricted` | Check supported regions, proxy/IP policy, or required account/project verification. |
| `provider_precondition` | Gemini project prerequisite, such as billing, free-tier eligibility or verification; inspect Google AI Studio. |
| `provider_model_unavailable` | Wrong, offline, or unavailable model/endpoint combination; check exact account IDs. |
| `provider_protocol_unsupported` | Wrong API base or unsupported Responses/Chat protocol. |
| `provider_streaming_unsupported` | Use non-streamed transport. Ordinary streamed chat retries once only after an explicit unsupported-stream rejection; authentication, quota, and model failures are never retried this way. Capability probes never retry. |
| `provider_tools_unsupported` | Disable tools or choose a tool-capable model; do not silently remove the review boundary. |
| `provider_tool_choice_unsupported` | Forced selection was rejected; ordinary automatic tools may still work. |
| `provider_tool_signature` | Start a fresh task with the same model; if repeated, check that the endpoint/proxy preserves Gemini signatures. |
| `provider_parameters_unsupported` / `provider_request_failed` | Check prompt/system schema, protocol and model features; Gemini guidance points to its compatible preset. |
| `provider_quota` | Billing, credits, or quota exhausted, including AgentRouter's `402 Budget pool quota has been exhausted.` OpenRouter 402 guidance covers balance, key caps and budgets; Hugging Face guidance covers inference credits/billing. |
| `provider_rate_limited` | Wait for reset or select another available profile; OpenRouter limits may include free-model daily/per-minute caps. |
| `provider_network` / `provider_timeout` | Check DNS, proxy, base URL, local server, or service availability. |
| `provider_invalid_response` / `provider_incomplete` | Malformed or incomplete output is not verification success. |

## Tatum

Create a Mainnet-scoped key in the [Tatum dashboard](https://dashboard.tatum.io); see [official documentation](https://docs.tatum.io). This connection reads Sui Mainnet checkpoints and Walrus account ownership through Tatum. It never submits transactions. Verification is a fresh checkpoint read with your session key.

Tatum is needed for live Walrus ownership checks, but it is not needed to use a model without portable memory. **Verify Tatum** uses the saved session key; **Disconnect Tatum & Walrus** also disconnects its dependent Walrus authorization and reopens both connection forms. Stored remote memories are not deleted. Model credentials are unaffected.

## Walrus Memory

Use the official [Walrus Memory dashboard](https://memory.walrus.xyz/dashboard), [documentation](https://docs.wal.app/walrus-memory/), and [quick start](https://docs.wal.app/walrus-memory/getting-started/quick-start). The official site also links the [Walrus Console memory view](https://console.walrus.xyz/buckets?tab=memory).

1. Create a **separate Mainnet Walrus Memory account owned by the signed-in wallet** for each user. Its account object ID is not the wallet address. Namespaces in one shared account do not isolate users.
2. Create a dedicated, revocable delegate key authorized for that account. **Never enter a seed phrase or your wallet's private key.**
3. Connect Tatum, then enter the account object ID and delegate key in **Walrus Memory** settings. **Connect Tatum first** opens the Tatum tab when that dependency is missing.

RecallLoop checks the official deployment/network, on-chain account type/owner through Tatum, relayer readiness, and signed delegate access. Public relayer health alone is not authorization. Verification and re-verification do not store memories; signed metadata reads may consume delegate budget. Account creation/delegate grants in the external dashboard may involve real transactions and costs, unlike RecallLoop login.

**Auto-memory starts on** in hosted chat and the local builder. After successful completion,
eligible current-user prose is analyzed for durable facts; files, assistant output, history
and terminal logs are excluded. Obvious code/quotes/filler, recognized-secret lines and explicit
privacy requests are filtered. The toggle's disable choice survives same-tab/login reloads;
new logins start on. The parent owns capture, with no model memory-write tool.

Hosted **Turn options → Also save raw chat** separately enables transcript/tool-summary
records. Disabling Auto-memory or reloading clears raw consent. Local **Use Walrus context**
remains a separate, default-off profile/facts recall option; **Walrus → New checkpoint** saves
reviewed text with its own consent. See [capture scope and deduplication](MEMORY_PRIVACY.md#automatic-context-capture).

The relayer processes plaintext for embedding/encryption/storage; Walrus blobs are encrypted.
Walrus storage and delegate quotas apply. Confirm accepted writes in the separate capture
status/inventory; verification is **not proof of a write or Mainnet submission evidence**.
**Verify Walrus** rechecks without writes. Disconnecting does not delete remote memories or
revoke the onchain delegate; reconnect the same account to recall them. Hosted restore and
confirmed seeding remain under **Memory → Index & Mainnet evidence tools**.

For a trusted coding tool, use **Walrus → Prepare cross-tool setup** locally (or **Memory** in hosted conversation) after verification. The panel copies/downloads account metadata and existing profile/facts namespaces, never credentials, chat, memory text, or the exact raw namespace. Follow the linked official guide and authorize a separate delegate on the same account, with isolated client credentials and independently chosen automatic-save consent. A delegate can access every namespace in its account; do not share it with another user. See [portability](MEMORY_PORTABILITY.md).

## Embeddings are separate

Portable Walrus memory uses the relayer's embedding service. The workspace model API key is **not** used as an embedding key.

The optional operator-only `npm run evaluate:vector` experiment uses the separate `OPENAI_API_KEY` and embedding configuration in `server/openai-embedding-provider.mjs` (`text-embedding-3-small`, 384 dimensions, 15-second timeout by default). It is billable, CLI-only, and excluded from CI. It does not become a wallet credential and no embedding-key browser form is provided. See [the parked retrieval experiments](./API.md#parked-legacy-retrieval-experiments) for its scope.

## Offline and advanced controls

The offline demo uses a scripted model and isolated, ephemeral process memory; neither establishes live model compatibility or Mainnet evidence. Adding/selecting the scripted mock model in a wallet session preserves any live memory backend: default Auto-memory and explicit teaching/outcome actions can still write there. Turn Auto-memory off when those automatic writes are unwanted.

**Workspace settings → Advanced** contains the opt-in encrypted device vault, legacy-cache cleanup, scripted-model switch, separate embedding guidance, and optional workspace access token. That token remains a temporary tab-only operator gate, is never saved in the device vault, and is not a replacement for signed wallet login. It is separate from provider keys and external-agent bearer credentials.

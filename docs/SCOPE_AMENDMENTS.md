# Scope amendments — memory-first wallet workspace

Recorded 8 November 2026; updated 10 November 2026. The committed originals of the user-provided
[ACTION_PLAN.md](ACTION_PLAN.md) and [IMPLEMENTATION_PROMPT.md](IMPLEMENTATION_PROMPT.md)
remain unchanged as historical build inputs. Newer local edits in both documents were already
present when this follow-up resumed and have been preserved byte-for-byte. Earlier redesign
work has local commits; the current privacy, portability, device-vault, and local-builder follow-up remains
uncommitted. No commit, push, or merge has been performed for this follow-up. This document
records the later requested scope and verified SDK/transport differences; it does not rewrite
those inputs or override `AGENTS.md` platform rules.

## Requested product changes

The user selected a **coding workspace**, not only memory chat, and requested wallet sign-in
with each user connecting their own Tatum, MemWal, and AgentRouter credentials. The
initial scope was a browser-local, bounded editor/review agent. A later explicit request added
the local browser builder below: real permission-controlled files/commands on the user's machine, not
hosted execution, a cloud sandbox, desktop packaging, or production SaaS.

| Original plan/prompt boundary | Implemented amendment / reason |
| --- | --- |
| No file trees/diffs/editor | Hosted browser project/review/downloads retained; integrated local explorer, conversation, editor, terminal, Walrus, and static preview added by later request. Standard authorizes routine edits; risky actions and all Strict-mode writes/commands need exact review. |
| Single server-owned workspace identity | Signed Sui wallet identity with isolated one-hour sessions; deterministic wallet namespaces and stale-tab binding. |
| Workspace never handles user key inputs | User-requested credential forms use temporary tab memory and server sessions by default; later approved opt-in encrypted device saving is separate. No plaintext credential cache or owner-key inheritance. |
| Same-origin/token treated as workspace access | Origin/operator gate remains, but **does not authenticate a user**. Single-use local wallet verification protects workspace operations. |
| No new dependencies | Wallet Standard/Sui verification, Playwright, and safe Markdown packages support the requested workspace. The later private local runtime pins OpenCode SDK/plugin/core 2.2.6 and Effect 4.1.0; dependencies were installed locally as authorized. |
| `#/console` fallback on initial load | `#/agent` is the default product surface; `#/console` remains explicitly legacy/demo and never serves as wallet Mainnet evidence. |

The ordinary hosted/conversation workspace still applies proposals only to its browser
project. The later local launcher adds permission-controlled disk edits and native commands;
these are **not sandboxed** and can have OS/network effects. No shared OpenCode attachment,
model-callable approval, arbitrary MCP tooling, model training, remote-memory delete, or
blanket command authority was added. Standard can apply routine scoped text edits automatically;
deletion, execution configuration, and unknown commands still ask. A user's reviewed actual outcome can become
a future fact; approval and task completion are not passed-test evidence.

### Dark workspace and provider follow-up

The earlier hosted redesign makes conversation central, defaults to token-based dark surfaces
while honoring stored light preference, and opens Files/Review/Memory only on demand.
Sessions remain collapsible; imports, JSON backups, exact downloads, explicit review,
outcome capture, bounded restore, and confirmed seeding remain available. Keyboard dialogs,
short-height scrolling, and reduced-motion behavior are covered by browser regressions.

Model, Tatum, Walrus Memory, and embedding guidance are separated. Provider presets offer
official links/bases/protocols, not guessed account model IDs. Authenticated **Load models**
discovers a key/base-bound catalogue before connection without installing credentials or
claiming generation verification. Manual model entry is available only when discovery is
unsupported, not when a provider returns an empty list. Actual bounded generation
verification establishes readiness; optional streaming/function checks are
model/protocol-specific and never execute tools. Failed replacement, recheck, cancellation,
settings close, token refresh, and retired-wallet completion races retain honest status.
The historical AgentRouter model spelling/approval claims are not accepted as current live
evidence; [provider setup](PROVIDER_SETUP.md) records the corrections and remaining gates.

Unsubmitted Settings fields and checks survive section changes and visits to a credential
browser tab. Closing Settings cancels checks and disposes secret drafts, preserving a completed
vault unlock. Failed/cancelled connections retain keys and catalogue choices; successful
connections clear only submitted credentials. Saved-model rechecks preserve unfinished forms.

Assistant messages render Markdown rather than literal markers. User prompts stay literal;
raw HTML is ignored, images are not fetched, and only explicit credential-free HTTP(S)
links are clickable. This is client-only presentation, not generated-code execution.

### Memory-first workflow and premium interaction follow-up

The later request broadens the coding-focused experience into everyday questions and planning,
with an OpenCode-inspired interaction: recalled context → working plan or clarification →
actual bounded tool activity → reply. Conversation retains its own engine and has no SDK,
subagent, terminal, booking, publication, or transaction tool. This earlier conversation
boundary is distinct from the subsequently requested local SDK/command surface below.

Talk is now the safe default. `plan_task` shares up to six proposed steps, not execution
progress or approval. `ask_user` presents one structured clarification with up to four
optional replies and hard-pauses the turn. Every other call queued in that round is blocked,
including writes/proposals before the question. Suggestions fill the draft and focus the
composer; only Send submits them. Paused questions/plans survive wallet-scoped cache reload,
and clarification text enters assistant history so a real reply can continue the task.
Assistant clarification history is capped at 4,000 characters, preserving plan/question
metadata before trimming prose. The preceding task and next reply fit the existing server
history budget even when the displayed answer is long; displayed content is unchanged.

Responses context remains stateless: local text with `store: false`, no provider-stored
response/message/reasoning references, and matching function `call_id` pairs within tool
rounds. Mock HTTP regression coverage is not a live diagnosis of the previously reported
Azure resource error; no provider retries or stored-state workaround was added.

Travel requests perform at most two initial parallel memory lookups, including departure and
preferences. The prompt reuses applicable details, prioritizes explicit corrections, and asks
about missing, uncertain, conflicting, or ambiguous home/departure context rather than guessing.
Empty/unavailable recall is not proof that a detail was never supplied. Full memory timestamps
preserve same-day correction context. Offline travel examples are deterministic wiring demos,
not a general intent classifier, live model, travel advice, or verified availability.

Short dialog/panel/detail transitions, subtle button press feedback, and dialog-backdrop blur
add restrained depth. Reading/editing surfaces stay solid and all motion respects reduced
motion. No gradients, glows, or continuous decorative animation were introduced.

### Private per-user memory and cross-tool follow-up

The user explicitly requested that each user have their own memory and that one user cannot
access another user's chat or memory, alongside the Walrus portability improvement.
Portability therefore connects **one person's trusted tools**, not a shared multi-user pool.

- Wallet/demo services are principal-bound across ingestion, recall, inventory, explicit
  remembering, seed, and restore. Live wallets must connect an account owned by that wallet;
  another user's account or delegate cannot replace a working connection. Disposed services
  and late HTTP results cannot return private data or recreate cleared caches.
- Namespaces remain `rl:<stable-wallet-identity>:{profile,facts,raw}`. They organize an account,
  not delegate authorization. Different users need separate owner-controlled accounts;
  external logical-agent bearer APIs cannot address wallet/demo/dashboard identities.
- External agent/admin APIs now fail closed without keys in development as well as production.
  Logical agents need unique, bounded keys and canonical, nonreserved identities.
- Browser chat/project caches moved from persistent wallet caches to revocable **wallet +
  login-tagged tab `sessionStorage`**. Same-login reload still works. Logout revokes before
  teardown; inactive-login pruning and cross-tab notifications clear stale data. Late
  autosave/page-exit callbacks cannot repopulate revoked caches. Old `localStorage` caches
  are never loaded/migrated; an explicit confirmed cleanup preserves unrelated settings.
- The later automatic-context request enables facts-only capture by default; raw storage
  still needs separate consent. Capture off disables automatic writes but preserves hosted recall
  and explicit teaching/outcome actions. The relayer processes plaintext; encrypted Walrus
  storage is not end-to-end secrecy from the relayer or the chosen model.
- A protected read-only handoff endpoint and Memory-panel copy/download controls export
  verified setup metadata and existing profile/facts namespaces only. No keys, chats, memory
  text, or exact raw namespace are exported. Each trusted client authorizes its own delegate
  on the same account, isolates local credentials, and chooses its own save consent.

No memory migration to `default`, backend/SDK replacement, database, automatic MCP/client
installation, or coding-tool configuration changes were introduced. Synthetic account and
browser regressions are offline isolation/consent evidence, not live compatibility or Mainnet
storage proof. See [privacy](MEMORY_PRIVACY.md) and [portability](MEMORY_PORTABILITY.md).

### Optional encrypted device-vault follow-up

The user suggested avoiding repeated API-key entry after restarts and explicitly approved
an **encrypted, wallet-specific device vault** rather than plaintext caches or MemWal secrets.

- Creation requires a confirmed passphrase and explicit consent. The later connection
  follow-up selects encrypted saving by default after unlock, with a per-connection opt-out.
  Only successfully verified entered credentials are saved, never fetched from server state.
- Native WebCrypto encrypts a bounded credential payload with AES-GCM-256 and a non-extractable
  PBKDF2-SHA256-derived key (600,000 iterations, random 32-byte salt, fresh 12-byte IVs,
  wallet/origin/version authenticated metadata). No dependency, server database, credential
  endpoint, MemWal secret storage, or new runtime server disk write was added.
- Sign in with the same wallet/profile/origin, unlock locally, then explicitly reconnect.
  Unlock makes no API calls; reconnect reuses normal sequential verification, skips Walrus
  after failed/missing Tatum, does not repeat capability probes, and writes no memories.
  Stale or cancelled work cannot send later credentials under a new login/unlock.
- Logout, expiry, explicit lock and page exit/reload lock the vault. Completed unlocks survive
  Settings closure and tab switches; every page unlocks independently. Encrypted copies remain
  until confirmed forgetting for that wallet. Cross-tab changes invalidate unlocked copies.
  Forgetting does not disconnect current server connections, delete remote memories, revoke
  delegates, or clear another wallet's copy. Legacy-cache cleanup preserves encrypted vaults.
- Lost passphrases cannot recover old copies; there is no device sync or plaintext fallback.
  An unlocked/compromised browser can access keys, the trusted server sees reconnected keys,
  and JavaScript physical-memory erasure is not claimed. Use separate profiles on shared devices.

This is a local convenience, not portable Walrus memory, a password-manager security audit,
or a relaxation of account ownership/user isolation. See [device-vault setup](DEVICE_VAULT.md).

### Local browser-builder follow-up

The user requested a low-cost builder backed by real local files/tools, with portable Walrus
context and no cloud sandbox, desktop app, or hosted-preview-to-local bridge.

- The launcher defaults to the folder where it was invoked, preserving npm's `INIT_CWD`;
  `--workspace` is an override. It supplies `--local --workspace <existing-project>` and binds
  to loopback. The whole local app/Vite rejects remote/foreign-origin/rebinding requests.
  Ordinary startup and the read-only hosted `/data` preview keep execution disabled.
- Local launch opens one project workspace directly: collapsible explorer, central agent
  conversation, adjacent editor, and on-demand terminal, Walrus, and static preview. There
  is no Conversation/Local-builder selector or separately mounted hosted conversation/cache.
- Wallet/demo login, project trust/permission consent, selected-model requests, and checkpoint
  saving are separate grants. Standard authorizes routine scoped text creates/updates and
  narrowly allowlisted hardened inspection; deletes, execution/dependency configuration,
  installs, project scripts, and unknown commands need exact permission. Strict asks for every
  write and command. Opening a folder starts no engine or request. Immutable expiring action
  approvals are consumed once, including failures; there is no durable approval or model
  self-approval API. Changing permission mode revokes pending action reviews.
- Build can mutate; Plan is parent-enforced read-only and omits the worker's mutation tool.
  Approval cannot make a Plan task write or execute a project script.
- Each coding/command task gets a private worker; each prompt gets a fresh SDK session with
  only bounded visible follow-up prose (six runs/twelve messages/24,000 characters total,
  8,000 per message), never old tool logs, snapshots, approvals, or provider-stored references.
  SDK Location is an empty private scratch folder, not the checkout. Allowlisted environments,
  private HOME/XDG directories, in-memory database, and nonpersisted events avoid inherited
  user credentials/engine state. The Effect SDK/owned Scope and Promise-plugin adapter are
  used because the pinned 2.2.6 Promise wrapper drops embedding overrides.
- Only bounded file listing/reading/literal search/proposals and permission-controlled `run_command` are
  exposed. Inherited config/plugins/MCP/skills/references, native model tools, broad permissions,
  warming, title generation, retries, and paid compaction are disabled. The worker fetch gate
  restricts active requests to the selected endpoint/model with `store: false`, local full
  tool-result replay, no hosted tools, and no provider-stored references.
- Commands have native OS/network authority, not a sandbox. RecallLoop credentials are not
  supplied, but trusted project scripts can access other files/networks. Actual output/exit/
  timeout/failure is reported. Stop/disposal terminates tracked process groups and ordinary
  descendants, not malicious escaped daemons. Approved disk changes remain.
- Builder source views, task transcripts, terminal output, approval controls, and drafts are
  page-only, never automatically saved to browser storage/vault/Walrus. Switching panels
  keeps drafts; temporary connection-status failures retain drafts/model selection but block
  new model tasks. Send clears task text only when accepted, and declined discard confirmation
  preserves the new-file path. Output follows the tail unless the reader chooses scrollback,
  including panel switches/resizing; a new command starts terminal following again.
  Logout/folder closure revokes authority. Delayed reads/acknowledgements
  cannot replace a newer selection/draft or close a newer review, including after deletion.
- Static previews are bounded capability snapshots on a separate loopback origin in the same
  process, with CSP/iframe script-only sandboxing and revocation. No backend proxy, persistent
  dev server, binary-asset support, OS sandbox, or general network-sandbox claim was added.
- Walrus receives eligible current-user prose for automatic facts after successful tasks,
  plus separately reviewed preferences/decisions/project-revision checkpoints. Files, history,
  assistant/tool output and terminal logs are excluded from automatic capture. It does not
  restore a whole workspace. Profile/facts recall is opt-in per local task, default off;
  reviewed attachments and raw retrieval retain separate consent. Reviewed recall expires; memory
  replacement/recheck revokes recall/checkpoint tickets through server `memoryEpoch` and
  client binding checks. Recalled memory never approves commands or reconnects providers.
- Request/tool/token/time/output/preview limits fail honestly. Token truncation cannot issue
  another paid request, and capped unfinished tool calls report `budget_exhausted`, not success.
  Browser fixtures authenticate logout after each scenario rather than relaxing workspace limits.

The exact runtime pins remain installed. Only the verified compatible scoped
`google-auth-library → gcp-metadata@8.1.2` override was applied, removing its affected gaxios
subtree. **28 flagged packages remain (22 moderate, 6 high)**; unverified major Zod/glob/
minimatch overrides were not applied. This remains a release blocker, not a clean security
audit. See [local builder](LOCAL_BUILDER.md) and [validation](VALIDATION.md).

### Automatic memory and connection-continuity follow-up

The user requested simultaneous providers, practical free-model options, Hugging Face,
retained API keys after failed attempts, default encrypted saving after unlock, continuity
across browser-tab switches, and automatic storage of relevant context.

- Up to 12 provider profiles are keyed by profile identity; model selection/verification/
  disconnection cannot resolve a duplicate model ID against a different account's key.
  Encrypted vaults support multiple profiles and legacy single-model migration.
- Signed-in local launches discover installed, key-free Ollama models without inference or
  downloads. OpenRouter free labels require zero catalogue prices. Hugging Face uses its
  Inference Providers endpoint and account-specific discovered models.
- Auto-memory starts on, with a login-scoped disable choice. The parent analyzes only
  eligible current-user prose, bounded independently from model context, after successful
  generation. Local capture includes a portable folder basename, never an absolute path.
  Obvious filler/code/logs/quotes, history dumps, recognized-secret lines and explicit privacy
  requests are skipped. Heuristic filtering/extraction is not proof of relevance or truth.
- The model has no memory-write tool. Raw chat needs explicit `capture: true` plus a raw
  `captureMode`; user facts never implicitly approve transcript storage. Builder recall and
  manual reviewed checkpoints retain their separate controls.
- Automatic jobs deduplicate within a service and UTC day, across conversations, before
  write-slot admission. Pending jobs are shared and never evicted; failed results allow retry.
  Disposal prevents late metadata publication, while accepted remote jobs may still finish.
  Delayed/interrupted capture confirmation preserves a completed coding task.

### Folder selection and shared-provider gateway follow-up

The user requested selectable local projects and efficient provider routing, including
actionable Gemini 400 and OpenRouter quota/restriction handling.

- Authenticated loopback folder navigation and explicit, idle-only opening can select a
  project outside the launch root. The observed workspace ID prevents stale-tab replacement.
  Destination validation precedes retirement; success revokes prior approvals, recall and
  preview capabilities and resets project page state after draft-discard confirmation.
  Failed checks preserve the current project. Selected roots last for the current login.
- Discovery, hosted Chat/Responses and SDK execution reuse one shared request gateway.
  Authentication is injected only at dispatch, on fresh endpoint-bound headers, then mutable
  authentication headers are cleared. SDK registry entries are credential-free; session/vault
  retention is intentional and no secure heap erasure is claimed. Non-secret attribution and
  organization/workspace overrides are bounded, validated and host-scoped.
- OpenAI, Anthropic Chat compatibility, Gemini OpenAI compatibility, OpenRouter, Ollama and
  Hugging Face use their documented compatible endpoints/authentication pairings. Gemini
  retains Bearer auth/system messages on `/v1beta/openai`; native `systemInstruction` belongs
  to a different API. Anthropic uses native `x-api-key` Models discovery and Bearer Chat
  compatibility generation with its version header. Native generation adapters are not added.
- OpenRouter sends legitimate default attribution; this is not a guarantee against 403.
  Tool policy uses explicit disablement, exact-model/protocol verification and catalogue
  `supported_parameters`, never model-name guesses. Forced-tool rejection is distinct from
  automatic-tool support. Text-only requests omit tools/directives/orphaned history, and
  both parent and worker deny local tool execution.
- Gemini signatures are preserved privately for bounded parallel/sequential tool replay
  and excluded from browser events/history/memory. JSON/SSE errors use fixed sanitized
  diagnostics, including numeric Google codes and HTTP 200 error envelopes. Provider errors
  leave task context, project drafts and profile selection available for a deliberate follow-up.
- Scripted upstream fixtures and real local SDK/browser scenarios verify adapter behavior,
  not live provider acceptance or the specific cause of the reported Gemini 400. Live
  diagnosis still requires credential-redacted error details. Separate hosted-workspace and
  local-builder Chromium jobs are included in the CI workflow.

## Contract and safety amendments

| Original specification | Actual contract / reason |
| --- | --- |
| 256 KB workspace parser | 1 MB workspace/memory parsers before the legacy 32 KB parser, with bounded selected file/history content. Workspace decompression is disabled. |
| Sui JSON-RPC `sui_rpc` tool | Read-only `sui_read` checkpoint/object tool through HTTP GraphQL, the verified Tatum Sui Mainnet transport. Fixed queries, no arbitrary transactions. |
| Analyze all transcript roles into facts | Raw records capture user/assistant/tool provenance, but fact extraction receives user statements only. Assistant claims/unapproved code are not established user facts. |
| Sanitized identity may collapse | Hash suffix for changed/long logical identities; canonical signed-address hash for wallets. Tests cover isolation. |
| Mock inventory not available in SDK | Application tracks confirmed mock writes only; live inventory uses SDK `listMemories()`, cursors, tombstones, and snapshot validation. |
| `meetsHackathonMinimum = total >= 10` | Requires verified Mainnet status, 10+ confirmed non-mock blobs. Mock/legacy never count. |
| Mainnet badge based on healthy relayer | Official URL + healthy **production** mode + explicit Mainnet are required. Account/delegate verification and individual confirmed writes are separate facts. |
| Chat events only memory/delta/tool/done/stored/error | Added `proposal` for reviewed file contents, `plan`/`question` for bounded workflow, and actual call IDs / `blocked` activity. A paused turn ends with `finishReason: "question"`; `done` still precedes capture result. |
| Unlimited wait implied by SDK writes | Ten-second chat capture deadline can report `pending`; SDK jobs retain bounded slots until settlement. Accepted remote work cannot be undone by logout. |
| Raw provenance always has server timestamp | Chat supplies a stable UTC `occurredAt`. External callers may omit it; raw records then say `time not supplied` rather than inventing a time that breaks retry idempotency. |
| Process-wide credentials | Per-wallet staged connections verify/commit only while the original session is active. Logout/expiry cannot resurrect a late candidate or echo a cleared key. |
| Capture enabled / raw by default | Facts-only Auto-memory starts on after successful chat/coding turns, analyzing eligible current-user prose with a login-scoped disable control. Raw capture needs separate explicit consent and never inherits operator raw settings. |
| Wallet namespaces treated as access isolation | Principal-bound service operations plus separately owned Walrus accounts. Account-wide delegates are not namespace-restricted. |
| Persistent wallet browser history | Revocable wallet/login `sessionStorage`, inactive-login pruning, and explicit cleanup of obsolete persistent caches; export work before logout. |
| Re-enter API keys after every restart | User-approved optional encrypted device vault, local passphrase unlock, then explicitly verified reconnection. No keys in MemWal/plaintext caches. |
| External/admin APIs dev-open | Missing keys fail closed in all modes; external logical identities cannot select wallet/demo/dashboard scopes. |
| CLI environment mock/live selection | `demo:agent` is always isolated mock unless `--live --confirm-live-writes` is explicitly supplied. Browser connections never flow to the CLI. |
| Seed automatically writes repository evidence | Explicit `--confirm-mainnet`; optional wallet namespace/owner check; exclusive opt-in `--evidence NEW_FILE.md`. Memory/seed routes never write project files; the local builder's reviewed disk-edit routes are separate. |
| Browser project only / no local execution | Explicit loopback launcher starts in the invocation folder; authenticated selection can switch to another trusted local project. Login/project consent, parent-enforced Standard/Strict policy, private tasks, and exact once-only approvals apply. Hosted execution stays disabled; native commands are not sandboxed. |
| Automatic engine/session persistence | Fresh private runtime per task with bounded visible prose follow-ups and re-read disk files; builder drafts/logs stay page-only. Walrus checkpoints carry reviewed context, not source synchronization or execution authority. |

## Platform constraints retained

- One Express app port with Vite middleware in development and built assets in production;
  blockchain/LLM/relayer calls stay server-side. Only explicit local mode adds an isolated
  static-preview listener in that same process; no separate frontend dev server is introduced.
- Proxy bootstrap remains first, credentials-store import second.
- The hosted read-only preview still has no runtime database, upload persistence, server
  project writes, or new durable local memory index. The local SDK uses an in-memory database
  and temporary runtime files; only permission-authorized local edits/commands write the user's
  local project. The legacy index is not extended into wallet memory.
- Preview memory durability requires the external Walrus service; mock/browser history is
  explicitly not durable Mainnet storage.
- Existing legacy routes/regression tests remain. `src/App.tsx` was minimally changed to
  remove its unconditional “Walrus Mainnet Config” claim; its legacy warning is in the shell.
- Tatum's operator key remains environment-backed for legacy/CLI paths. Requested wallet
  keys are server-session inputs, never committed source or public `VITE_*` configuration.

## Submission-rule correction

The original plan listed a demo video under optional P2. The official submission form
requires a **2–3 minute video**; it is mandatory. The official event rules confirm the
deadline **10 November 2026, 17:00 UTC**, Track 2, 10+ Mainnet memories, relevant Tatum reads,
a published learning-loop blog, working demo, and public repository.

No payment bonus or submission completion is claimed from the historical plan. The current
[submission checklist](SUBMISSION_CHECKLIST.md) follows the published rules, not speculative
bonus details.

## Remaining cuts and gates

No native packaging, distributed tenancy, arbitrary Sui query/balance/transaction tools,
payments, full transcript replay, or embedding-provider integration was attempted. Live
Mainnet/provider validation is **not attempted: credentials absent and live testing unapproved**.
A blog draft is not
a published blog, and mock tests/fixtures are not Mainnet evidence. See
[VALIDATION.md](VALIDATION.md) for checks and [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md)
for the outstanding submission gates.

# Per-user memory privacy and consent

RecallLoop connects one person's conversations to **that person's account**, not to a shared
memory pool. These protections are implemented and tested offline; the application remains
a single-process prototype, not an audited production multi-tenant service.

## What separates users

| Boundary | Enforcement |
| --- | --- |
| Wallet identity | A single-use signed Sui personal message establishes the principal. Supplying an address is not login. |
| Live memory account | When connecting/rechecking, Tatum checks the official Mainnet account object and its JSON owner against the signed wallet; the SDK must also prove signed delegate metadata access. |
| Memory operations | The wallet/demo service rejects another principal before ingest, recall, inventory, remember, seed, or restore. HTTP routes select the authenticated service/identity, not caller-supplied account/namespace values. |
| Other API surfaces | External agents require unique bearer keys and cannot request wallet/demo/dashboard identities. Admin authentication is independent. Missing agent/admin keys fail closed even in development. |
| Browser login | A cookie plus public session tag prevents a stale tab from sending its old chat/files under a new user's login or replacing/logging out that new session. |
| Optional saved connections | After optional vault creation/unlock, verified credentials save encrypted by default with a per-connection opt-out. Each wallet/origin has its own vault; unlocking does not bypass login, account ownership, or delegate verification. |
| Local execution | Explicit loopback launcher and per-login project trust/Standard-or-Strict consent. Higher-risk actions and all Strict-mode writes/commands need immutable once-only reviews; checkpoint writes always need separate consent. Wallet login or memory alone grants no execution. |
| Session end | Logout/expiry destroys clients and credential references. Late operations cannot return private results, install old credentials, or refill destroyed caches. |

**Namespaces are not authorization.** A Walrus delegate can access namespaces throughout its
account. Every different user needs a separately owned account, not another namespace under
one shared delegate. Two people sharing a wallet, delegate, or active browser login are not
distinct principals. Use dedicated revocable delegates for trusted tools and never share keys.

## Automatic context capture

- **Auto-memory starts on** for hosted chat and local coding tasks. After a successful turn,
  the parent sends eligible current-user prose for durable-fact extraction in the current
  wallet's facts namespace. No manual checkpoint is needed for ordinary relevant context.
- Automatic analysis excludes assistant claims, prior history, attached files, source/tool
  output and terminal logs. Local filters skip obvious filler, code/log blocks, quotations,
  conversation dumps, and lines containing recognized redacted secrets. An explicit request
  such as “don't remember this” or “off the record” skips the whole automatic capture.
  These are heuristic filters; extraction and redaction can still miss or misinterpret text.
- Analysis is bounded to 4,000 characters of eligible prose, plus an optional project label.
  Local tasks use the selected folder's basename, never its absolute path. Only the current
  task is analyzed; model answers are not treated as verified decisions or outcomes.
- Turn **Auto-memory** off to disable these writes. This non-secret choice survives Settings
  closure, new conversations and reloads within the same tab/login. A new login starts on.
- **Also save raw chat** in hosted **Turn options** separately opts into raw user/assistant/
  tool-summary records. Disabling Auto-memory clears raw consent; reload/new login clears raw
  consent too. The local builder has no raw-capture option.
- HTTP chat and builder prompts default `capture` to `true`; `capture: false` opts out. Chat
  `captureMode` defaults to `facts`. Raw storage requires both explicit `capture: true` and
  `captureMode: "both"` or `"verbatim"`; operator raw-mode settings cannot enable it.
- Automatic capture is parent-controlled; the model has no `remember` write tool. Hosted
  **recall still happens with capture off**. Your current message, bounded history, selected
  files, and recalled context can still go to your model.
- **Remember explicitly**, **Record outcome**, and confirmed seeding are independent write
  actions, even with automatic capture off. Authenticated external `/ingest` is also an
  explicit write action with its separate operator contract.
- A `done` answer, healthy relayer, or pending `job_id` is not saved memory. Only completed
  blob IDs in the requested namespace count; inspect inventory before retrying accepted work.
- Identical eligible context, including its project label, shares one automatic job across
  conversations in the same memory service and UTC day. This is a bounded, in-memory
  deduplication window (up to 500 completed entries), reset by reconnection/restart. Pending
  jobs are shared before write admission and are never evicted; failures permit deliberate retry.
- Failed, stopped, empty or incomplete generation does not initiate capture. A valid hosted
  clarification can still capture the actual user statement, never a suggested reply. Accepted
  writes can finish after response disconnection; disposal prevents late metadata publication
  but cannot undo a remote job. Capture failure/pending confirmation does not undo a completed task.

Local-builder recall is separate: **Use Walrus context** opts into profile/facts
recall per task and defaults off; it neither retrieves raw chat nor enables additional writes.
**Save reviewed checkpoint** is its own write consent, separate from project permissions
and file/command approval. Only the submitted reviewed preference/decision/project-
revision fields are assembled; source, transcripts, credentials, and logs are not synchronized.

Capture consent in RecallLoop does not configure Claude Code/Codex hooks or their save
preferences. Choose those independently; see [cross-tool setup](MEMORY_PORTABILITY.md).

## Browser history is not portable memory

Conversation and browser-project caches use **tab `sessionStorage`**, keyed by wallet identity **and login
tag**. They are unencrypted, bounded conveniences for same-login reload—not remote backups.
Recalled memory text and connection credentials are excluded from persisted chat snapshots.

Logout revokes the cache lease before React teardown, deletes its chat/project keys, and
blocks delayed autosave, `pagehide`, hidden-visibility, and cleanup callbacks from recreating
them. Expired/absent/changed login checks prune inactive login-tagged caches before a new
workspace is loaded. Cross-tab notifications clear stale work; session tags still reject
stale HTTP requests if notifications are unavailable. Browser restore features can retain tab
storage, so explicitly sign out rather than treating tab closure as secure erasure.

**Export needed chats/files before logout.** A new login does not restore the old local
workspace. This intentional privacy change does not remove that user's remote Walrus memory;
reconnect the same owned account to recall it.

### Old persistent caches

Earlier versions used plaintext `localStorage` chat/project caches. They are **never loaded
or migrated into an authenticated workspace**, but may remain in the browser profile.
Use **Clear legacy browser caches** on sign-in or **Workspace settings → Advanced**:

1. The UI inspects matching cache **names/counts**, not private contents.
2. Confirmation explains that cleanup affects old RecallLoop chat/project entries for **all
   wallets on this site**.
3. Cleanup removes only the known legacy keys; current tab work, theme, and unrelated settings
   remain. Optional encrypted device vaults are not removed. Removal failures are reported,
   not labeled successful.

This does not delete downloaded exports, browser backups, or remote memories. If site-storage
removal is blocked, close the tab and clear site data yourself before sharing the browser.

## Optional credential persistence is separate

API connections remain session-only until you create and unlock the passphrase-protected
**device vault**. Saving is then selected by default, with a per-connection opt-out. Successfully verified inputs
are encrypted locally; neither plaintext keys nor the passphrase enter chat/project caches
or MemWal. Returning users sign in, unlock locally, and **explicitly reconnect** through the
same verification routes. Unlocking alone makes no API requests and enables no memory writes.

Logout, expiry, reload, explicit lock or leaving the page locks the vault. A completed unlock
survives Settings closure and browser-tab switches on this page. Another page needs its own
passphrase unlock; replaced/forgotten ciphertext invalidates open copies. The encrypted copy remains
until **Forget saved connections** is confirmed for that wallet. Forgetting does not erase
remote memories, revoke a delegate, or disconnect already active server credentials. It does
not restore a lost passphrase or protect an unlocked/compromised browser; see
[encryption, recovery, and trust limits](DEVICE_VAULT.md).

Unsubmitted credential fields remain only in the mounted Settings modal while switching
sections or visiting a credential browser tab. Checks continue across tab switches; closing
Settings cancels them and disposes secret drafts. Failed/cancelled connections retain their
keys and selected models for retry. A successful connection clears only its submitted
credential fields. Saved-model rechecks and selecting
the mock do not replace unfinished reconnect forms. Catalogue discovery uses the staged key
without installing a connection or saving that key.

## Local-builder source and memory are separate

Source views, unsaved drafts, coding-task history, terminal output, approval capabilities,
and recall selections stay in **page memory**, not `localStorage`, `sessionStorage`, the
device vault, or Walrus. Switching integrated panels preserves drafts; reload/logout/folder
closure or an accepted project switch clears page work. Failed folder checks preserve the
current project. Switching revokes the old workspace's approvals, recall selections and preview
capabilities; folder/checkpoint forms cannot carry another project's drafts into the new scope.
Temporary connection-status failures retain drafts/model selection
but block new model tasks. Confirmed disk edits remain in the local checkout, not in a remote backup.

Auto-memory separately analyzes only eligible current-user task prose after success. This
does not synchronize task history, assistant output, file contents, or terminal data to Walrus.

Each coding/command task has a fresh private worker/SDK session, private HOME/XDG/temp
directories, an in-memory database, and no persisted events or inherited credentials/config/
plugins/MCP/skills/references. The SDK uses an empty scratch Location; safe file tools are
mediated by the parent. Temporary command-output files are removed during normal cleanup;
abrupt process/OS failure is not a secure-erasure guarantee.

Sending a coding task allows the explicitly selected provider to receive requested bounded
safe disk files/tool results and recent visible user/assistant prose: six runs/twelve messages,
24,000 characters total, and 8,000 per message. It does not submit an unsaved editor draft,
hidden old tool logs, old file snapshots, approvals, or provider-stored references. A new
project session clears this prose history and recall attachments without discarding the
editor draft. Plan remains parent-enforced read-only; Build uses the selected permission policy.
Gemini tool-call thought signatures are opaque protocol metadata, bounded and replayed only
within the active server-side task. They never enter browser events, follow-up prose, exports
or automatic memory. Request credentials are injected at dispatch, outside the SDK registry,
then mutable authenticated headers are cleared; session/vault retention is separate and no
secure heap erasure is claimed. Text-only profiles have no local tool authority.
Commands receive no RecallLoop API credentials, but **native commands are not
sandboxed**: project scripts can access other files/credentials/networks with OS permissions.
Separate logins selecting the same project do not create separate disk copies.

For precise attachment control, recall is separately reviewed and explicitly selected, with
raw retrieval separately opted in. This is independent of opt-in per-task profile/facts recall.
Five-minute expiry and memory connection replacement/recheck revoke prior recall/checkpoint
tickets, including reconnecting the same account. Server `memoryEpoch` covers changes that
leave public account/mode fields unchanged. An expired selected attachment cannot silently
start a task without its context. Recalled text never grants commands or provider reconnection.

Keep checkpoint fields small and reviewed: preferences, decisions, actual outcomes, and a
user-supplied project/revision reference—not source dumps, logs, chats, or keys. They cannot
restore source files, dependencies, credentials, approvals, processes, or the whole workspace.
See [local builder](LOCAL_BUILDER.md) and [cross-tool checkpoint use](MEMORY_PORTABILITY.md#reviewed-local-builder-checkpoints).

## Who can still see the data

| Party / surface | Important limit |
| --- | --- |
| Trusted RecallLoop server | Receives submitted model/Tatum/delegate credentials and current chat/file/memory context. Sessions are in memory, not a trustless secret vault. |
| Walrus Memory relayer | Processes plaintext for embedding/encryption, even though stored Walrus blobs are encrypted. This is not end-to-end secrecy from the relayer. |
| Chosen model provider | Receives hosted conversation context/selected files, or bounded visible task prose, requested safe disk files/tool results, and opted-in or reviewed recall for a local task. `store: false` avoids provider-stored Responses linkage; it is not a retention guarantee. |
| Browser/device user | Can inspect an active tab/profile. Chat/project scoping and redaction are not encryption; the optional credential vault protects a locked saved copy, not an unlocked/compromised page, malicious extension, or shared credentials. Use separate browser/OS profiles. |
| Legacy `/api/walrus` publisher | Publishes plaintext blobs that may be fetched outside this application's authentication by blob ID. Never use it for private wallet chats/memories. |
| Trusted coding-tool delegate | Can read the account's other namespaces, including existing raw records. Omitting raw from setup notes does not revoke that access. |
| Native commands/project scripts | Have the local OS user's file/network permissions. Standard auto-runs only a narrow hardened inspection grammar; scripts and unknown commands require exact review. A clean shell environment and bounded file tools do not restrict a command's authority. |

Logout/disconnect/vault forgetting/legacy cleanup **does not erase remote memories or revoke an onchain
delegate**. Revoke unwanted delegates in the official Walrus Memory dashboard. No remote
forget/delete or cryptographic physical-memory erasure is claimed.

## Validation and safe live checks

Unit/HTTP tests use isolated synthetic accounts and real local wallet signatures. Browser
tests cover capture consent, revoked-cache races, inactive-login reloads, stale tabs,
network failures, legacy cleanup, key-free handoff, and encrypted-vault consent/round trips,
wrong passphrases, cancellation, cross-tab forgetting, and blocked storage. They are not Mainnet storage
or live API compatibility evidence. See [validation](VALIDATION.md).

With explicit live-testing approval, use two wallets and **two separately owned accounts**
with only public-safe synthetic facts. Try borrowed account/delegate/scope inputs, stale-tab
requests, logout/returning-wallet behavior, and fresh-session recall. Share sanitized error
codes and public IDs only—never headers, cookies, credential files, keys, or private chats.

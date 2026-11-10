# Draft: a memory-first workspace that keeps context, not just chat

**Publication status: unpublished draft.** The implementation and offline tests described
below are verified. Live provider/Mainnet behavior is not yet validated. Before publishing
for the hackathon, run the [live checklist](VALIDATION.md#live-manual-validation), add real
evidence and a before/after example, and clearly distinguish observed results from design.
Do not publish private credentials, real-user transcripts, or fabricated blob IDs.

## The problem

An assistant can outline a trip and ask again where we depart from, or fix a function and
forget our package manager and preference for small patches. Keeping an ever-growing chat
transcript is not the same as keeping useful memory. It also ties the workflow to one
browser and one conversation.

RecallLoop is an **OpenCode-style coding agent in the browser** for **Smart Agents for Real Life**,
working in the project folder where it is launched. It separates recent task history from portable
preferences, facts, and corrections. Local tasks can opt into Walrus context; checkpoint writes
always need separate review. Standard permissions automate routine scoped edits and hardened
inspection, while higher-risk actions ask; Strict review asks for every write and command.
The retained hosted conversation demo recalls context, asks about missing essentials rather
than guessing, and proposes browser-only selected-file changes instead of executing on disk.

## The loop: recall → work → review → remember

A small example makes the mechanism visible:

1. Teach a synthetic preference explicitly in Memory: “I prefer TypeScript and npm with small reviewable changes.”
2. Start a new conversation with no previous chat in its history.
3. Ask for a fix to a function's missing/empty-name behavior. Inspect the recalled preference
   and the proposed before/after change.
4. Review/download the change, test it locally, and record the actual outcome: “Keep changes
   small and add a regression test for missing names.”
5. Clear local conversation history and ask another related task. The later answer receives
   the recalled preference and correction instead of requiring another long introduction.

The hosted automated demo proves this orchestration using a **scripted model and mock memory**.
The browser tests also cover review/downloads and recalling an explicitly recorded lesson
after clearing local chat. These are offline results, not evidence of durable Mainnet
storage or a real model's quality improvement. The live publication example must repeat
the loop across a server restart or fresh browser with real confirmed citations.

The same loop applies to everyday planning. The deterministic offline travel example first
recalls a previously supplied departure city, then asks for missing dates. Home-only,
uncertain, or conflicting location context requires confirmation. A recent explicit correction
can supersede older context; failed retrieval is not proof that the user never supplied it.
This is a scripted orchestration example, not live travel advice or a measured model-quality
improvement. There are no live fares, weather, availability, or booking tools.

## Where Tatum and Walrus fit

The browser sends selected project context only to the same-origin Express server. A signed,
single-use Sui wallet challenge creates a one-hour session. Each wallet connects its own
Tatum, MemWal delegate, and model credentials; there is no server-owner-key fallback.

**Tatum** provides read-only Sui Mainnet HTTP GraphQL. RecallLoop observes checkpoints and
verifies that the selected Walrus Memory account is the official account object owned by
the signed-in wallet. The account is a Shared Sui object, so a naïve address-owner check is
wrong: the official Move account's JSON `owner` field is the relevant owner. A checkpoint
provides provenance, not independent proof of a Walrus write. These live reads still need
validation with the user's Mainnet key.

**Walrus Memory** is the intended durable memory source, through the installed MemWal SDK
and official Mainnet relayer. The SDK handles the storage/index/semantic-recall workflow.
RecallLoop requires signed delegate metadata access before installing a connection;
public relayer health is not account authorization. Only confirmed blob IDs independently
listed in the right namespace count toward the Mainnet seed gate. No live writes are
claimed by this draft.

## One project workspace, with the agent at its center

The local workspace integrates a collapsible explorer, central agent conversation, adjacent
editor, and on-demand terminal, Walrus, and static preview. Mobile shows one working panel
at a time; switching panels preserves page-only drafts. Stored light preference and reduced-motion
settings still work. Model, Tatum, and Walrus Settings sections have independent connection
controls; embeddings use the relayer rather than borrowing the chat model key. Enter a provider
key, load its available catalogue, select an advertised model, then connect and verify it.
Discovery neither installs credentials nor proves generation. Unsubmitted API fields survive
section switches and visits to a credential browser tab, including in-flight checks. Failed
connections retain keys and model choices for retry; closing Settings disposes secret drafts.
Multiple profiles keep accounts distinct in the model picker. Installed local Ollama models
are discovered automatically, and zero-priced OpenRouter models are labelled using catalogue
prices. Hugging Face is also available through its Inference Providers endpoint.

The retained hosted conversation workflow is OpenCode-inspired, but runs in RecallLoop's existing bounded engine. Talk is
the default. A short working plan contains **proposed** steps, not a completed-action log or
approval. An inline clarification pauses generation and blocks other calls in its round,
including queued writes/proposals. Suggested replies only fill an editable draft; nothing is
submitted until Send. Actual tool activity is shown separately from the plan.
Clarification history preserves the question and plan within the existing context budget,
so even a long displayed reply does not displace the task needed for continuation.

Small entry/panel transitions, subtle button feedback, and dialog-backdrop blur provide depth
without gradients, glowing surfaces, or continuous decoration. Reading/editing surfaces stay
solid; reduced-motion preferences disable the motion rather than only shortening it.

Assistant answers render headings, lists, tables, links, and fenced code instead of raw
Markdown markers. Formatting does not add trust: raw HTML is ignored, remote images are
not fetched, and unsafe/credential-bearing links are not clickable. Formatting is not execution
authority: hosted proposals need browser review, while local tools independently enforce the
selected Standard/Strict policy. Tool results, citations, reviews, and actual outcomes remain
separate from the formatted answer.

Memory has three tiers:

| Tier | Purpose |
| --- | --- |
| Profile | Explicit stable preferences and constraints, pinned before other hits. |
| Facts | User-stated decisions, corrections, and verified outcomes, retrieved by relevance. |
| Raw | Bounded provenance records for completed turns and tool summaries; separately opted-in capture and recall. |

Facts are consolidated from **user statements**, not assistant claims or unapproved code.
That is a deliberate choice: memory should not turn an agent's guess into a verified lesson.
Recalled text and project files are treated as untrusted context, never privileged commands.

## A browser builder backed by your own machine

The [local builder](LOCAL_BUILDER.md) needs no cloud sandbox or desktop app. Invoke its
loopback launcher from your project (npm's invocation folder is preserved), or override it
with `--workspace`. Signed login and project trust/permission consent start no model or command.
Each task uses a private OpenCode V2 SDK worker and the session's explicitly selected provider.
Build can edit and execute; Plan is enforced read-only in the parent and cannot be made
mutating by an approval. Standard automates routine text edits and a narrow inspection
allowlist; deletion, execution configuration, installs, scripts, and unknown commands pause
for exact, once-only permission. Strict asks for every write and command. Actual output,
exit, failure, and Stop are shown—not assumed success.

Follow-ups replay only bounded visible user/assistant prose, not old tool logs, source snapshots,
or provider-stored state. Files are read afresh. A new project session clears that history
without discarding an unsaved editor draft. Streamed output follows the tail while you are
reading there, but preserves deliberate scrollback when panels or viewport sizes change.

Native commands have the OS user's file/network permissions and **are not sandboxed**;
private environments keep RecallLoop keys out of the shell but do not constrain scripts'
authority. Static previews are isolated, bounded browser snapshots, not backend/dev-server
proxies or an OS sandbox. Ordinary hosted startup cannot enable local execution.

Builder source views, drafts, task history, and terminal output stay in page memory.
Default Auto-memory extracts durable facts from eligible current-user prose after success,
excluding files, history and assistant/tool output. It skips obvious filler/code/logs/quotes,
known-secret lines and explicit privacy requests. Small reviewed checkpoints remain available;
profile/facts recall is opt-in per task, with reviewed attachments and raw retrieval separately
consented. This carries context, not
source backups, credentials, execution approvals, or a complete working-tree restoration.

## Portable context, not a shared memory pool

Each user needs a separately owned, verified Walrus account. Namespaces organize profile,
facts, and raw records; they do not restrict an account-wide delegate. Wallet/demo services
reject another principal, and external bearer APIs cannot address wallet or demo identities.
Auto-memory starts on and can be disabled for the current tab/login. Raw transcript storage
requires a separate opt-in. Hosted recall can still supply context with capture off. Identical
automatic context shares one pending/completed job across conversations within the current
memory service and UTC day. A completed task is distinct from confirmed storage; the UI
reports pending or failed capture without marking the coding task failed.

For Claude Code/Codex, the Memory panel produces a **key-free handoff** containing the
verified account and exact existing profile/facts namespaces. The other trusted tool uses
its own revocable delegate on that same account and independently chosen save consent.
RecallLoop exports no keys, chats, memory text, or exact raw namespace and installs nothing
automatically. Isolated client credential directories avoid silently repointing other projects.

## Remember connections without putting keys in memory

Re-entering every API key after a restart is inconvenient, but storing secrets in MemWal or
plaintext browser caches would mix two different trust problems. RecallLoop instead offers
an **opt-in encrypted device vault**, separate for each wallet and site/browser profile.
Create it with a confirmed unique passphrase and explicit consent. Verified connections then
save encrypted by default while unlocked, with a per-connection opt-out and multiple model profiles.

On a returning login, unlock locally and **explicitly reconnect** through the same model,
Tatum, and Walrus verification. Unlock makes no API requests; reconnection can consume quota
but writes no memories. Tab switches and Settings closure preserve completed unlocks; explicit
lock, page exit/reload, expiry or logout removes them, while
confirmed forgetting removes only that wallet's encrypted copy. Passphrases cannot be
recovered and keys are not synced to another device. This is not an audited password manager
or protection from an unlocked/compromised browser; the trusted server still receives keys
when reconnecting. See [device-vault details](DEVICE_VAULT.md).

## What “learning” means here

RecallLoop does not fine-tune or retrain a model. Adaptation means changing the context
provided to a later answer: a corrected workflow, a user preference, or a verified failure
lesson is recalled before generation. The model remains the selected provider's model.

This makes the loop inspectable. Citation chips identify recalled blobs. `done` marks the
answer's completion; a later `stored` event reports capture independently. A slow SDK job
can be `pending`, but that is not labeled saved. The user can inspect inventory before
retrying rather than duplicating an already accepted write.

## Honesty and safety are part of the feature

As of **10 November 2026**, [validation](VALIDATION.md) records the measured local unit/HTTP/CLI,
Chromium, typecheck, and production-build results. The local-builder execution tests use the
actual SDK with scripted loopback model responses and real synthetic local files/commands,
not live provider/Mainnet access. Explicitly labeled UI-only fixtures exercise output timing
and races without running a model, changing files, executing commands, or granting permission.
Those include real local signature verification, replay/logout races, cross-wallet and
stale-tab isolation, capture consent, revocable caches, key-free handoff, real vault
cryptography/cancellation, request/write bounds, and redaction across split stream chunks.
Provider/account HTTP responses in automated tests are fixtures, not live compatibility.

Hosted browser project edits and transcripts use revocable wallet-plus-login tab `sessionStorage`,
not encrypted backups or portable Walrus transcript replay. Logout/inactive-login checks
clear them; old persistent caches are never imported and require explicit cleanup.
Mock memories disappear with the demo/session/process. Live
memory is intended to be portable within the configured account, namespace, and retention
policy, but it still needs real fresh-session verification. There is no remote delete or
complete-restore claim.

Credentials use temporary session/tab data; after optional vault setup/unlock, verified
connections save encrypted by default with a per-connection opt-out. Plaintext keys never
enter caches, exports, prompts, or Walrus. Use a
dedicated, revocable MemWal delegate, never a wallet seed phrase or wallet private key.
Redaction is best-effort, so private secrets do not belong in code context or a recorded demo.

The provider adapter supports Responses and Chat Completions. AgentRouter may reject
unapproved clients even with a valid key. RecallLoop does not impersonate another client:
request app approval, use an authorized alternative, or explicitly show the mock model.
Model discovery is not generation verification: an explicit small verification request establishes
only the selected model/protocol at the displayed time. Streaming and function support
have separate optional, non-executing checks. These tests cost provider quota, use no
private workspace context, and are not evidence of live account access when run as fixtures.
Responses rounds reconstruct local text with `store: false` and matching function call/output
IDs, without reusing provider-stored response, message, or reasoning state. A mocked HTTP
regression checks tool rounds and follow-ups; it is not a live-provider routing diagnosis.

The full and production dependency audits still flag **28 packages (22 moderate, 6 high)**
from Zod/glob/minimatch advisories. This is an unresolved release blocker, not a clean
security audit. No unverified major override was used to suppress it; see [validation](VALIDATION.md).

## Finish the live story before publication

- Run real wallet/API onboarding, 12 confirmed seed writes, independent inventory, and
  fresh-browser/server-restart recall; publish the evidence file only after it passes.
- Add a concrete before/after answer showing a preference or verified correction changing
  the work. Report the actual provider/model and whether code tests passed locally.
- Include the public repository, live demo instructions, evidence, and 2–3 minute video
  links. Review every screenshot/recording for keys, cookies, and private memory text.
- State remaining limits rather than describing mock/fixture results as Mainnet success.

The point is not that an assistant remembers an entire chat forever. It is that the next
session can recover the right lesson, expose its source, and use it in a reviewable workflow.

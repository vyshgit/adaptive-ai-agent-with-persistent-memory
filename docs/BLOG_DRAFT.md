# Draft: a coding workspace that remembers the lesson, not just the chat

**Publication status: unpublished draft.** The implementation and offline tests described
below are verified. Live provider/Mainnet behavior is not yet validated. Before publishing
for the hackathon, run the [live checklist](VALIDATION.md#live-manual-validation), add real
evidence and a before/after example, and clearly distinguish observed results from design.
Do not publish private credentials, real-user transcripts, or fabricated blob IDs.

## The problem

A coding assistant can fix a function and still forget everything that made the fix useful:
our package manager, the preference for small patches, or the regression test we wanted
after last week's failure. Keeping an ever-growing chat transcript is not the same as
keeping useful memory. It also ties the workflow to one browser and one conversation.

RecallLoop is a browser-based Talk / Plan / Build workspace for **Smart Agents for Real
Life**. It separates conversation history from portable preferences, facts, and corrections.
The agent recalls those memories before answering and shows the citations that influenced
the turn. Build proposes selected-file changes for review; it does not silently edit disk
or run untrusted code.

## The loop: recall → work → review → remember

A small example makes the mechanism visible:

1. Teach a synthetic preference: “I prefer TypeScript and npm with small reviewable changes.”
2. Start a new conversation with no previous chat in its history.
3. Ask for a fix to a function's missing/empty-name behavior. Inspect the recalled preference
   and the proposed before/after change.
4. Review/download the change, test it locally, and record the actual outcome: “Keep changes
   small and add a regression test for missing names.”
5. Clear local conversation history and ask another related task. The later answer receives
   the recalled preference and correction instead of requiring another long introduction.

The automated demo proves this orchestration using a **scripted model and mock memory**.
The browser tests also cover review/downloads and recalling an explicitly recorded lesson
after clearing local chat. These are offline results, not evidence of durable Mainnet
storage or a real model's quality improvement. The live publication example must repeat
the loop across a server restart or fresh browser with real confirmed citations.

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

Memory has three tiers:

| Tier | Purpose |
| --- | --- |
| Profile | Explicit stable preferences and constraints, pinned before other hits. |
| Facts | User-stated decisions, corrections, and verified outcomes, retrieved by relevance. |
| Raw | Bounded provenance records for completed turns and tool summaries; opt-in recall. |

Facts are consolidated from **user statements**, not assistant claims or unapproved code.
That is a deliberate choice: memory should not turn an agent's guess into a verified lesson.
Recalled text and project files are treated as untrusted context, never privileged commands.

## What “learning” means here

RecallLoop does not fine-tune or retrain a model. Adaptation means changing the context
provided to a later answer: a corrected workflow, a user preference, or a verified failure
lesson is recalled before generation. The model remains the selected provider's model.

This makes the loop inspectable. Citation chips identify recalled blobs. `done` marks the
answer's completion; a later `stored` event reports capture independently. A slow SDK job
can be `pending`, but that is not labeled saved. The user can inspect inventory before
retrying rather than duplicating an already accepted write.

## Honesty and safety are part of the feature

The implementation passes **135 unit/HTTP/CLI tests and 7 Chromium scenarios** locally.
Those include real local signature verification, replay/logout races, cross-wallet and
stale-tab isolation, request/write bounds, and redaction across split stream chunks.
Provider/account HTTP responses in automated tests are fixtures, not live compatibility.

Browser project edits and transcripts are local caches, not encrypted backups or portable
Walrus transcript replay. Mock memories disappear with the demo/session/process. Live
memory is intended to be portable within the configured account, namespace, and retention
policy, but it still needs real fresh-session verification. There is no remote delete or
complete-restore claim.

Credentials are temporary session/tab data, not exports or `localStorage`. Use a dedicated,
revocable MemWal delegate, never a wallet seed phrase or wallet private key. Redaction is
best-effort, so private secrets do not belong in code context or a recorded demo.

The provider adapter supports Responses and Chat Completions. AgentRouter may reject
unapproved clients even with a valid key. RecallLoop does not impersonate another client:
request app approval, use an authorized alternative, or explicitly show the mock model.

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

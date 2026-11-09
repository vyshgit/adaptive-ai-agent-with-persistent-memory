# Scope amendments — memory-first wallet workspace

Recorded 8 November 2026; updated 9 November 2026. The committed originals of the user-provided
[ACTION_PLAN.md](ACTION_PLAN.md) and [IMPLEMENTATION_PROMPT.md](IMPLEMENTATION_PROMPT.md)
remain unchanged as historical build inputs. Newer local edits in both documents were already
present when this continuation resumed; they were left byte-for-byte untouched and excluded
from its commits. This document records the later requested scope and verified SDK/transport
differences; it does not rewrite those originals or override `AGENTS.md` platform rules.

## Requested product changes

The user selected a **coding workspace**, not only memory chat, and requested wallet sign-in
with each user connecting their own Tatum, MemWal, and AgentRouter credentials. The
resulting scope is a browser-local, bounded editor/review agent—not a full local execution
agent or production SaaS.

| Original plan/prompt boundary | Implemented amendment / reason |
| --- | --- |
| No file trees/diffs/editor | Browser text project, selected context, bounded read/search tools, proposal diff and downloads. Requested coding workspace. |
| Single server-owned workspace identity | Signed Sui wallet identity with isolated one-hour sessions; deterministic wallet namespaces and stale-tab binding. |
| Workspace never handles user key inputs | User-requested credential forms use temporary tab memory and server sessions. No persistent browser credential cache; no owner-key inheritance. |
| Same-origin/token treated as workspace access | Origin/operator gate remains, but **does not authenticate a user**. Single-use local wallet verification protects workspace operations. |
| No new dependencies | Wallet Standard/Sui verification and Playwright were added for the requested login/browser validation; `react-markdown`/`remark-gfm` provide safe assistant formatting. Existing packages were upgraded for runtime/security compatibility. |
| `#/console` fallback on initial load | `#/agent` is the default product surface; `#/console` remains explicitly legacy/demo and never serves as wallet Mainnet evidence. |

No unrestricted terminal, arbitrary filesystem/MCP execution, model training, remote delete,
or automatic disk/code execution was added. Applying a proposal changes the browser project
only. Tests must be run on downloaded files locally; a user's explicit outcome can become
a future fact.

### Dark workspace and provider follow-up

The requested redesign makes conversation central, defaults to token-based dark surfaces
while honoring stored light preference, and opens Files/Review/Memory only on demand.
Sessions remain collapsible; imports, JSON backups, exact downloads, explicit review,
outcome capture, bounded restore, and confirmed seeding remain available. Keyboard dialogs,
short-height scrolling, and reduced-motion behavior are covered by browser regressions.

Model, Tatum, Walrus Memory, and embedding guidance are separated. Provider presets offer
official links/bases/protocols, not guessed account model IDs. Actual bounded generation
verification replaces discovery-only readiness; optional streaming/function checks are
model/protocol-specific and never execute tools. Failed replacement, recheck, cancellation,
settings close, token refresh, and retired-wallet completion races retain honest status.
The historical AgentRouter model spelling/approval claims are not accepted as current live
evidence; [provider setup](PROVIDER_SETUP.md) records the corrections and remaining gates.

Assistant messages render Markdown rather than literal markers. User prompts stay literal;
raw HTML is ignored, images are not fetched, and only explicit credential-free HTTP(S)
links are clickable. This is client-only presentation, not generated-code execution.

### Memory-first workflow and premium interaction follow-up

The later request broadens the coding-focused experience into everyday questions and planning,
with an OpenCode-inspired interaction: recalled context → working plan or clarification →
actual bounded tool activity → reply. RecallLoop retains its own engine; no OpenCode SDK,
subagent execution, terminal, booking, publication, or transaction capability was added.

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
| CLI environment mock/live selection | `demo:agent` is always isolated mock unless `--live --confirm-live-writes` is explicitly supplied. Browser connections never flow to the CLI. |
| Seed automatically writes repository evidence | Explicit `--confirm-mainnet`; optional wallet namespace/owner check; exclusive opt-in `--evidence NEW_FILE.md`. No runtime route writes project files. |

## Platform constraints retained

- One Express process/port with Vite middleware in development and built assets in
  production; blockchain/LLM/relayer calls stay server-side.
- Proxy bootstrap remains first, credentials-store import second.
- No new runtime database, upload persistence, server project writes, or durable local
  memory index. The legacy file-backed API is retained but not extended into the workspace.
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
Mainnet/provider validation is **not attempted: credentials absent**. A blog draft is not
a published blog, and mock tests/fixtures are not Mainnet evidence. See
[VALIDATION.md](VALIDATION.md) for checks and [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md)
for the outstanding submission gates.

# Scope amendments — wallet coding workspace

Recorded 8 November 2026. The user-provided [ACTION_PLAN.md](ACTION_PLAN.md) and
[IMPLEMENTATION_PROMPT.md](IMPLEMENTATION_PROMPT.md) are preserved unchanged as historical
build inputs. This document records the later requested scope and verified SDK/transport
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
| No new dependencies | Wallet Standard/Sui verification and Playwright were added for the requested login/browser validation; existing packages were upgraded for runtime/security compatibility. |
| `#/console` fallback on initial load | `#/agent` is the default product surface; `#/console` remains explicitly legacy/demo and never serves as wallet Mainnet evidence. |

No unrestricted terminal, arbitrary filesystem/MCP execution, model training, remote delete,
or automatic disk/code execution was added. Applying a proposal changes the browser project
only. Tests must be run on downloaded files locally; a user's explicit outcome can become
a future fact.

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
| Chat events only memory/delta/tool/done/stored/error | Added `proposal` for review-required file contents and actual call IDs on tool cards. `done` still precedes capture result. |
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

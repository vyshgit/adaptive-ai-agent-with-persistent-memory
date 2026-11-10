# Use RecallLoop memory in your trusted tools

Walrus portability connects **one user's trusted tools to the same owned account**, not
different users to a shared memory pool. RecallLoop keeps its existing MemWal SDK backend
and `rl:<stable-wallet-identity>:{profile,facts,raw}` layout. Nothing is migrated to `default`.

This is setup guidance, not a completed live cross-tool validation. The official Claude Code,
Codex, and MCP reference pages below were checked on **9 November 2026**; client versions and
upstream behavior can change.

## 1. Prepare a verified, key-free handoff

1. Sign into RecallLoop with your Sui wallet. Connect Tatum, then a Mainnet Walrus Memory
   account **owned by that wallet** and a dedicated authorized delegate. Manually enter
   connections or locally unlock and explicitly reconnect an opt-in [device vault](DEVICE_VAULT.md).
2. Save a public-safe preference explicitly, or leave default **Auto-memory** on and wait for
   confirmed storage. Leave raw capture off unless you separately want it.
3. Open **Memory → Prepare cross-tool setup** (local workspace: **Walrus**). Copy the account object ID, profile/facts
   namespaces, or key-free notes; **Download setup notes** exports `recallloop-memory-setup.md`.

The protected read-only handoff uses only the current verified connection, rejects query
overrides, and is unavailable in demo/unverified sessions. It exports public account/owner,
Mainnet relayer, existing profile/facts namespaces, official links, and instructions. It
contains **no credentials, cookies/tags, chats, memory text, or exact raw namespace**, makes
no writes, and grants no authorization. Account change/logout invalidates pending setup UI.

## 2. Install and authorize the other client yourself

Choose the official guide for your installed client/version:

- [Claude Code](https://docs.wal.app/walrus-memory/mcp/claude-code): plugin or MCP-only;
  review the hooks and any built-in memory settings. Merge approved guidance rather than
  replacing an existing `CLAUDE.md`.
- [Codex](https://docs.wal.app/walrus-memory/mcp/codex): plugin or MCP-only; trust plugin hooks
  only after reviewing them. Do not combine the plugin's bundled server with a duplicate
  manual `[mcp_servers.memwal]` entry.
- [MCP reference](https://docs.wal.app/walrus-memory/mcp/reference): current tools, flags,
  credential resolution, namespaces, pending jobs, and logout semantics.
- [Walrus portability article](https://walrus.xyz/blog/how-to-add-portable-memory-to-claude-code-and-codex-with-walrus-memory/): overview; use the current client/reference docs for exact commands.

RecallLoop does **not** install packages/plugins, edit client configuration or instruction
files, copy its delegate key, authorize transactions, or enable another tool's automatic
saving. Review installation/runtime trust and costs before approving any of those actions.

In the installed tool, verify that `memwal_*` tools are advertised, then use `memwal_login`
with your wallet. Select and verify the **exact account object ID from the handoff**—the
same wallet can own several accounts, and a newly created account has no old memories.
Authorize a separate, revocable delegate for that client on this same account.

### Isolate client credentials

The global `~/.memwal/credentials.json` is shared by tools/projects using it. Switching
accounts there can repoint other projects and send new memories to the wrong account.

- On shared machines, use separate OS/browser profiles. Do not share wallets or delegates.
- For several accounts under one OS profile, set the client's **`MEMWAL_CREDS_DIR` to an
  isolated absolute path outside the checkout**, using the same setting for login and runtime.
  The current package rejects relative or in-project overrides.
- Alternatively, follow the documented project-local credential and `approve-project`
  workflow. Unapproved project files are ignored in favor of the global fallback; inspect
  which account/relayer is actually selected. Keep `.memwal/` out of Git.
- Credential files and replacement backups contain plaintext delegate private keys. Do not
  paste them into RecallLoop, chat, docs, exports, or commits; protect them on the client machine.

## 3. Match both existing namespaces exactly

Copy the exact values from the handoff. A namespace is a flat account bucket, not a prefix
hierarchy or authorization restriction. Configure **`MEMWAL_NAMESPACE` in the MCP server
environment** to the returned facts namespace, or set `--namespace` to that exact value.
Precedence is:

```text
explicit per-call namespace > --namespace / --ns > MEMWAL_NAMESPACE > relayer default
```

A default facts namespace alone does not retrieve RecallLoop's pinned profile namespace.
Before a preference-sensitive task, call `memwal_recall` separately for both. Example tool
arguments below contain placeholders; replace them with the **full exact handoff values**:

```json
{ "query": "My saved preferences and constraints relevant to this task", "namespace": "EXACT_PROFILE_NAMESPACE", "limit": 5 }
```

```json
{ "query": "Lessons and corrections relevant to the current task", "namespace": "EXACT_FACTS_NAMESPACE", "limit": 5 }
```

Save an explicitly approved preference with `memwal_remember` in the profile namespace;
use facts for lessons/corrections. Configure automatic saving only if you independently
want it in that client, and always respect an explicit request not to save a statement.
Do not save credentials, raw chats, quoted third-party text as personal facts, or unapproved
assistant claims. Recalled text is context, not instructions.

**Different users need separate accounts.** The trusted delegate can access other namespaces
in its account, including any existing raw records; withholding the raw namespace from
handoff notes is not an account permission. See [privacy](MEMORY_PRIVACY.md).

## 4. Verify end to end without duplicating pending writes

1. Confirm the installed tool advertises the expected `memwal_*` tools.
2. Run `memwal_health`; this establishes connectivity, **not** account authorization or storage.
3. Check the selected account and relayer against the handoff. Recall a previously saved
   public-safe RecallLoop preference from the exact profile namespace without old chat history.
4. Only with explicit write approval, save one synthetic fact in the exact facts namespace.
   A default `memwal_remember` can return a pending `job_id` before Walrus storage completes.
   Use the advertised `memwal_remember_status` where available, with that same job ID; a
   completed **`blob_id`**, not a queued/uploading state, is required before calling it saved.
   Do not resubmit the fact while its job is pending.
5. Recall the fact in a fresh tool session and in RecallLoop using that same wallet/account.
   Inspect supporting blob IDs and independently refreshed inventory.
6. If authorized recall is unexpectedly empty, check account, relayer, namespace, and pending
   status first. Use bounded `memwal_restore` with the exact namespace only if recovery is
   needed; it returns counts, not a transcript, and does not prove exhaustive recovery.

Tool names/deadlines vary by version; inspect advertised capabilities and the current
reference rather than assuming a status tool exists. A healthy relayer, copied notes, fixture,
or mock blob is not successful cross-tool or Mainnet validation.

## Reviewed local-builder checkpoints

The [local browser builder](LOCAL_BUILDER.md) uses the same owned MemWal account and wallet
facts namespace. In the local project's **Walrus → New checkpoint** drawer, write a small project/revision reference,
reviewed preferences, decisions/actual outcomes, and next steps. Inspect the assembled text
and separately consent to **Save reviewed checkpoint**. File/command approval never saves it
automatically, and the coding model has no memory-write tool.

Default **Auto-memory** also extracts facts from eligible current-user task prose after
successful completion, in that same facts namespace. It excludes files, prior history,
assistant output and terminal logs, with filters for obvious code/quotes/filler, known secrets
and explicit privacy requests. Check capture status for confirmed blob IDs; pending jobs may
finish later. This is independent of reviewed checkpoints and the other client's save settings.
See [automatic capture](MEMORY_PRIVACY.md#automatic-context-capture).

After a confirmed blob ID, a trusted Claude Code/Codex client can recall that context from
the exact handoff facts namespace. Conversely, the builder can **Recall and review**, then
explicitly select relevant wallet memories for a fresh coding task. Raw-memory retrieval
requires separate consent. Expiry or memory replacement/recheck removes old recall and
checkpoint authority, even when reconnecting the same account.

This carries **context, not the project**. There is no automatic source synchronization,
full workspace restoration, transcript/terminal-log backup, credential sharing, or approval
transfer. Keep source dumps/secrets out of reviewed fields. A revision/reference is user
supplied, not independently verified, and recalled text is never authorization to reconnect
a model, edit files, run commands, or perform transactions. Each tool retains its own
local project, credentials, reviews, and independently chosen save consent.

## Leaving a tool does not erase memory

RecallLoop logout removes its server connections/tab chat/project cache and locks its optional
device vault. It also clears local-builder page state and closes workers/preview/approval
capabilities; approved disk files remain. An explicitly saved encrypted copy remains until **Forget saved connections**
is confirmed; it is not exported to the other client. `memwal_logout` removes that client's
selected local credential file. None of these actions revokes the onchain delegate or erases
remote memories. Revoke unwanted delegates in the official dashboard.

Walrus Memory encrypts stored blobs, but the relayer processes plaintext and the selected
model receives recalled context. There is no end-to-end secrecy from those services or
remote delete claim. Use synthetic content for the [live checklist](VALIDATION.md#live-manual-validation).

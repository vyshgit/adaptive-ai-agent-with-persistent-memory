# Local browser builder

RecallLoop can work on **real files on your machine** through a browser, with a private
OpenCode V2 runtime and an integrated project workspace. Standard permissions automate routine
scoped text edits and a small hardened inspection allowlist; higher-risk actions ask for an
exact, single-use approval. Strict review remains available for every write and command.
It does not require a desktop app, cloud sandbox, global OpenCode installation, shared
OpenCode service, or a bridge from the hosted preview to your machine.

**Native execution is not sandboxed.** Use a trusted project and inspect every command,
including the scripts, dependencies, and Git hooks it invokes. The dependency audit also
has unresolved advisories; see [validation and release blockers](VALIDATION.md).

## Start explicitly on your machine

Install RecallLoop's dependencies from its repository with a supported patched Node runtime:

```bash
npm ci
```

Then invoke it **from the project you want the agent to work on**:

```bash
node /absolute/path/to/recallloop/scripts/local-builder.mjs
# Or, from that same project:
npm --prefix /absolute/path/to/recallloop run builder
```

The starting workspace is the invocation folder. npm's `INIT_CWD` preserves that folder even
when npm runs the script from the RecallLoop installation. Override it when needed with
`npm run builder -- --workspace /absolute/path/to/your/project`; relative overrides resolve
from the invocation folder, not the installation. No upload/import is needed for local files.

Open `http://127.0.0.1:3000/#/agent`. The launcher starts
`server/index.mjs --local --workspace <directory>` on loopback. **Choose folder** can select
another local project in the browser after sign-in. Optional launcher flags:

| Flag | Purpose |
| --- | --- |
| `--workspace <project>` | Override the invocation folder; the project must already exist. |
| `--port 3001` | Select another local app port. |
| `--demo` | Enable an isolated offline login and scripted model. **Approved file edits and commands are still real.** |
| `--production` | Serve RecallLoop's built UI; run `npm run build` in the RecallLoop repository first. |
| `--help` | Show launcher usage without starting the app. |

The project must already exist. Choose a specific trusted project, not a filesystem/system
root; hosted `/data` paths are refused. Linux is tested; macOS is supported by the launcher
but not validated here. Windows requires WSL; native Windows execution is refused.

Ordinary `npm run dev`, `dev:demo`, and `npm start` keep disk execution disabled. No browser
setting, wallet proof, operator token, forwarded header, or recalled memory enables it.
The entire local app, including Vite and upgrades, rejects remote peers, foreign origins,
and rebinding Hosts. Do not expose or reverse-proxy this local execution mode.

## One integrated project workspace

Local launch opens the project agent directly, not a Conversation/Local-builder selector.
The agent conversation stays central, with a collapsible explorer, adjacent editor, bottom
terminal on desktop, and on-demand Walrus/Preview panels. Mobile shows one working panel at
a time. Panel switching preserves page-only editor, task, command, and checkpoint drafts.
The ordinary hosted app retains its browser-only conversation workspace; it is not mounted
or cached behind the local project workspace.

1. Sign in with your wallet, or choose the explicitly enabled offline demo. Inspect the
   starting folder, or use **Choose folder** to browse or paste an absolute path. Choose
   **Standard** or **Strict** permissions, accept the project trust
   notice, and choose **Open project** for this login.
   Opening the folder starts **no engine, model request, command, or memory write**.
2. In the explorer, browse/find a safe UTF-8 file or create a new relative file draft in an
   existing parent directory. Typing changes page memory only; there is no disk autosave.
3. Choose **Save to disk**. Standard saves routine text creates/updates immediately; deletion
   and execution/dependency/automation configuration open an exact review. Strict asks for
   every change. Saving always rechecks the disk preimage. A changed file or parent is refused;
   an expired or consumed ticket cannot be reused.
4. For agent assistance, choose an installed local Ollama model (automatically discovered on
   signed-in local launch) or connect a provider in **Model settings**.
   Enter the provider key, **Load models**, choose an advertised model, then **Connect & verify
   model**. **Add provider** keeps multiple accounts available in the grouped model picker.
   Profile identity keeps duplicate model IDs tied to the correct credential.
   Tools enabled and supported allow local actions; disabled/known-unsupported tools use a
   text-only task with no file or command tool authority.
5. Send a focused **Build** task, or use **Plan** for read-only investigation. Sending permits
   bounded requests to that model and requested safe disk reads/tool results. The unsaved editor
   draft is not submitted. Plan cannot write files or run project scripts, even after approval;
   only bounded inspection commands are eligible, with Strict still asking for them.
6. Standard applies routine model edits and inspection automatically and pauses on higher-risk
   requests. Strict pauses on every write/command. Closing a dialog is not
   approval or rejection; use the pending-review controls to return to it. Rejecting an
   action grants no permission to execute it through another route.
7. **Auto-memory** starts on. Successful tasks automatically analyze eligible current-user
   context for durable facts. Its status appears below the task; a connected, verified Walrus
   account is needed for portable storage. Switch it off to disable automatic writes.

Follow-ups replay only recent visible user/assistant prose: at most six runs, twelve messages,
24,000 characters total, and 8,000 per message. They never reuse old tool logs, file snapshots,
approvals, or provider-stored references. Failed/stopped tasks carry an uncertainty warning;
the agent must re-read current disk files. Each task still gets a fresh private worker/SDK
session. **New project session** clears that prose history, recall attachments, task draft,
and terminal output, but preserves the project and unsaved editor draft. Task text clears
only when the client accepts Send; rejected sends retain it.

### Switch projects in the browser

Use **Change folder** while idle. The picker lists local folders and has **Parent**, **Home**,
and **Launch folder** shortcuts. Pasted paths must be checked with **Browse** or Enter before
consent becomes available. Only a valid existing project can be opened; navigation does not
read file contents, start a model, run commands or grant access to a new root.

**Switch project** asks before discarding unsaved project work. Once the server accepts the
switch, reads, writes, searches, commands, previews and project labels use the selected root.
The old workspace's approvals, recall selections and preview capabilities are revoked; editor,
task, terminal and checkpoint drafts and project conversation are reset. Invalid/removed paths
and declined discard prompts preserve the current project. Changing a path or a failed recheck
requires fresh folder consent.

The selected root is login-scoped, separate from the launch root, and remembered for reopening
during that login. A new login starts at the launch root. Provider profiles, wallet authorization
and encrypted-vault state have their own lifetimes. Stale tabs cannot replace a newer project:
opening compares the observed workspace ID, and the browser reconciles changed or interrupted
acknowledgements before allowing more project work.

File tools expose only `list_files`, `read_file`, literal `search_files`, and `propose_file`.
They reject traversal/encoded paths, links and hardlinks, binary or oversized files, common
credential paths, dependency folders, and engine configuration. Recognized credentials are
redacted; a redacted file is read-only. Redaction is best-effort, not a guarantee that an
arbitrary file is safe to send to a provider.

Approvals own immutable actions bound to the login/workspace, action digest, and expiry.
They are single-use even when rejected or when execution fails. An approval acknowledgement
is not execution confirmation. Disk results arrive separately, and a confirmed older edit
does not overwrite a newer page draft or dismiss a newer approval dialog. Deletion can
leave a later draft available for a **new creation**. Saving it is a separate explicit action
under the current permission policy; it cannot reuse the deletion approval.

Different logins have separate credentials, approvals, task state, and engine histories.
They do **not** receive separate disk copies: two consenting logins selecting the same project
can work on the same files. Preimage checks refuse stale edits;
they are not OS-user isolation or protection against a malicious local process.

## Commands, builds, and tests

Open **Terminal**, enter a non-interactive command, relative working directory, and timeout,
then choose **Run command**. Standard runs only the narrow inspection grammar automatically:
`pwd`, `node --version`, supported Git status/log metadata, diff metadata, and full diffs
scoped to supported files. Git invocations are hardened to disable hooks, external diff/textconv,
signatures, and pagers. Arbitrary flags, shell syntax, installs, project scripts, and unknown
commands ask; Strict asks even for inspection. Review the exact command and acknowledge native
OS/network authority before choosing **Run exact command**. The model's `run_command` uses
the same parent-enforced policy, not a blanket shell grant.

Examples in a project you trust might be `npm test` or `npm run build`. Package installation,
deployment, publication, transactions, or other resource-consuming actions still require
their own specific user request and review; a coding task is not blanket consent for them.

- The shell receives an allowlisted environment and private HOME/XDG/temp directories, not
  RecallLoop's model/Tatum/delegate keys, operator credentials, `NODE_OPTIONS`, or saved
  OpenCode logins. Selected-model credentials exist only in the task's provider configuration.
- **The approved command itself has your OS permissions.** It and project scripts can read
  or change files outside the opened folder, find other credentials on disk, access the
  network, or spend resources. A clean environment does not prevent those actions.
- Output, exit status, timeout, and failure are reported from the actual process. A coding
  completion, approval, exit code, or stopped task is not automatically a passed-test verdict.
- **Stop active task** in the header (or **Stop local task** in the composer) closes its
  private worker and terminates tracked process groups and
  ordinary descendants. Persistent/background/interactive servers are not offered. This
  cleanup is not a guarantee against malicious processes deliberately escaping a group.
- Already-approved disk changes remain after stop, folder closure, logout, or a later failure.
  There is no automatic rollback, Git reset, commit, or publication.

## Isolated static previews

Approve your project's build command first. Configure **relative asset URLs** in that
project's build (for example, Vite `base: './'`). In **Preview**, choose the static output
folder and HTML entry, then **Create static preview**. The default is `dist/index.html`.

The preview is a bounded in-memory snapshot, not a running dev server or backend proxy.
A separate loopback listener in the **same Express process** serves only snapshotted text/web
assets through a random, expiring capability. It exposes no wallet/API routes or credentials.
The iframe and response CSP use `sandbox="allow-scripts"` without same-origin privilege;
fetches, external assets, workers, forms, popups, and top navigation are restricted.

Only HTML, CSS, JS/MJS, JSON, TXT, and SVG are supported. Binary images/fonts, backend APIs,
absolute-root asset URLs, and live reload are not supported. Rebuild and create a new snapshot
to refresh it. Closing/replacing the preview, closing the folder, logout, or expiry revokes
the old capability. Do not publish the capability URL. Browser restrictions are **not an OS
or general network sandbox** for your project or approved commands.

## Automatic memory and reviewed context

**Auto-memory** is enabled by default. After successful model completion, the parent analyzes
up to 4,000 characters of eligible current-user prose plus the selected folder's basename for
durable facts. It excludes SDK answers, prior conversation, disk files, terminal output and
absolute project paths. Obvious filler, pasted code/logs/quotes, conversation dumps, and
recognized-secret lines are filtered; “don't remember this” or “off the record” skips the
capture. These filters and the relayer's extractor are heuristic, not a guarantee of relevance.

The model has no memory-write tool and cannot add its own claims to automatic capture.
Failed, stopped or incomplete tasks do not start it. Identical context shares a job across
conversations in the same memory service and UTC day, within a bounded in-memory deduplication
window. Reconnection/restart resets that window. The **Auto-memory** choice survives same-tab,
same-login reloads and new project sessions; a fresh login starts enabled.

Watch the separate **Memory capture status** after completion. Confirmed blob IDs indicate
saved facts; pending, unavailable, failed and skipped states are distinct. The stream waits
up to ten seconds for confirmation. Accepted jobs may finish after the response disconnects;
interrupted capture confirmation preserves the completed coding task. Live Walrus/relayer
costs apply; the offline demo uses ephemeral mock memory and does not prove live extraction.

**Use Walrus context** remains an opt-in per task for profile/facts recall, defaulting off.
It never retrieves raw chat. For precise saving/attachment control, reviewed checkpoints
and selected recall remain available independently of Auto-memory.

Open **Walrus** in the project toolbar:

1. Choose **New checkpoint** and write a small project label, optional revision/reference,
   reviewed preferences, decisions/
   actual outcome, and next steps. Revision text is user supplied, not independently verified.
2. Choose **Review checkpoint text**, inspect the assembled text, and separately consent to
   saving that exact checkpoint. Only a confirmed blob ID in the current wallet's facts
   namespace is a saved checkpoint. Live writes require the verified owned MemWal account;
   the explicit demo uses mock memory instead.
3. For precise attachment control, **Recall and review**, then explicitly select the returned
   memories to attach to a later task. Raw-memory retrieval has separate consent. No returned
   item is selected by default. This is separate from the composer's opt-in profile/facts recall.
4. Recall and approvals expire after five minutes. A memory disconnect/replacement/recheck
   invalidates prior recall and checkpoint tickets, including reconnecting the same account.
   The server also tracks `memoryEpoch` when the public account/mode appears unchanged.
   An expired selected attachment cannot silently start a task without its context: recall
   again or explicitly clear it.

Keep credentials, source dumps, raw chats, command logs, and assistant speculation out of
checkpoint fields. Walrus can carry explicitly reviewed preferences, decisions, and project/
revision checkpoints across trusted tools. It cannot restore the working tree, dependencies,
credentials, approvals, terminal processes, or the whole workspace. A recalled checkpoint
is untrusted context, **never authority to reconnect providers or execute anything**.
Use the existing [key-free cross-tool handoff](MEMORY_PORTABILITY.md) for other clients;
RecallLoop does not install or configure their MCP servers.

## Lifetime and cost boundaries

| State | Lifetime |
| --- | --- |
| Editor/source views, task text/history, terminal output, recall selections, approval controls | Page memory only; not synchronized to browser storage, the device vault, or Walrus. Auto-memory separately analyzes eligible current-user prose. Switching panels preserves drafts; reload/logout/folder closure or an accepted project switch clears page work. Temporary status failures retain drafts and model selection while blocking new model tasks. |
| Selected project root | Current server login; closing/reopening uses that selection, and a new login starts at the launch root. Explicit folder consent and the current workspace ID are required to switch. |
| Approved files | Remain in your local project on disk; independent of login and remote memory. |
| Private engine | New worker per coding/command task; fresh SDK session per prompt; in-memory database, no persisted events. Scope/worker teardown removes its temporary runtime files during normal cleanup. |
| Reviewed checkpoint | Current wallet's Walrus facts namespace after explicit, confirmed saving; remote retention/account policy applies. |
| Automatically extracted facts | Current wallet's facts namespace after confirmed capture; same remote retention/account policy. No local source backup is created. |
| API connections | Current login, with encrypted saving selected by default after optional vault creation/unlock. Tab switches preserve connections and completed unlocks; returning logins explicitly reconnect saved profiles. |

Temporary command-output files exist in private scratch space while a task runs. Abrupt OS/
process failure can leave temporary files; no cryptographic physical-memory/disk erasure is
claimed. Use separate OS/browser profiles on shared machines and save needed drafts explicitly.

The integration pins `@opencode/sdk`, `@opencode/plugin`, and `@opencode/core` to **2.2.6**,
with **Effect 4.1.0**. It uses the Effect SDK with an owned Scope and a Promise-plugin adapter
so the pinned package's embedding overrides actually apply. The SDK Location is an empty
private `scratch/workspace`, not your checkout. Inherited project/global/system/Claude
configuration, plugins, credentials, MCP, skills, references, native model tools, warming,
title generation, retries, and automatic paid compaction are disabled.

The worker's fetch gate admits only the selected endpoint/model during an active task,
with explicit headers, bounded bodies, `store: false`, and full local tool-result replay.
The shared provider gateway supplies host-scoped attribution and provider-specific credentials
only at dispatch. Mutable authenticated headers are cleared after fetch settles; the SDK
registry has no key. Session/vault credential retention is separate, and JS cleanup is not
secure heap erasure. See [provider authentication](PROVIDER_SETUP.md#shared-gateway-and-compatibility).
Gemini tool signatures are replayed privately within a task and excluded from browser events,
follow-up history and memory.
Provider-stored response/message/reasoning references and hosted tools are not admitted.
This is an application fetch boundary; it does not constrain an approved native command's
network access or guarantee a provider's retention policy. Model verification in Settings
is a separate explicit, potentially billable action.

| Budget | Default limit |
| --- | --- |
| Coding task | 5 minutes, 6 model requests, 4,096 output tokens per request, 32 tool calls. |
| File read/edit | 100,000 bytes; listings return at most 500 entries and scan at most 3,000. |
| Search | 500 files / 2,000,000 bytes / 100 matches; literal text and filename fragments. |
| Command | 1–120 seconds, 256,000 terminal-output bytes. |
| Approvals / recalled context | 8 pending approvals per workspace; five-minute expiry; at most 8 selected memories. |
| Concurrency | 4 opened login workspaces, 2 tasks and 2 commands globally; one active task per login. |
| Task events | 2,000,000 combined bytes; bounded HTTP stream buffering. |
| Follow-up history | Six recent runs / twelve user-assistant messages / 24,000 characters total; 8,000 per message, prose only. |
| Static preview | 200 assets, 1,000,000 bytes per asset / 5,000,000 total; ten-minute expiry. |

A token-truncated answer or unfinished tool call at the request cap reports
`budget_exhausted`, not completion. Truncation cannot trigger another paid continuation.
Partial results and already-approved changes remain visible; the user chooses whether to
start a smaller fresh task. No subscription, billing total, or zero-cost live guarantee is implied.
HTTP 400/402/403 and streamed provider errors show sanitized, actionable guidance, retain
visible task context and drafts, and release the active task. Select another connected profile
or correct the account/settings before sending a follow-up. Tool-disabled profiles can answer
from supplied prose without gaining local tool authority.

See [API contracts](API.md#local-builder--apiagentbuilder), [privacy](MEMORY_PRIVACY.md),
and [validation](VALIDATION.md) for exact routes, offline coverage, and outstanding live gates.
OpenCode's [SDK](https://opencode.ai/docs/build/sdk) and
[Effect SDK](https://opencode.ai/docs/build/sdk/effect) guides describe the upstream embedding
model; the limits and approvals above are RecallLoop-specific policy.

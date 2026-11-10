# RecallLoop

A wallet-authenticated, **OpenCode-style coding agent in your browser**, working in a local
project folder you select. Walrus automatically remembers relevant user context and carries
reviewed preferences, decisions, and next steps
across sessions and trusted tools. A hosted browser-only Talk / Plan / Build demo is also retained.
Built for **Tatum × Walrus Total Recall, Track 2 — Smart Agents for Real Life**.

The local workspace integrates the explorer, agent conversation, editor, and on-demand terminal,
preview, and Walrus context. Build can read/write real files and run commands; Plan is read-only.
Standard permissions automate routine scoped text edits and hardened inspection, while risky
actions ask for exact approval. Strict review is available for every write and command.
Follow-ups keep bounded page-conversation prose and re-read disk files. **Auto-memory starts
on**, extracting durable facts from eligible current-user prose after successful turns.
Walrus recall is opt-in per local task and manual checkpoints retain separate review. Neither context nor memory
transfers execution permissions or restores a whole project. This is contextual adaptation,
not model retraining. The hosted conversation demo remains memory-first, with browser-only
reviewed proposals and separately opted-in raw transcript storage.

> **Validation status (10 November 2026):** **357 unit/HTTP/CLI tests pass** in a complete
> bounded-concurrency run. All **98 Chromium scenarios** (66 hosted conversation + 32 local-builder)
> have passing observations across the full runs and targeted reruns.
> Typecheck and production build also pass locally. Real wallet-extension onboarding,
> live model generation, authorized MemWal access, Tatum reads, and Mainnet writes still need live validation.
> The dependency audit no longer blocks at high severity: the verified `zod@^4.6.6` override
> resolved all 6 high findings; **26 unfixable moderate npm-tooling findings** remain (CI gates
> on high). No verified Mainnet evidence has been generated, and no clean-audit claim is made.
> See [validation](docs/VALIDATION.md)
> and the [submission checklist](docs/SUBMISSION_CHECKLIST.md).

## Demo video

**Demo video:** _[paste your 2–3 minute demo recording URL here — YouTube, Loom, or a direct MP4]_

Upload once, paste the viewable link above, and submit the same URL in the hackathon
form's mandatory video field. The [submission checklist](docs/SUBMISSION_CHECKLIST.md)
keeps the suggested shot list and the honesty gates to capture on screen.

## Run locally

Use a patched Node.js runtime: **24.x (24.22.1+) or 26.12.1+**;
22.x (22.23.4+) is also supported.
Development was validated with Node 26.13.0. Run commands from this repository's root.

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:3000/#/agent**. One Express process serves both the API and React UI
on port 3000, bound to loopback by default. No credentials or database are required to start.

For an explicit, credential-free browser demo:

```bash
npm run dev:demo
```

Click **Try offline demo** on the sign-in screen. The model is scripted and mock memory is
isolated, process-local, and cleared when that demo session ends. Wallet sign-in on the same
server still requires you to connect your own APIs; it never inherits mock/owner defaults.

For local production serving:

```bash
npm run build
npm start
```

The npm startup/CLI commands load optional `.env`, then `.env.local`. Existing environment
variables take precedence. [.env.example](.env.example) documents operator policy and the
**separate** CLI/external-agent configuration. Neither file is needed for wallet onboarding.

### Work on a real local project

Ordinary startup keeps disk tools disabled. To enable them explicitly on your own machine:

Run this **from the project you want to work on**, after installing RecallLoop's dependencies:

```bash
node /absolute/path/to/recallloop/scripts/local-builder.mjs
# Or from the same project:
npm --prefix /absolute/path/to/recallloop run builder
```

The invocation folder is the default, including through npm's `INIT_CWD`. An explicit
`--workspace /absolute/path/to/project` overrides that starting location. From this repository,
`npm run builder` starts the same local app. Sign in, choose **Choose folder** to browse or
paste another local project path, choose Standard or Strict permissions, and consent with
**Open project**. Opening starts no engine or model request. The integrated workspace combines
the conversation, explorer, editor and on-demand panels. Browse real UTF-8 files, edit page-only
drafts, and use **Save to disk** under the selected policy; deletions always ask.

**Change folder** can switch projects while idle. A successful switch starts fresh project
history and clears project drafts after discard confirmation, revoking old reviews, recalled
attachments and preview access. The selected folder stays in this login; provider profiles and
the wallet remain available. Failed folder checks preserve the current workspace.

Choose an automatically discovered installed Ollama model, or connect a provider in Settings,
select a model from its catalogue, and send a focused **Build** or read-only **Plan** task.
Multiple provider/account profiles remain available in the model picker, including OpenAI,
Anthropic Chat compatibility, Gemini OpenAI compatibility, OpenRouter and Hugging Face.
OpenRouter's genuinely zero-priced catalogue models are marked free with provider limits.
Disabled or known-unsupported tools produce text-only assistance. Provider failures retain the
project, visible conversation and unsaved drafts so another connected profile can continue.
Each task uses a fresh private OpenCode V2 worker.
Follow-ups replay recent visible prose, not old source/tool logs; **New project session** clears
that history while preserving unsaved editor work. High-risk actions pause for an immutable,
expiring, once-only review. Changing permissions revokes pending file/command approvals.

**Terminal commands are native execution, not a sandbox.** They and project scripts have your
OS/network permissions, even though RecallLoop credentials are not supplied. Run only trusted
commands; actual output/exit/failure is shown, and Stop is never labeled test success.
**Preview** serves bounded static build snapshots on an isolated loopback origin in the same
process, not a backend proxy or persistent dev server. No desktop app, cloud sandbox, or shared
OpenCode service is needed. Linux is validated; macOS/WSL need platform-specific validation.

For an isolated scripted model, append `--demo`; approved edits and commands are **still real**.
The hosted `/data` preview cannot enable this mode or bridge to your machine. Builder source,
task history, terminal output, and drafts stay in page memory. Auto-memory analyzes only
eligible current-user prose, with a portable project label; reviewed checkpoints are also
available. Neither capture includes source/history dumps or restores a whole
workspace or authorizes execution. See [the local-builder guide](docs/LOCAL_BUILDER.md).

## Connect your wallet and APIs

Use localhost or HTTPS on a server you trust. **Do not share keys in chat or commit them.**

1. Install/unlock a Sui Wallet Standard wallet, select Mainnet, and choose **Connect Wallet**.
   If several accounts are available, select one and choose **Sign in with this account**.
   Approve the expiring personal-message challenge. Login is not a transaction and grants no
   spending permission. The wallet button shows your address/network and opens session
   details, including disconnect progress and errors.
2. Open **Workspace settings → Model**. Select AgentRouter or another supported provider;
   its API base/protocol and official key/model/documentation links are populated for you.
   Enter that provider's key, choose **Load models**, select a model from the returned catalogue,
   then **Connect & verify model**. Discovery does not install the key or generate an answer;
   an advanced exact-ID fallback appears only when discovery is unsupported. One bounded
   coding request verifies generation; billing and quotas apply. Streaming/tools are separate,
   optional checks. No account-specific AgentRouter default or RecallLoop approval is claimed.
   Use **Add provider** to keep another provider/account connected. Profile IDs bind duplicate
   model names to the correct credential. See [provider setup](docs/PROVIDER_SETUP.md).
3. When you want portable memory, open **Workspace settings → Tatum** and connect your
   **Tatum Mainnet API key** from [dashboard.tatum.io](https://dashboard.tatum.io). The server
   verifies a Sui checkpoint. A model can work without Tatum or Walrus Memory.
4. Create a Mainnet account and dedicated, revocable delegate key at
   [memory.walrus.xyz/dashboard](https://memory.walrus.xyz/dashboard). Enter the **account
   object ID** and **delegate private key** in **Workspace settings → Walrus Memory**, not
   your wallet's private key or seed phrase.
   Each user needs a **separate account owned by their signed-in wallet**, not a namespace
   in a shared account. RecallLoop checks the official Sui
   account type/owner and the delegate's signed metadata access before installing it.
   Account creation/delegate grants in the external dashboard can involve transactions and
   costs; RecallLoop's login signature does not authorize them.

Credentials use temporary tab/form memory and an isolated, one-hour server session, with
encrypted saving selected by default after optional vault creation/unlock. Plaintext keys
never enter browser caches or project exports. **Unsubmitted Settings fields and in-flight
checks survive section changes and browser-tab switches.** Failed/cancelled connections keep
their keys and selected models for retry; successful connections clear only submitted keys.
Closing Settings cancels checks and disposes secret form drafts while preserving a completed
vault unlock. Saved-model rechecks preserve unfinished forms. Model profiles, Tatum, and Walrus have targeted verification and
disconnect controls. Tatum disconnect also removes dependent Walrus authorization; none of
these disconnect actions deletes remote memories. Closing/cancelling refreshes saved status
because it can race a completed server check; it does not promise rollback.
Logout, expiry, or a server restart drops server connections; reconnect APIs after signing
in again, manually or with explicitly saved encrypted credentials.
Server-owner environment keys are **never** used by a wallet workspace.

Live generation consumes provider quota; capture, explicit remembering, and seeding can
consume Mainnet account quota. Walrus blobs are encrypted at rest, but the relayer processes
plaintext and your model receives recalled context. Use synthetic, non-sensitive data for testing.

### Remember connections on this device (optional)

In **Workspace settings → Advanced**, create an encrypted device vault with a unique
**12–256-character passphrase**, confirm it, and explicitly consent to device saving.
**Save this connection in device vault** is then selected by default when entering connections;
uncheck it for session-only use. Only successfully verified inputs are saved, with up to 12
independent model profiles alongside Tatum and Walrus.
Creating a vault does not recover existing cleared form/server keys.

On a returning login, use the **same wallet, browser profile, and site origin**, unlock the
vault, then explicitly choose **Reconnect saved connections**. Unlocking is local and makes
no API requests. Reconnect runs normal model/Tatum/Walrus verification and can consume quota;
it does not write memories. Nothing is saved in MemWal or synced to another device.

Browser-tab switches and Settings closure preserve completed unlocks. Explicit lock, logout,
expiry or page exit/reload locks the vault; another page needs its own unlock. Encrypted copies
remain until **Forget saved connections**, or an individual profile's **Forget**, is used. Forgetting does not disconnect already
verified server connections or revoke a delegate. Lost passphrases cannot be recovered.
Use separate profiles on shared devices; an unlocked/compromised browser can still see keys.
See [device-vault setup and limits](docs/DEVICE_VAULT.md).

## Try the learning loop

The following steps use the retained **hosted/browser-only conversation demo** (`npm run dev`
or `dev:demo`). Local tasks also have default Auto-memory; opt into **Use Walrus context**
when you want those saved facts recalled for a task. Reviewed checkpoints remain in **Walrus**.

1. Leave **Auto-memory** on and **Turn options → Also save raw chat** off.
   In **Talk**, say: “I prefer TypeScript and npm with small reviewable changes.” Wait for
   confirmed facts, or teach it explicitly in **Memory** as a preference without automatic capture.
2. Start a new conversation session. In **Conversation → Build**, ask: “Use my TypeScript and npm preferences to
   fix greet for missing and empty names.” Inspect the recalled-memory chips.
3. Open **Review**. Download the patch or inspect the before/after diff, then **Apply in
   browser**. A changed preimage blocks stale proposals; no disk files are overwritten.
4. Download the edited files, run their tests yourself locally, and use **Record outcome**
   to teach a verified result or correction. Approval alone is not proof that code works.
5. **Clear local history** and ask which preferences and lessons are remembered. This clears
   only the browser conversation cache, not remote memory or the browser project.

The offline demo exercises this flow without a network or a wallet. It proves the
orchestration, not Mainnet durability. For a live portability check, restart the server or
use a fresh browser, sign in with the **same wallet**, reconnect the same account, and recall
without supplying the old conversation. See [live test steps](docs/VALIDATION.md#live-manual-validation).

### Everyday planning, without repeated introductions

With **Auto-memory** enabled, teach a public-safe example in Talk: “My departure city is London. I prefer short trips and
EUR prices.” Start a new session and choose **Plan a short trip**, or ask to plan a quick trip
to Alaska. The deterministic offline example recalls the departure city before asking for
missing dates. Missing, uncertain, conflicting, or home-only location context needs a
clarification, not a guessed departure; explicit corrections override older memories.

**Suggested replies fill the composer only.** You can edit them or write your own, then press
Send to continue. A working plan is a set of proposed steps, not completed actions or approval.
With tools disabled, plans and questions appear as ordinary reply text. Travel suggestions
are drafts: conversation tools have no web search, live fares/weather/availability, booking,
purchasing, or transaction execution. Local native commands are separate authority, never
implied by a travel request. The scripted example demonstrates the loop, not travel expertise.

## Use your memory in Claude Code or Codex

After verifying your own Walrus connection, open **Memory → Prepare cross-tool setup**.
Copy the account ID or download the key-free setup notes. The handoff includes your verified
Mainnet account and the exact existing `profile`/`facts` namespaces—not credentials,
conversation history, memory text, or the exact raw namespace. It makes no memory writes.

Follow the official client guide linked in the panel, authorize a **separate delegate** for
that trusted tool on the **same account**, and use the returned namespaces explicitly.
Keep multiple accounts' client credentials isolated; a shared `~/.memwal/credentials.json`
can repoint other projects. Do not move memories to `default`, share delegates between users,
or assume a namespace restricts what a delegate can read. RecallLoop does not install MCP
servers, change your coding-tool configuration, or enable that tool's automatic saving.
See [cross-tool setup and verification](docs/MEMORY_PORTABILITY.md).

## Workspace capabilities and boundaries

The local workspace defaults to dark, with a collapsible project explorer, central agent,
adjacent editor, and on-demand terminal/preview/Walrus panels. Mobile keeps one work panel
visible at a time. Panel switches preserve drafts; no hidden hosted conversation/cache is
mounted in local mode. Native tasks can be stopped from the header even with the composer hidden.

The hosted conversation workspace is conversation-first, with a collapsible **Sessions**
sidebar. **Files**, **Review**, and **Memory** open on demand from the toolbar; mobile uses
the **Workspace view** selector. Panel collapse keeps drafts and project edits. Stored light
preference is honored, dialogs support keyboard navigation/focus restoration, and motion
respects reduced-motion preferences. Short entry/panel transitions, subtle button feedback,
and dialog-backdrop blur add depth; reading and editing surfaces remain solid.

### Conversation modes

The hosted conversation retains RecallLoop's existing bounded engine. **Talk is its default**;
Build is an explicit choice for browser-project proposals. Local launch instead mounts the
private OpenCode SDK workspace described above, defaulting to Build with read-only Plan
available. Both default to facts-only Auto-memory; execution grants and SDK transcripts remain local-launch-specific.

| Mode | What it does |
| --- | --- |
| Talk | Everyday conversation and planning using recalled context; no file-change proposals. |
| Plan | Multi-step plans using memories and relevant selected files; no file-change proposals. |
| Build | Help with the requested task; coding requests can use bounded inspection and review-required proposals. |

- Import text files/folders or a RecallLoop JSON project; edit and select context files.
  Downloads and JSON backup/loading controls remain in **Files → Project backups**.
- Assistant responses render Markdown headings, lists, emphasis, tables, blockquotes,
  links, and fenced code, including partial fences. User prompts remain literal text.
  Raw HTML is ignored, images are not fetched, and only explicit credential-free HTTP(S)
  links are clickable. Formatted code is never executed; review/downloads remain separate.
- Read-only tools: `list_files`, `read_file`, `search_files`, `recall_memory`, `sui_read`.
- Workflow tools: `plan_task` shares up to six proposed steps; `ask_user` asks one clarification
  with up to four optional replies. It pauses generation and blocks every other call queued
  in that round, including writes or proposals queued before the question.
- The parent owns automatic fact capture; the model has no `remember` write tool.
  `propose_file` is exposed only in Build. The UI's teaching/outcome actions are separate writes
  even with automatic capture off.
- Up to 3 tool rounds / 4 calls per round. Initial travel recall uses at most two parallel
  bounded lookups, including departure/preferences, within the normal context budget.
  Empty or unavailable retrieval is not proof that a detail was never supplied.
  These conversation tools expose no shell, unrestricted filesystem access, package
  execution, transaction signing, or automatic code application. Native commands require
  the explicit local launch and selected permission policy; higher-risk commands always ask.
- Up to 64 text files, 20,000 characters per file, and 160,000 selected context characters.
  Unsafe paths, common secret files, and binary imports are excluded.
- **Auto-memory** defaults on, analyzing eligible current-user prose after success. Obvious
  filler/code/logs/quotes, history dumps, recognized-secret lines and explicit privacy requests
  are filtered. The disable choice survives same-tab/login reloads; new logins start on.
  **Also save raw chat** is a separate opt-in, cleared by disabling Auto-memory or reloading.
  Recall still runs with capture off;
  explicit teaching/outcome actions can still write. Ordinary streaming retries once as
  non-streamed JSON only after an explicit unsupported-stream rejection—not key, approval,
  quota, or model failures. Capability probes never retry. A `pending` capture is **not** a saved
  memory; refresh inventory rather than blindly retrying accepted remote jobs.
- **Memory → Index & Mainnet evidence tools** contains bounded restore and explicitly
  confirmed seeding. **Workspace settings → Advanced** contains the optional encrypted
  device vault, legacy-cache cleanup, operator access token, scripted-model switch, and
  separate embedding-configuration guidance.
  Selecting only the scripted model leaves live memory connected; default Auto-memory
  and teaching/outcome actions can still incur writes.

## Architecture and persistence

```text
Browser: signed wallet gate + revocable, login-tagged conversation/project cache
         optional wallet-specific encrypted device vault (explicit unlock/reconnect)
    │ same-origin /api/agent, httpOnly cookie + session binding
Express: isolated credentials
    ├── Conversation: recall → bounded model/tools → reply/question/proposals → automatic facts
    ├── Local-only authority: private SDK worker → selected model + bounded file tools
    │       └── parent risk policy / exact approvals → real results → automatic user-context facts
    ├── MemWal SDK → official Walrus Memory Mainnet relayer (facts + reviewed checkpoints)
    └── Tatum → read-only Sui Mainnet HTTP GraphQL
Browser: page-only local builder + isolated static snapshot; conversation review/downloads remain separate
```

| State | Location / lifetime |
| --- | --- |
| Conversation history and browser-project edits | Wallet + login-tagged `sessionStorage` in this tab; unencrypted, reloadable during the same login, removed on logout/inactive login. Download backups before leaving. |
| Local-builder source views, drafts, tasks, terminal output, approval/recall controls | Page memory only; not synchronized to browser storage/vault/Walrus. Auto-memory separately analyzes current-user prose. Switching panels keeps drafts; reload/logout/folder closure clears page work. |
| Approved local files | Real project files on your machine; remain after stop/logout. They are not synchronized or restored by Walrus. |
| Private coding/command runtime | Task-scoped worker, private temporary HOME/XDG/output directories, in-memory SDK database and nonpersisted events; removed during normal teardown. |
| Live memories | Walrus Memory through the relayer, within its storage/retention policy. Reconnect the same account/wallet scope to recall. |
| Mock memories | Per-demo session in server memory; no durability or Mainnet evidence. |
| Active credentials, wallet sessions, recent-write hints | Server/tab memory; no persistent credential database. Shell environments do not inherit these credentials. |
| Saved API connections | Wallet/origin-bound encrypted `localStorage`, saved by default after optional vault setup/unlock. Passphrase required after locking; explicit verification required to reconnect. No plaintext credential cache or device sync. |

Memory namespaces are `rl:<identity>:profile`, `:facts`, and `:raw`. Wallet identity is
derived from the canonical signed address and survives new logins. Each wallet service is
bound to that identity. External agents use separate bearer-bound logical identities and
cannot request wallet, demo, or dashboard scopes. Default recall pins profiles and retrieves
facts; raw transcripts require separate capture/recall opt-ins. Consolidation analyzes **user statements only**, so unapproved
code and assistant claims do not automatically become established facts. Identical automatic
context shares a job across conversations in the same memory service and UTC day; this bounded
in-memory deduplication resets on reconnection/restart. Capture status distinguishes confirmed,
pending, failed, unavailable and skipped writes. See [automatic capture privacy](docs/MEMORY_PRIVACY.md#automatic-context-capture).

MemWal owns live semantic retrieval, indexing, and storage; the mock uses lexical matching.
Restore is bounded and does not guarantee full transcript replay. Logout revokes the tab
cache before workspace teardown, preventing late autosaves from restoring it. Expired or
changed logins prune inactive tab caches; cross-tab notifications clear stale work and stale
requests are rejected. Old persistent `localStorage` chat/project caches are never loaded
or migrated: use **Clear legacy browser caches** in sign-in or **Settings → Advanced** to
remove them explicitly. This cleanup affects old caches for all wallets on this site.
None of these actions deletes remote memories or revokes an onchain delegate. No remote
forget/delete feature is claimed.

The preserved `#/console` and `/api/walrus/*` are a **separate legacy/demo path** with a
Testnet-default publisher and file-backed lexical index. They are not wallet memory or
Mainnet evidence; the preview's local index is not durable. The Python
[quickstart](examples/python/quickstart.py) still targets this legacy API. Retrieval/vector
experiments remain parked, not the workspace's live retrieval backend.
The legacy index directory is configurable through `RECALLLOOP_DATA_DIR`; retaining it
requires writable, persistent self-hosted storage, which the preview does not provide.
See [legacy retrieval experiments](docs/API.md#parked-legacy-retrieval-experiments) for the
preserved benchmark/evaluation commands and their limits.

## Tests and CLI demos

```bash
npm test -- --test-concurrency=1
npm run test:builder
npm run benchmark:retrieval
npm run evaluate:retrieval
npm run typecheck
npm run build
npm run demo:agent
npm audit --fetch-retries=0 --fetch-timeout=15000
npm audit --omit=dev --fetch-retries=0 --fetch-timeout=15000

# One-time browser installation, then browser scenarios:
npx playwright install chromium
npm run test:browser
npm run test:browser:builder
```

Linux environments with an existing Chromium may use
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser`.
GitHub Actions is configured for Node 24.22.1/26.13.0 validation with bounded test concurrency
and separate hosted-workspace/local-builder browser matrix jobs. Both Node jobs also run the
preserved, credential-free legacy retrieval checks. The workflow was checked locally; the
The follow-up has no hosted CI result yet. The audit no longer blocks at high severity
after the verified `zod` override, but 26 moderate findings remain documented above.
Browser tests use signed **synthetic** wallets and mocked credential responses, not live
extension/provider authorization. The one-worker harness paces tests before login to respect
the unchanged 12-sign-ins/minute limit; it does not intercept authentication responses,
extend production request deadlines, or retry provider verification. Builder scenarios launch
the real local app against temporary projects and use the actual SDK with scripted loopback
responses; authenticated logout after each scenario cleans up workers/folders/previews.
The hosted Stop/Retry regression uses the real API/auth/mock-memory stack with a controlled
generator gate, so completion cannot race the Stop action. It verifies server cancellation,
zero capture before completion, and successful capture after an explicit retry.

`npm run demo:agent` defaults to a network-free two-session loop **even when environment
keys exist**. Live CLI execution is separate from browser sessions and opt-in:

```bash
npm run demo:agent -- --live --confirm-live-writes
```

For Mainnet seeding, first configure the CLI `MEMWAL_*`, Tatum, relayer, and network values
locally as described in `.env.example`. After reviewing the cost and account, explicitly run:

```bash
npm run seed:memory -- --confirm-mainnet \
  --wallet-address YOUR_PUBLIC_SUI_ADDRESS \
  --evidence docs/MAINNET_EVIDENCE.md
```

The wallet-address option selects the same namespace as the wallet UI and checks ownership.
Without it, the seed uses the CLI/external identity. The script requires 12 unique confirmed
blobs, independent relayer inventory, a delegate public key, and a Tatum checkpoint before
generating evidence. Evidence export is opt-in and **never overwrites an existing file**.
Seeding does not require a model key. Public relayer health alone does not prove account
authorization or a successful write.

## Security and documentation

Wallet login, origin checks, credential isolation, bounded requests/tools, and best-effort
redaction are implemented, but this remains a single-process prototype—not a production
multi-tenant service. Browser caches are not a security boundary against another person
inspecting your browser profile or using an active login. Use separate browser/OS profiles
on shared devices. External agent/admin endpoints fail closed without their independent
keys in **development and production**. The legacy publisher stores plaintext blobs;
it must not be used for private wallet chats. Never put unrelated secrets in selected files,
chat, or memory.

After the verified `zod@^4.6.6` override, the full and production audits report **26 moderate
findings and no high severity**, all propagated through the pinned OpenCode SDK chain from
npm tooling internals (`glob`, `minimatch`, `@npmcli/*`, `sigstore`,
`gcp-metadata`-adjacent packages) that have no compatible fix. CI gates the audit at high
severity rather than blocking on these. No unverified major override or clean-audit/security
claim is made. See
[dependency review](docs/VALIDATION.md#dependency-audit--gates-and-remaining-advisories) before release.

- [Local browser builder](docs/LOCAL_BUILDER.md) — invocation-folder launcher, integrated
  workspace, risk-based/Strict permissions, private SDK tasks, previews, and portable context.
- [API contract](docs/API.md) — workspace, external memory, and legacy routes.
- [Provider setup](docs/PROVIDER_SETUP.md) — independent connections, official links,
  exact account models, capability verification, and separate embeddings.
- [Authentication and deployment](docs/AUTHENTICATION.md) — wallet proofs, session binding,
  origin policy, and independent operator/API keys.
- [Memory privacy and consent](docs/MEMORY_PRIVACY.md) — account authorization, tab cleanup,
  plaintext-processing limits, and shared-device precautions.
- [Encrypted device vault](docs/DEVICE_VAULT.md) — optional setup, default encrypted saving after unlock, explicit
  reconnection, locking/forgetting, and passphrase-loss limits.
- [Cross-tool memory setup](docs/MEMORY_PORTABILITY.md) — verified handoff, isolated client
  credentials, exact namespaces, and honest end-to-end checks.
- [Validation and live test checklist](docs/VALIDATION.md).
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md) — deadline and outstanding evidence.

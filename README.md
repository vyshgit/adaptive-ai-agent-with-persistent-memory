# RecallLoop

A wallet-authenticated, memory-first **Talk / Plan / Build** workspace for everyday questions,
planning, and reviewed coding. Remember preferences, corrections, and lessons across sessions.
Built for **Tatum × Walrus Total Recall, Track 2 — Smart Agents for Real Life**.

RecallLoop recalls memory **before** answering, shows supporting blob citations, and shares a
working plan or asks about missing essentials when useful. Actual tool activity stays visible;
a clarification pauses the turn until you reply. Completed replies and clarification turns
can be captured through Walrus Memory. Build can propose changes to selected project files;
you review them before applying them **in the browser**. This is contextual adaptation, not
model retraining.

> **Validation status (9 November 2026):** the credential-free implementation passes
> **180 unit/HTTP/CLI tests** and **31 Chromium scenarios**. Typecheck and production build
> also pass locally. Real wallet-extension onboarding, live model generation, authorized
> MemWal access, Tatum reads, and Mainnet writes still need live validation.
> No verified Mainnet evidence has been generated. See [validation](docs/VALIDATION.md)
> and the [submission checklist](docs/SUBMISSION_CHECKLIST.md).

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

## Connect your wallet and APIs

Use localhost or HTTPS on a server you trust. **Do not share keys in chat or commit them.**

1. Install/unlock a Sui Wallet Standard wallet, select Mainnet, and choose **Connect Wallet**.
   If several accounts are available, select one and choose **Sign in with this account**.
   Approve the expiring personal-message challenge. Login is not a transaction and grants no
   spending permission. The wallet button shows your address/network and opens session
   details, including disconnect progress and errors.
2. Open **Workspace settings → Model**. Select AgentRouter or another supported provider;
   its API base/protocol and official key/model/documentation links are populated for you.
   Enter that provider's key and an **exact model ID available to your account**, then choose
   **Connect & verify model**. One bounded coding request verifies generation; billing and
   quotas apply. Streaming/tools are separate, optional checks. Discovery never verifies
   generation, and no account-specific AgentRouter default or RecallLoop approval is claimed.
   See [provider setup](docs/PROVIDER_SETUP.md) for endpoints, approval, and safe diagnostics.
3. When you want portable memory, open **Workspace settings → Tatum** and connect your
   **Tatum Mainnet API key** from [dashboard.tatum.io](https://dashboard.tatum.io). The server
   verifies a Sui checkpoint. A model can work without Tatum or Walrus Memory.
4. Create a Mainnet account and dedicated, revocable delegate key at
   [memory.walrus.xyz/dashboard](https://memory.walrus.xyz/dashboard). Enter the **account
   object ID** and **delegate private key** in **Workspace settings → Walrus Memory**, not
   your wallet's private key or seed phrase.
   The account must belong to the signed-in wallet. RecallLoop checks the official Sui
   account type/owner and the delegate's signed metadata access before installing it.
   Account creation/delegate grants in the external dashboard can involve transactions and
   costs; RecallLoop's login signature does not authorize them.

Credentials are held in temporary tab/form memory and an isolated, one-hour server session,
not browser caches or project exports. Submitted connection forms clear their key fields,
including failed/cancelled checks. Model, Tatum, and Walrus have separate verification and
disconnect controls. Tatum disconnect also removes dependent Walrus authorization; none of
these disconnect actions deletes remote memories. Closing/cancelling refreshes saved status
because it can race a completed server check; it does not promise rollback.
Logout, expiry, or a server restart drops connections; reconnect APIs after signing in again.
Server-owner environment keys are **never** used by a wallet workspace.

Live generation consumes provider quota; capture, explicit remembering, and seeding can
consume Mainnet account quota. Use synthetic, non-sensitive data for testing.

## Try the learning loop

1. In **Talk**, say: “I prefer TypeScript and npm with small reviewable changes.” Wait for
   confirmed capture, or teach it explicitly in **Memory** as a preference.
2. Start a new local session. In **Build**, ask: “Use my TypeScript and npm preferences to
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

In Talk, teach a public-safe example: “My departure city is London. I prefer short trips and
EUR prices.” Start a new session and choose **Plan a short trip**, or ask to plan a quick trip
to Alaska. The deterministic offline example recalls the departure city before asking for
missing dates. Missing, uncertain, conflicting, or home-only location context needs a
clarification, not a guessed departure; explicit corrections override older memories.

**Suggested replies fill the composer only.** You can edit them or write your own, then press
Send to continue. A working plan is a set of proposed steps, not completed actions or approval.
With tools disabled, plans and questions appear as ordinary reply text. Travel suggestions
are drafts: RecallLoop has no web search, live fares/weather/availability, booking, purchasing,
or transaction tools. The scripted example demonstrates the loop, not general travel expertise.

## Workspace capabilities and boundaries

The default workspace is dark and conversation-first, with a collapsible **Sessions**
sidebar. **Files**, **Review**, and **Memory** open on demand from the toolbar; mobile uses
the **Workspace view** selector. Panel collapse keeps drafts and project edits. Stored light
preference is honored, dialogs support keyboard navigation/focus restoration, and motion
respects reduced-motion preferences. Short entry/panel transitions, subtle button feedback,
and dialog-backdrop blur add depth; reading and editing surfaces remain solid.

The interaction is OpenCode-inspired, but uses RecallLoop's existing bounded engine—not an
OpenCode SDK integration or unrestricted execution agent. **Talk is the default**; Build is
an explicit choice when you want reviewable code proposals.

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
- `remember` writes explicit facts/preferences when capture is enabled; `propose_file` is
  exposed only in Build. The UI's explicit teaching/outcome actions are separate writes
  even with automatic capture off.
- Up to 3 tool rounds / 4 calls per round. Initial travel recall uses at most two parallel
  bounded lookups, including departure/preferences, within the normal context budget.
  Empty or unavailable retrieval is not proof that a detail was never supplied.
  No shell, unrestricted filesystem access, package execution,
  transaction signing, or automatic code application.
- Up to 64 text files, 20,000 characters per file, and 160,000 selected context characters.
  Unsafe paths, common secret files, and binary imports are excluded.
- **Turn options** exposes streaming/capture controls. Ordinary streaming retries once as
  non-streamed JSON only after an explicit unsupported-stream rejection—not key, approval,
  quota, or model failures. Capability probes never retry. A `pending` capture is **not** a saved
  memory; refresh inventory rather than blindly retrying accepted remote jobs.
- **Memory → Index & Mainnet evidence tools** contains bounded restore and explicitly
  confirmed seeding. **Workspace settings → Advanced** contains the optional operator
  access token, scripted-model switch, and separate embedding-configuration guidance.
  Selecting only the scripted model leaves live memory connected and can still incur writes.

## Architecture and persistence

```text
Browser: signed wallet gate + local project/transcript cache
    │ same-origin /api/agent, httpOnly cookie + session binding
Express: isolated credentials → recall → model + bounded workflow/tools → reply/question/proposals → capture
    ├── MemWal SDK → official Walrus Memory Mainnet relayer
    └── Tatum → read-only Sui Mainnet HTTP GraphQL
Browser: review proposals → apply locally → test downloads → record user-reported outcome
```

| State | Location / lifetime |
| --- | --- |
| Conversations and project edits | Wallet-scoped browser cache; not encrypted or cross-device. Download backups. |
| Live memories | Walrus Memory through the relayer, within its storage/retention policy. Reconnect the same account/wallet scope to recall. |
| Mock memories | Per-demo session in server memory; no durability or Mainnet evidence. |
| Credentials, wallet sessions, recent-write hints | Server/tab memory only; no new runtime disk writes. |

Memory namespaces are `rl:<identity>:profile`, `:facts`, and `:raw`. Wallet identity is
derived from the canonical signed address and survives new logins. External agents use
their bearer-bound logical identity. Default recall pins profiles and retrieves facts;
raw transcripts are opt-in. Consolidation analyzes **user statements only**, so unapproved
code and assistant claims do not automatically become established facts.

MemWal owns live semantic retrieval, indexing, and storage; the mock uses lexical matching.
Restore is bounded and does not guarantee full transcript replay. Clearing a local cache or
logging out does not delete remote memories. No remote forget/delete feature is claimed.

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
npm test
npm run benchmark:retrieval
npm run evaluate:retrieval
npm run typecheck
npm run build
npm run demo:agent
npm audit

# One-time browser installation, then browser scenarios:
npx playwright install chromium
npm run test:browser
```

Linux environments with an existing Chromium may use
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser`.
GitHub Actions is configured for Node 24.22.1/26.13.0 validation and a separate browser job.
Both Node jobs also run the preserved, credential-free legacy retrieval checks.
Browser tests use signed **synthetic** wallets and mocked credential responses, not live
extension/provider authorization. The one-worker harness paces tests before login to respect
the unchanged 12-sign-ins/minute limit; it does not intercept authentication responses,
extend production request deadlines, or retry provider verification.

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
using your browser. Never put unrelated secrets in selected files, chat, or memory.

- [API contract](docs/API.md) — workspace, external memory, and legacy routes.
- [Provider setup](docs/PROVIDER_SETUP.md) — independent connections, official links,
  exact account models, capability verification, and separate embeddings.
- [Authentication and deployment](docs/AUTHENTICATION.md) — wallet proofs, session binding,
  origin policy, and independent operator/API keys.
- [Scope amendments](docs/SCOPE_AMENDMENTS.md) — requested coding/wallet scope and conflicts
  with the committed original [plan](docs/ACTION_PLAN.md) and [prompt](docs/IMPLEMENTATION_PROMPT.md).
  Newer local edits in those two documents were preserved untouched and excluded from the
  continuation commits.
- [Validation and live test checklist](docs/VALIDATION.md).
- [Learning-loop blog draft](docs/BLOG_DRAFT.md) — not a published submission deliverable.
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md) — deadline and outstanding evidence.

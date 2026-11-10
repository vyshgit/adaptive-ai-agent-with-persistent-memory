# RecallLoop

A wallet-authenticated **coding agent in the browser** that carries your context across
sessions. It connects a Sui wallet, any OpenAI-compatible model provider, and Walrus Memory
(MemWal) on Sui: relevant preferences, decisions, and lessons are captured automatically and
recalled at the start of each session, so you don't re-introduce yourself. Built for
**Tatum × Walrus Total Recall, Track 2 — Smart Agents for Real Life**.

**Demo video:** _[paste your 2–3 minute demo recording URL here — YouTube, Loom, or a direct MP4]_

## What it does

- **Wallet sign-in** — you prove ownership of a Sui address with a signed challenge. No
  passwords; the session is one hour and drops on logout/restart.
- **Talk / Plan / Build modes** in one workspace with a file explorer, editor, review pane,
  and memory panel. Build can import files and propose reviewed code changes you apply in
  the browser; nothing runs on your disk.
- **Automatic memory capture** — durable facts are extracted from your messages after
  successful turns and stored in Walrus Memory. Raw-transcript saving is a separate opt-in.
- **Recall before answering** — each new task pulls the most relevant stored facts into
  context. Corrections override older memories; recall never grants the model new powers.
- **Portable wallet memory** — the same Walrus account can be used by Claude Code or other
  trusted tools; RecallLoop hands off setup notes, never credentials.

## Run locally

Requires Node.js **24.22.1+ or 26.12.1+** (validated on 26.13.0), from the repo root:

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:3000/#/agent**. One Express process serves the API and React UI on
port 3000 (loopback by default). No credentials or database are needed to start.

For a credential-free scripted demo without a wallet, run `npm run dev:demo` and click
**Try offline demo** — mock memory is isolated and cleared when the demo session ends.

Production serving:

```bash
npm run build
npm start
```

## Connect your wallet and APIs

Use localhost or HTTPS on a server you trust. **Never share keys in chat or commit them.**

1. **Wallet** — install/unlock a Sui Wallet Standard wallet, select Mainnet, choose
   **Connect Wallet** → **Sign in with this account**, and approve the expiring
   personal-message challenge. Login is not a transaction and grants no spending permission.
2. **Model** — in **Workspace settings → Model**, pick a provider (AgentRouter, OpenAI,
   Anthropic/Gemini/OpenRouter/Hugging Face compatible), paste its API key, **Load models**,
   select one, then **Connect & verify model**. Discovery doesn't generate; verification makes
   one bounded request (quota applies). **Add provider** keeps multiple accounts/profiles.
   See [provider setup](docs/PROVIDER_SETUP.md).
3. **Tatum** — in **Workspace settings → Tatum**, connect your Tatum Mainnet API key from
   [dashboard.tatum.io](https://dashboard.tatum.io). The server verifies a Sui checkpoint.
4. **Walrus Memory** — at [memory.walrus.xyz/dashboard](https://memory.walrus.xyz/dashboard)
   create a Mainnet account **owned by your signed-in wallet** and a dedicated revocable
   delegate key. Enter the **account object ID** and **delegate private key** (never your
   wallet key/seed) in **Workspace settings → Walrus Memory**.
5. **Optional device vault** — in **Settings → Advanced**, create an encrypted vault with a
   12–256-character passphrase to save verified connections on this device (encrypted
   `localStorage`, wallet/origin-bound). Reconnect on return needs the same wallet, browser
   profile, and origin plus an explicit unlock. See [device vault](docs/DEVICE_VAULT.md).

Credentials live in tab/form memory and a one-hour server session; saved copies are encrypted
at rest. Logout/restart drops server connections — reconnect after signing in again.
Live generation consumes provider quota; capture and seeding can consume Mainnet account
quota. Walrus blobs are encrypted at rest, but the relay and your model see plaintext — use
synthetic, non-sensitive data while testing. Memory **embeddings come from the Walrus
relayer** — no embedding key is needed in the workspace — and the optional operator-side
vector experiment (`npm run evaluate:vector`), not the wallet workspace, is the only thing
that uses your separate, billable `OPENAI_API_KEY`. See
[provider setup → Embeddings](docs/PROVIDER_SETUP.md#embeddings-are-separate).

## Try the learning loop

> The **offline demo** seeds a four-file `src/greet.ts` sandbox for this scenario. A wallet
> workspace starts **blank** — import your files, or add a file first to follow the same
> steps live.

1. Keep **Auto-memory** on. In **Talk**, say: “I prefer TypeScript and npm with small
   reviewable changes,” and wait for confirmed facts (or teach it manually in **Memory**).
2. Start a **new session**. In **Build**, ask: “Use my TypeScript and npm preferences to fix
   greet for missing and empty names.” Recalled-memory chips show what was retrieved.
3. Open **Review**, inspect the diff, and **Apply in browser** — a stale proposal is blocked
   if the file changed. No disk files are touched. Applied and pending proposals can be
   removed individually (**Remove from queue**) or the whole queue cleared (**Clear queue**)
   without reverting applied edits.
4. Download the result, test it yourself, and **Record outcome**. Approval is not proof the
   code works. Overall the Files pane can export the whole project as a **zip** and preview
   it offline in a sandboxed frame.
5. **Clear local history** and ask what's remembered — this clears only the browser cache,
   not remote memory.

## Capabilities and boundaries

| Mode | What it does |
| --- | --- |
| Talk | Conversation and planning using recalled context; no file-change proposals. |
| Plan | Multi-step plans using memories and selected files; no file-change proposals. |
| Build | Task help with bounded inspection and review-required file proposals. |

- Read-only tools: `list_files`, `read_file`, `search_files`, `recall_memory`, `sui_read`.
  Workflow tools: `plan_task` (up to six steps) and `ask_user` (one clarification). Build
  exposes `propose_file`, review-gated — the model has no write, shell, or signing tool.
- Files stay browser-local: import by folder or file, edit in place, remove any file, and
  export the project as a **zip** (older JSON backups still import). An HTML entry renders in
  a **sandboxed offline preview** — inlined local CSS/JS/SVG, external and missing references
  stripped, no network access and no app-origin access.
- Up to 3 tool rounds with 4 calls per round; up to 64 text files / 20,000 characters each.
  Secret files, unsafe paths, and binary imports are excluded.
- **Auto-memory** captures approved facts only from your statements after success —
  unapproved code and assistant claims never become memories. Disabling it persists for the
  login; recall still works with capture off.
- Markdown rendering is sandboxed (no HTML execution, no image fetches). Formatted code is
  never executed; apply/download stay manual and explicit.

## Architecture and persistence

```text
Browser: signed wallet gate + login-tagged conversation/project cache
         optional wallet-specific encrypted device vault (explicit unlock)
    │ same-origin /api/agent, httpOnly cookie + session binding
Express: isolated credentials, no durable database
    ├── Conversation: recall → bounded model/tools → reply/proposals → automatic facts
    ├── MemWal SDK → Walrus Memory Mainnet relayer (facts + reviewed checkpoints)
    └── Tatum → read-only Sui Mainnet HTTP GraphQL
```

| State | Location / lifetime |
| --- | --- |
| Conversation history and project edits | Wallet + login-tagged `sessionStorage` in this tab; download backups before leaving. |
| Live memories | Walrus Memory via its relayer; recall by reconnecting the same account/wallet. |
| Mock memories | Per-demo session in server memory; no durability. |
| Credentials and wallet sessions | Server/tab memory and encrypted `localStorage`; no credential database. |

Memory namespaces are `rl:<identity>:profile`, `:facts`, and `:raw` — wallet identity comes
from the canonical signed address and survives new logins. Raw transcripts stay behind a
separate opt-in. Logout revokes the tab cache; expired logins prune inactive tabs. Nothing
here deletes remote memories or revokes an onchain delegate, and no remote forget/delete
feature is claimed. See [memory privacy](docs/MEMORY_PRIVACY.md).

## Tests

```bash
npm test                        # 276 unit/HTTP tests
npm run typecheck
npm run build
npm run demo:agent              # credential-free two-session recall loop
npx playwright install chromium
npm run test:browser            # 65 Chromium scenarios (signed synthetic wallets)
npm audit                       # dependency audit (clean: 0 vulnerabilities)
```

Browser tests use signed **synthetic** wallets and mocked credential responses — never live
extension/provider authorization. Mainnet seeding for evidence generation is a separate
explicit CLI: `npm run seed:memory -- --confirm-mainnet --wallet-address YOUR_PUBLIC_SUI_ADDRESS
--evidence docs/MAINNET_EVIDENCE.md` (configure `MEMWAL_*`, Tatum, and relayer values in
`/local .env` as documented in [.env.example](.env.example) first). Export never overwrites
an existing evidence file.

## Security

Implemented: wallet proofs, origin checks, credential isolation, bounded requests/tools, and
best-effort redaction. This remains a single-process prototype — not a production
multi-tenant service. Browser caches are not a security boundary on shared devices; use
separate profiles. All external agent/admin endpoints fail closed without their independent
keys. Never place unrelated secrets in selected files, chat, or memory.

## Documentation

- [API contract](docs/API.md)
- [Provider setup](docs/PROVIDER_SETUP.md)
- [Authentication and deployment](docs/AUTHENTICATION.md)
- [Memory privacy and consent](docs/MEMORY_PRIVACY.md)
- [Encrypted device vault](docs/DEVICE_VAULT.md)
- [Cross-tool memory setup](docs/MEMORY_PORTABILITY.md)
- [Validation and live test checklist](docs/VALIDATION.md)
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md)

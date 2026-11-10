# Validation and live evidence status

Updated 10 November 2026. **Local runtime/offline checks pass; live integration and the
hackathon submission remain incomplete.** The audit leaves 26 unfixable moderate npm-tooling
findings (0 high, CI gates on high); no real Mainnet blob evidence has been generated and no
success evidence file is checked in.

## Reproducible local checks

Run from the repository root with a supported patched Node runtime. Results below were
obtained on Linux with Node 26.13.0 and system Chromium.

| Command | Observed result |
| --- | --- |
| `npm test -- --test-concurrency=1` | **357 passed, 0 failed, 0 cancelled, 0 skipped** in 238.0 seconds, including actual embedded SDK execution, folder switching, shared provider dispatch, private Gemini signature replay, profiles, vault migration, automatic memory, and HTTP privacy regressions. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; production JavaScript **615.32 kB / 179.53 kB gzip**. Vite reports its standard over-500-kB chunk-size warning; no build errors. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser` | Full run: **64 passed, 2 failed** in 16.9 minutes. Both failed scenarios passed the targeted rerun in 16.5 seconds after deterministic Stop-test gating; **all 66 scenarios have passing observations**. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser:builder` | Full run: **31 passed, 1 failed** in 13.5 minutes. The folder-navigation renderer-crash case passed unchanged in a 34.7-second targeted rerun; **all 32 scenarios have passing observations**. Uses real local launcher/projects/SDK and scripted loopback models, plus labeled UI-only fixtures. |
| `npm run builder -- --help` | Passed; prints explicit local-project launch and native-execution warnings without starting the app. |
| `npm run demo:agent` | Passed, isolated mock; first-session fact recalled in a new session, scripted review-only code proposal; no network/provider/Mainnet calls. |
| `npm run benchmark:retrieval` | Passed; four synthetic lexical cases, Recall@3 / MRR **1 / 1**. |
| `npm run evaluate:retrieval` | Passed; synthetic evaluation Recall@3 / MRR **1 / 1**, hard-negative rate **0.375**, **0 cross-agent leaks**. Not a live semantic-quality benchmark. |
| `npm audit --fetch-retries=0 --fetch-timeout=15000` / with `--omit=dev` | Post-override state: both exit **1** only under the default low-level gate due to **26 moderate** npm-tooling findings; with `--audit-level=high` both exit **0** (0 high). CI gates on high. The production-only result reflects the same rerun on the current lockfile. See [dependency review](#dependency-audit--gates-and-remaining-advisories). |

The folder/gateway continuation reran the complete unit suite, typecheck/build, both Chromium
suites, launcher help, CLI demo and retrieval checks. The first unit run overlapped both browser
suites and recorded **354 passed / 3 cancelled by timeout**. Those three SDK cases passed
unchanged with bounded concurrency; the subsequent complete **357-test** run passed as shown above.
Only the Stop-test fixture and documentation/CI reconciliation followed that full unit run.

Browser counts combine full runs with targeted reruns: **98 scenarios total**. The Settings
focus scenario timed out under load and passed unchanged on rerun. The Stop test reached its
button after the short mock stream had completed; it now uses the real API/auth/mock-memory
stack with an injected generator gate, checks actual server abort and zero capture, then
verifies successful retry/capture without a duplicate user message. The folder-navigation
failure included a Chromium renderer crash; the unchanged scenario passed on rerun. Full-run
artifacts remain in `.playwright/test-results/` and `.playwright/builder-test-results/`; reruns
use separate directories. Reproduce the targeted browser checks with:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser -- \
  --grep='settings support arrow-key tabs|stopping a streamed turn' \
  --output=.playwright/hosted-rerun-results --reporter=list
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser:builder -- \
  browser/local-builder/folders.pw.mjs --grep='folder navigation' \
  --output=.playwright/folder-rerun-results --reporter=list
```

Browser suites use separate ports and one worker each. Run the suites sequentially on
resource-constrained machines. Production permissions, execution/authentication limits and
request deadlines remain intact. No dependency changes were applied during this continuation.

CI repeats bounded-concurrency unit/type/build/demo/audit checks with Node 24.22.1 and 26.13.0 and runs Chromium
scenarios separately. Historical follow-up [unit/build CI](https://github.com/vyshgit/adaptive-ai-agent-with-persistent-memory/actions/runs/42495197754)
and [browser CI](https://github.com/vyshgit/adaptive-ai-agent-with-persistent-memory/actions/runs/42495202400)
are completed/success for `728cb9995ecebb8cd46ac6538863a80c23593a48` on
`feat/recallloop-coding-workspace`, merged through PR #2. Those results are **not redesign CI**.
The current `feat/recallloop-dark-provider-redesign` branch has local validation only; it has
not been pushed and has no hosted run or PR. Earlier redesign work has local commits through
`74e9c4d`; the privacy, portability, device-vault, local-builder, provider and automatic-memory
follow-up remains **uncommitted**.
A new hosted run is still required before any future merge. Browser reports, screenshots,
and traces are generated under gitignored `.playwright/`, not submitted as live evidence.

The workflow now includes separate `workspace` and `local-builder` browser matrix jobs.
Its YAML, matrix conditions, npm script references and hidden failure-artifact upload were
checked locally. The current audit still fails the dependency CI gate; historical green
runs do not establish a clean result for the added SDK dependencies.

### What the tests establish

- Real local Ed25519/Secp256k1/Secp256r1 signature verification; exact-message/address binding,
  expiring single-use challenges, cookie rotation, replay resistance, logout/expiry cleanup.
- Same-origin/operator gate, principal-bound wallet/demo memory services, no owner credential
  fallback, stale-tab/session binding, and old-wallet disconnect isolation. Two signed wallets
  connect separately owned synthetic accounts; borrowed identities/accounts/delegates cannot
  select another user's memory. External keys are unique, cannot grant wallet/demo/dashboard
  identities, and fail closed without configuration in development and production.
- Injected upstream account-type/Shared-owner checks, signed delegate authorization staging,
  and rollback/cleanup when verification fails or logout races an upstream result.
- Mock ingest/recall/inventory, user-only fact consolidation, profile/context budgets,
  idempotency behavior, pending-write capacity, partial failures, inventory pagination,
  tombstones, and refusal to count mock/unconfirmed or wrong-namespace write evidence.
- Chat and local coding default to facts-only Auto-memory after successful completion. Only
  eligible current-user prose is analyzed, with filters for filler, code/logs/quotes, pasted
  conversations, recognized-secret lines and explicit privacy requests. History, files,
  assistant claims and tool/terminal output are excluded. Raw chat needs explicit consent;
  operator raw settings cannot enable it. The model's `remember` tool is always disabled.
- Automatic jobs deduplicate across conversations within the same memory service and UTC day,
  before write admission. Pending jobs are shared and never evicted; failed analyses permit
  retry. Disposal blocks late metadata publication, and pending writes retain their capacity
  slots. These deterministic checks do not establish live extraction quality.
- Empty, incomplete, failed and stopped generation does not initiate capture. A successful
  clarification captures only the actual user statement. Confirmed, skipped, unavailable,
  failed and pending capture have distinct UI states; delayed/interrupted confirmation preserves
  completed coding work. Accepted remote jobs may still finish after response disconnection.
- Revocable wallet-plus-login tab caches preserve same-login reload, but logout/expiry/account
  changes prune old data before late autosave/exit callbacks can recreate it. Cross-tab auth
  notifications fail safely on network errors. Confirmed legacy cleanup never imports private
  persistent caches or deletes current tab work, encrypted vaults, or unrelated settings.
- Read-only, owner-verified cross-tool setup rejects account/namespace overrides and exports
  no credentials, chats, memory text, or exact raw namespace. Copy/download, retry, and stale
  account/logout handling are checked offline, not through a live Claude Code/Codex client.
- Genuine WebCrypto vault encryption, wallet/origin binding, random salts/IVs, tamper and
  incorrect-passphrase failures, explicit creation consent, default encrypted saving after
  unlock with a per-connection opt-out, verified-input-only saving, and no plaintext fallback.
  Multiple encrypted profiles retain credential identity through reload, targeted reconnection
  and individual forgetting; legacy single-model vaults migrate on their next save.
  Unlock is local; explicit reconnect verifies sequentially, skips
  Walrus after failed/missing Tatum, redacts independent errors, makes no memory writes, and
  stops later requests after cancellation, locking, logout, or another unlock. Delayed crypto
  and cross-tab forgetting cannot restore a stale saved copy in the tested races.
- Responses/Chat Completions wire parsing with **mock HTTP fixtures**, streaming tools,
  bounded outputs, honest incomplete/error handling, no client impersonation, and redaction
  across arbitrary stream chunks. Stateless Responses rounds/follow-ups use `store: false`,
  locally reconstructed text, and matching function `call_id` pairs without provider-stored
  response/message/reasoning references. This is not a live routing diagnosis or a claim
  that the previously reported Azure resource error is fixed.
- One gateway handles discovery, generation and actual SDK dispatch. Tests cover OpenAI,
  Anthropic, Gemini, OpenRouter, Ollama and Hugging Face authentication, endpoint/method
  admission, host-scoped attribution/organization headers, no SDK registry credential,
  concurrent profile isolation and mutable-header cleanup after success, HTTP error,
  transport failure and abort. Header cleanup is not secure heap erasure.
- Tool stripping is scoped to explicit disablement, exact-model/protocol verification and
  OpenRouter capability metadata; model names never determine support. Forced-call rejection
  remains distinct from unsupported automatic tools. Text-only replies cannot obtain hosted,
  worker or parent tool authority; a subsequent actual SDK task can use its new profile's tools.
- Gemini JSON/SSE and actual SDK replay preserve bounded private signatures across parallel/
  sequential tool rounds without browser/history/memory exposure. Native/Responses mismatch
  is refused before dispatch. Sanitized errors distinguish numeric Google statuses,
  unsupported parameters, project prerequisites, signature failures and quota/restrictions,
  including HTTP 200 JSON and streamed errors. No live Gemini 400 cause is established.
- Separate account-specific model discovery before connection, without installing credentials
  or claiming generation verification; catalogue eligibility is bound to its key/base, and exact-ID
  fallback is available only when discovery is unsupported. Bounded non-executing generation/
  stream/tool verification, safe errors, failed-replacement rollback, and failed-recheck status.
- Multiple provider/account profiles route duplicate model IDs by identity in chat and coding,
  with targeted verification/disconnection. An explicit connection choice survives delayed
  catalogue refresh; passive discovery/status refresh does not rebind another selected profile.
  Hugging Face uses its compatible router/token; OpenRouter free labels require zero prices.
  Signed-in local discovery reads only fixed-loopback, installed key-free Ollama entries and
  starts no generation/download. Browser fixtures cover selection, refresh and model removal.
- Unsubmitted Settings credentials/model selection and in-flight checks survive section changes
  and browser-tab switches. Failed/cancelled connections retain their key/catalogue selection;
  successful connections clear only submitted credentials. Closing Settings disposes secret
  drafts but preserves a completed vault unlock. Explicit lock, page exit/reload, logout,
  expiry and changed ciphertext invalidate access.
- Non-secret setup/model/workspace preferences and the Auto-memory disable choice survive
  same-tab/login reloads, then clear on logout/inactive login. Raw-chat and execution consent,
  catalogues, credentials, source, commands and approval capabilities are not cached as preferences.
- Memory-first travel recall with supplied, missing, uncertain, conflicting, corrected, or
  unavailable departure context. Full timestamps preserve same-day correction context; short
  follow-ups use previous user statements, not assistant guesses. These are deterministic
  prompt/orchestration fixtures, not live-model reasoning or travel-quality evidence.
- Proposed working plans, structured question-only JSON/SSE turns, real-reply continuation,
  and blocking all other tools in a clarification round, including earlier queued writes.
  Draft suggestions never submit themselves or become user facts before Send.
  Long clarification history retains plan/question metadata within a 4,000-character entry,
  preserving the preceding task and actual reply inside the server's 12,000-character budget
  without truncating the displayed answer. Client/server and cached-browser regressions cover it.
- Browser-only import/edit/export, reviewed proposals, exact patches (including `git apply
  --check` fixtures), pending-cache navigation flushing, Stop/Retry, mobile layout/themes,
  keyboard-accessible modals, safe Markdown, and reduced-motion-aware premium effects.
- CLI defaults/confirmation guards, network-free two-session flow, wallet namespace mapping,
  and evidence exports that refuse invalid proof or existing files.
- Invocation-folder local launch, including npm's `INIT_CWD`, with an explicit `--workspace`
  override and whole-app/Vite loopback origin/Host guard; hosted execution
  stays disabled. Folder consent starts no worker/request/write. File tools refuse traversal,
  credentials/configuration, links/hardlinks, binary/oversized content, and changed preimages.
- Authenticated local folder navigation and consented switching outside the launch root:
  atomic destination validation, observed-workspace comparison, idle-only admission,
  login-scoped selection, workspace-capacity replacement, invalid/removed/private paths,
  capability revocation and selected-root file/command/preview/capture routing. Browser
  coverage includes draft confirmation, picker cancellation, stale tabs/status and
  interrupted acknowledgements.
- Immutable, expiring, single-use file/command/checkpoint approvals, real disk creation/update/
  deletion, no model self-approval, and cancellation/logout/startup races without resurrected
  authority. Confirmed older edits and acknowledgements preserve newer page drafts/reviews.
- Parent-enforced Standard/Strict permissions: routine scoped text edits and narrowly allowlisted
  hardened inspection can run automatically; deletion, execution/dependency configuration,
  installs, project scripts, and unknown commands ask for exact approval. Plan cannot mutate or
  gain execution permission for project scripts, and its worker omits mutation tools.
- Actual private OpenCode SDK workers: fresh SDK sessions with bounded visible follow-up prose,
  never old tool logs or provider-stored references; allowlisted environments/private
  HOME/XDG, no inherited configuration/plugins/credentials, and cleanup of ordinary shell
  descendants. Real command output/nonzero exit/timeout/Stop is never fabricated test success.
- Scripted loopback Chat/Responses SDK adapters enforce the exact selected endpoint/model,
  explicit headers, bounded traffic, local tool-result replay, and no provider-stored references.
  Six-request/tool/output budgets, token truncation, and upstream refusals produce honest
  failure without automatic extra paid requests. This is not live-provider acceptance evidence.
- Integrated explorer/conversation/editor with on-demand terminal/preview/Walrus panels; no
  hidden hosted conversation/cache in local mode. Panel switches preserve drafts, covered editors
  can be revealed, and failed status refreshes retain local work/model selection while blocking new
  tasks. Rejected Send and declined discard confirmation preserve their task/new-path drafts.
- A real-launcher browser task receives a scripted streamed 402, retains partial output and
  unsaved source, then switches to a second connected text-only profile. Actual SDK follow-up
  dispatch includes bounded visible conversation, uses the second key, excludes the unsaved
  draft and provider error body, and performs no tool execution or memory write.
- Conversation/terminal output follows the tail, preserves deliberate scrollback across panel
  switches/resizing, and restarts terminal following for each new command. UI-only stream fixtures
  test presentation timing without SDK/provider calls, commands, file edits, memory writes, or grants.
- Page-only builder drafts/history/output, opt-in profile/facts recall per task and separately
  selected reviewed attachments/raw retrieval, five-minute attachment expiry, memory replacement/
  recheck revocation including an unchanged public account binding,
  and separately reviewed checkpoint saving alongside current-user-only automatic facts.
  Neither path automatically synchronizes source, task history or terminal output.
- Bounded static snapshot assets, byte/count limits and disk-growth rechecks, isolated preview
  origin/CSP/iframe restrictions, cancellation, expiry, and logout revocation. Static preview
  restrictions do **not** establish OS/network sandboxing for approved native commands.

### Browser scenarios

| Suite | Scenarios | Coverage |
| --- | ---: | --- |
| `browser/accessibility.pw.mjs` | 5 | Conversation-first panels and sessions preserve drafts/approval controls; arrow-key settings tabs, focus trap/Escape/restoration; stored themes; solid reading surfaces, dialog-backdrop blur and reduced motion; onboarding, composer and panels from short mobile to desktop. |
| `browser/device-vault.pw.mjs` | 11 | Creation consent and default encrypted saving after unlock; real cryptographic round trips; multiple profiles with duplicate model IDs and distinct keys; targeted reconnect/forget; wrong passphrases/tampering; wallet isolation; retained failed keys; cancelled late crypto/reconnect; tab/unlock continuity; cross-tab forgetting; blocked storage; demo/mobile controls. |
| `browser/markdown.pw.mjs` | 2 | Lists/headings/tables, safe links, exact code and citation/review controls; no HTML execution, remote image fetching, unsafe links, or unreadable partial fences. |
| `browser/privacy.pw.mjs` | 8 | Default automatic facts with separate raw consent, cross-conversation deduplication and login-scoped opt-out; logout/cache races; inactive-login pruning; cross-tab auth/network failure; handoff refusal/loading/error/retry/copy/download/stale results; legacy cleanup. |
| `browser/providers.pw.mjs` | 14 | Official presets including Anthropic compatibility and Hugging Face; discovery versus verification; retained failed keys; safe errors; Cancel/Close races; stale wallet callbacks; targeted profiles; delayed catalogue selection; OpenRouter free/tool labels; HF/Gemini/OpenRouter generation-error help and retry at desktop/narrow sizes; operator-token failure. |
| `browser/settings-drafts.pw.mjs` | 5 | Mounted drafts and running discovery across Settings/browser tabs; closing disposal; successful-only submitted-key clearing; saved-model/mock preservation; key/base-bound eligibility, failed/cancelled refresh, and unsupported-discovery-only exact-ID fallback. |
| `browser/settings-preferences.pw.mjs` | 6 | Same-login setup reload, independent provider defaults, selective forgetting, inactive-login pruning, blocked storage, and restored model/sidebar/streaming/Auto-memory with page-only raw consent. |
| `browser/wallet.pw.mjs` | 4 | Distinct connect/sign/verify progress; actionable wallet/signature declines; selected Mainnet account only; server logout before optional extension removal and visible disconnect errors. |
| `browser/workflow.pw.mjs` | 4 | Recall departure before asking dates; question-only reload/continuation; draft-only suggestions and preserved drafts; keyboard/short-mobile reachability; long cached clarification continuation through the real local server; proposed plans and literal hostile metadata. |
| `browser/workspace.pw.mjs` | 7 | Signed onboarding and cache/export redaction; offline recall → code proposal → exact download/review/application → outcome → fresh-session recall; safe import/edit/export and keyboard navigation; deterministic latest-cache flushing; cross-tab wallet isolation; mobile/theme/settings; Stop/Retry without duplicate users. |
| `browser/local-builder/folders.pw.mjs` | 7 | Real folder navigation/keyboard/consent across desktop/mobile themes; selected-root reads/writes/commands/previews; draft confirmation; invalid/removed/private destinations; cancelled loading picker; stale tab/status; interrupted switch acknowledgement and capability revocation. |
| `browser/local-builder/memory.pw.mjs` | 4 | Reviewed checkpoints/selected recall with Auto-memory disabled; expired recall refusal; real memory replacement and UI same-account reconnection revoking old recall/checkpoint controls. |
| `browser/local-builder/preferences.pw.mjs` | 3 | Setup and Auto-memory reload without caching local work/execution/recall consent; profile-bound model restoration; automatic key-free local-model discovery, preserved selection, refresh and removal without tasks. |
| `browser/local-builder/preview.pw.mjs` | 1 | Real module execution in an isolated snapshot; blocked parent/storage access, fetches/external assets/popups/top navigation; capability revocation/logout. |
| `browser/local-builder/providers.pw.mjs` | 1 | Real gateway/SDK streamed-quota failure, retained conversation/editor/task draft and project scope, another connected text-only profile completing with its own credential, and no source/error/credential leakage into context/cache/memory. |
| `browser/local-builder/terminal.pw.mjs` | 3 | Real reviewed native command output/nonzero exit without app credentials; Stop terminates ordinary descendants for manual and actual SDK-issued commands without declaring success. |
| `browser/local-builder/workflow.pw.mjs` | 5 | Standard permissions; actual SDK Plan/Build/follow-ups/fresh session; desktop/mobile themes; output following/scrollback/resizing; failed-status draft/model retention; completed tasks through delayed/pending/interrupted capture confirmation. |
| `browser/local-builder/workspace.pw.mjs` | 8 | Real launcher/folder consent, exact reviewed save/empty-file creation/deletion, actual SDK approval/rejection/Stop, delayed selection/result/draft/review races, integrated panel switching/active-tool highlights, declined-discard path retention, page-only drafts, and logout cleanup. |

The cache regression holds autosave timers pending rather than sleeping until a save, and
checks reload plus hidden-visibility flushing. Stop/Retry holds the real mock generator
before completion and verifies that Stop aborts the server with no capture; the retry uses
the ordinary generator and actual mock-memory capture. Authentication is paced **before** each test,
reserving each scenario's login budget against the real unchanged 12/minute limit; login requests and
signatures are not intercepted, and the production request deadline is not increased.

Builder scenarios use the real local app and actual SDK with scripted loopback responses,
except explicitly labeled UI-only race/connection fixtures. Each scenario authenticates logout
to dispose its workers/folder/preview rather than relaxing the four-workspace limit. Temporary
projects and approved commands are real local disk/process operations, not live cloud execution.

Synthetic browser wallets produce signatures that the real local server verifies.
Provider/connection and hostile-rendering responses use explicit fixtures; HTTP tests exercise
the real local routes with injected upstream clients, while vault encryption uses genuine
WebCrypto. These checks **do not** establish real extension, Tatum, MemWal, model-provider,
or cross-tool compatibility. Earlier visual reviews covered plans, clarifications, draft
results and review/applied Files. The preceding continuation inspected the final provider/settings
desktop/mobile captures, desktop-unlocked/mobile-locked vault, refreshed hosted accessibility
captures, and all eight integrated-project/terminal desktop/mobile light/dark captures.
The review checked theme colors, active tools, project titles, text readability and control
reachability. The short-height composer capture intentionally shows the bottom of its scrolled
options; automated checks separately bring its input, Send and Stream controls into view.
The folder/gateway continuation inspected fresh folder-picker desktop-dark/mobile-light and
320-pixel dark captures, the real SDK provider-recovery workspace with its retained editor
draft, Hugging Face/Gemini/OpenRouter error-help captures, and refreshed responsive onboarding,
Settings, Files and short-height composer captures. Controls and error text remain reachable.

### Reload regression follow-up

The [initial hosted browser run](https://github.com/vyshgit/adaptive-ai-agent-with-persistent-memory/actions/runs/42491949674)
passed five scenarios but failed the import/export reload check. React unmount cleanup does
not run on browser navigation, so a reload before the 350 ms autosave could restore an older
project. A deterministic local regression test reproduced that loss before the fix.

Project and chat caches now synchronously flush their latest snapshots on `pagehide`, hidden
`visibilitychange`, and component cleanup, while retaining debounced saves during editing.
Unit tests verify redaction, wallet-bound callbacks, and removal of disposed listeners. The
original import/reload scenario also holds autosave pending instead of waiting out the race.
At that historical milestone, all 135 local tests and seven Chromium scenarios passed with
the fix, followed by the successful hosted runs linked above. The earlier local redesign
milestone passed 180 tests and 31 Chromium scenarios. The privacy/portability/vault milestone
passed **218 tests and 49 Chromium scenarios**; the original local-builder milestone passed
**269 tests and 65 Chromium scenarios**. The prior integrated-workspace milestone passed
**289 tests and 74 Chromium scenarios**. The preceding automatic-memory/provider milestone
passed **329 tests and 87 Chromium scenarios** (63 hosted + 24 local-builder), followed by
focused state/provider/accessibility checks. The current folder/gateway continuation records
**357 tests and 98 Chromium scenarios** with the full-run/rerun qualifications above.
CI failure-artifact upload includes the hidden `.playwright/` report directory.

### Final continuation review

The earlier review covered credential/session/account isolation, capture consent, cache
revocation, handoff exports, vault crypto/lifecycle/reconnection, parent permissions, private SDK
workers, filesystem/command approvals, and the provider boundary. The latest focused review
also covered automatic-capture eligibility/completion/deduplication/disposal, capture-confirmation
races, profile identity, local discovery, and Settings/credential/tab continuity.
The folder/gateway continuation additionally reviewed selected-root lifecycle, endpoint/method
binding, credential lifetime, capability-scoped normalization, Gemini signature privacy and
recoverable provider failures. Syntax passed for **93 changed/new JavaScript modules**, and
local-link review checked **94 targets across 12 changed/new documents** with none missing.
Both protected document hashes match their pre-continuation values. CI YAML/matrix/script
validation passed; this is local validation, not an executed hosted workflow.

At the preceding milestone, syntax checks passed for **83 changed/new JavaScript modules**, and whitespace/conflict checks
passed for **73 new files**. Credential-pattern review scanned **135 changed/new text files**;
the three findings were intentional synthetic credential URLs in Markdown, authentication and
preference validation tests. Local-link review checked **93 targets across 12 changed/new
Markdown documents** with no missing files; the scenario table totals match both full suites.
No unintended credentials, secret environment files, generated reports, or build output appeared
in the reviewed change inventory. `git diff --check` passed. This focused review and the
dependency audit are not a complete application or password-manager security audit.

The build-contract planning documents (`ACTION_PLAN.md`, `IMPLEMENTATION_PROMPT.md`,
`SCOPE_AMENDMENTS.md`) were removed from the repository before final packaging; their
committed content, including the preserved user edits, remains recoverable from git
history. Earlier redesign work has local commits; the privacy/portability/vault/
local-builder/provider/automatic-memory follow-up and this documentation cleanup are local-only edits
until a final push. No commit, push, merge, or live/billable API test was performed for this
continuation review.

The initial automatic-memory browser runs completed all scheduled scenarios: **61/62 hosted**
and **20/23 builder** passed. The hosted failure revealed a real selection race: Settings saved
the new profile preference before the refreshed catalogue arrived. The picker now reapplies
that explicit preference when its exact profile/model becomes available. A held-status browser
regression verifies the fix, and two profiles with duplicate model IDs round-trip through real
vault encryption using distinct keys.

At that preceding milestone, the three builder failures were stale expectations for default Auto-memory, automatic local
discovery, and updated connection feedback. Corrected focused runs passed. A new local-discovery
scenario initially omitted the provider prefix from its expected option label; the corrected
scenario passed through reload and model removal. The new folder/gateway full runs and their
targeted reruns are recorded above.
Production motion, authentication limits/deadlines, execution limits and retries were not relaxed.

Visual review also found expanded Auto-memory options squeezed into a narrow column beside
the checkbox and character count on small screens. The disclosure now gets its own full-width
mobile row. All five accessibility scenarios passed after that layout-only change, and the
refreshed short-height capture shows readable full-width text. Typecheck and build also passed.

### Dependency audit — gates and remaining advisories

Full and production audits were rerun on **10 November 2026** after the dependency
cleanup. One root advisory was resolved with a verified override; the remaining npm-tooling
advisories have no compatible fix inside the pinned OpenCode SDK chain.

| Dependency | Finding | Resolution |
| --- | --- | --- |
| `zod` (3.25.76 / <4.6.6 copies under `gitlab-ai-provider` and friends) | [Oversized constrained-collection validation can exhaust memory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), high. | **Resolved.** A package override pins `zod` to `^4.6.6` (installs 4.6.7 everywhere). Verified compatible with regression tests: typecheck, **357/357 unit/HTTP/CLI tests**, production build, and the two-session recall demo all pass. The earlier "major change, unverified override" constraint no longer applies. |
| `glob@13.x`, through `@opencode/util` and npm tooling | [AbortSignal cancellation can permit post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate. | No compatible fix: the affected range ends at 14.0.1 and moving the installed 13.x tree to a patched 14.x major is not verified. |
| `minimatch@10.x`, through glob/npm tooling | [Globparts amplification can cause denial of service](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate. | Reported patch is 11.0.1+, a major change from the installed 10.x tree; not verified. |

**Current state: 26 moderate findings, 0 high, in both full and production audits.** These
are affected-package/propagation counts, not 26 independent advisories. `npm audit` reports
no automatic compatible fix for the remaining roots. The exact OpenCode SDK/plugin/core
**2.2.6** and Effect **4.1.0** pins remain. Overrides applied: the previously verified
`google-auth-library → gcp-metadata@8.1.2`, plus `zod@^4.6.6` described above; no forced
major override or `npm audit fix --force` was used.

Because remaining findings are moderate and unfixable within the SDK pins, the CI audit
gate (`.github/workflows/tests.yml`) checks **high severity or worse** and annotates the
documented moderates. They stay a release consideration, not a CI blocker: do not claim a
clean audit. Resolve and regression-test compatible dependency changes before release,
then rerun both audits and all affected SDK/unit/browser checks without relaxing approval
gates.

## Live manual validation

No need to send keys to a coding assistant. Start `npm run dev`, use
`http://127.0.0.1:3000/#/agent`, and enter credentials in the local app on a trusted server.
Never share a wallet key, seed phrase, API key, delegate private key, cookie, or authorization
header. Share sanitized error codes and public account/blob IDs if help is needed.

- [ ] **Real wallet extension:** use a supported Mainnet account, inspect/sign the login
  challenge, verify no transaction is requested, and exercise wallet disconnect/logout.
- [ ] **Tatum:** connect a Mainnet API key; confirm a real checkpoint and account observation
  through Tatum HTTP GraphQL. Check key/quota if `chain_unavailable` is returned.
- [ ] **MemWal:** create the account/delegate in the official dashboard. Connect Tatum first,
  then the account object and dedicated delegate. Confirm owner + signed delegate access;
  a public health response is insufficient. Keep the delegate **public** key for submission.
- [ ] **Live model:** connect an authorized AgentRouter application/key or another supported
  provider. Load its authenticated catalogue, select an available model, and use its documented
  protocol; exact-ID entry is only an unsupported-discovery fallback. Request RecallLoop approval if required rather
  than spoofing a client fingerprint. Discovery alone is not generation proof. Run the
  explicit bounded checks, then a real Talk clarification/continuation and a Build turn
  with compatible tool support. Checks may consume quota and execute no returned tools.
- [ ] **Confirmed writes:** teach a synthetic TypeScript/npm preference and a verified lesson.
  Inspect returned blob IDs, `stored` status, and independently refreshed inventory. If
  capture is pending/failed, inspect inventory before retrying accepted work.
- [ ] **Portable recall:** start a new session without old history. Then restart the server
  or use a fresh browser/device, sign in with the same wallet, reconnect the same account,
  and ask a preference-sensitive task. Check real citations and the effect on the answer.
- [ ] **Optional device vault:** on a trusted browser/server, explicitly save verified live
  connections, sign out/in or restart, unlock locally, and explicitly reconnect. Confirm
  unlock sends no requests, reconnection uses normal verification without writes, failed/
  revoked keys stay honest, and another wallet cannot select the saved copy. Do not record
  keys/passphrases; the vault is browser-local, not a device-synchronization feature.
- [ ] **Cross-tool memory:** review the official client setup, authorize a separate delegate
  on the exact owned account, isolate its credentials, and recall from both handoff namespaces.
  Only with separate write approval, confirm one synthetic fact's completed blob ID and
  fresh-session recall back in RecallLoop. Copied setup notes do not satisfy this live check.
- [ ] **Isolation:** sign into another wallet and confirm no project/history/credentials or
  recalled memories from the first wallet are selected. Test a stale background tab too.
- [ ] **Review/outcome:** inspect/download a proposal, apply it only in the browser, run the
  downloaded project tests locally, and teach the actual result. Do not label approval as
  test success, and do not store assistant speculation as a user-verified outcome.
- [ ] **Local builder with a live model:** launch from a trusted project folder, consent to
  Standard or Strict permissions, and send a focused Build task using a selected tool-capable
  provider. Inspect automatic routine edits/inspection and review each higher-risk action
  (or every write/command in Strict). Verify read-only Plan, follow-ups, actual disk changes, command output/exit,
  Stop, and an isolated static build preview. Native execution is not sandboxed. Model
  generation verification or a scripted SDK fixture is not live builder compatibility proof.
- [ ] **Portable builder checkpoint:** separately approve a small public-safe project/revision
  checkpoint, confirm its real blob/inventory, and recall/select it in a fresh local task or
  independently authorized trusted client. Do not expect source/credentials/approvals to restore.
- [ ] **Restore:** request bounded restore on the live account if needed; verify refreshed
  inventory/recall without claiming complete transcript reconstruction.
- [ ] **Mainnet minimum:** explicitly seed and independently verify at least 10 memories.
  The bundled seed targets 12. Review costs and use only public-safe synthetic content.

The browser Memory panel can seed the wallet scope after explicit confirmation. To produce
an evidence document, configure CLI credentials separately in gitignored `.env.local`, then:

```bash
npm run seed:memory -- --confirm-mainnet \
  --wallet-address YOUR_PUBLIC_SUI_ADDRESS \
  --evidence docs/MAINNET_EVIDENCE.md
```

This command may consume Mainnet quota. It requires Tatum, the official healthy/write-ready
Mainnet relayer, 12 unique confirmed blobs independently present in inventory, a delegate
public key, and a checkpoint. It never overwrites an existing file. Use a new filename for
subsequent runs. Model credentials are not needed for seeding, and browser sessions are
never reused by the CLI. A checkpoint is a chain observation, not independent storage proof.

## Outstanding gates

| Gate | Current status |
| --- | --- |
| Real wallet-extension onboarding | Not attempted; synthetic local wallet tests only. |
| Live Tatum reads with user key | **Not attempted: credentials absent.** |
| Authorized live MemWal account/delegate | **Not attempted: credentials absent.** |
| Live provider generation/tool compatibility | **Not attempted: credentials absent.** AgentRouter may additionally require app approval. |
| Reported Gemini HTTP 400 | Specific cause unconfirmed; requires full credential-redacted error text, model and failing operation. Offline signature/payload fixes are not a live diagnosis. |
| Verified Mainnet writes and portable recall | **Not attempted: credentials absent.** No blob IDs, live inventory, relayer/account proof, or checkpoint claimed. |
| Device-vault reconnection with real APIs | Not attempted; genuine crypto and synthetic connection wiring passed locally. Live credentials and explicit approval are required. |
| Claude Code/Codex cross-tool recall | Not attempted; official setup guidance and key-free handoff only. Client installation/authorization and any writes need separate approval. |
| Live local-builder model/build/checkpoint loop | Not attempted; actual SDK with scripted loopback models, real synthetic local files/commands, and mock checkpoints passed offline. |
| macOS/WSL local-builder execution | Not validated; current local SDK/process/preview evidence is Linux-only. |
| Dependency audit | **Unblocked at high severity: 26 moderate npm-tooling findings (0 high)** after the verified `zod@^4.6.6` override; incompatible fixes remain, and CI gates on high severity. Still not a clean audit. |
| Published learning-loop blog | Not published; dropped by choice. The submission form's description field plus the demo video carry that content (see README demo video slot). |
| Working live demo + 2–3 minute video | Not yet recorded/validated live. Offline demo works; paste the final URL in the README demo video field. |
| Public completed branch and hosted CI | Historical workspace PR #2 merged with successful CI; redesign branch remains local/unpushed with uncommitted follow-up edits and no current hosted CI or PR. Both browser suites are now in the locally checked workflow; the audit gate still fails. |

Do not promote a live checkbox to passed based on a test fixture, mock blob, public health
response, successful model listing, or a proposed but untested code change. The
[submission checklist](SUBMISSION_CHECKLIST.md) is the final gate, not this offline test table.

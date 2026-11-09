# Validation and live evidence status

Updated 9 November 2026. **Implementation/offline validation is green; live integration and
the hackathon submission are not yet complete.** No real Mainnet blob evidence has been
generated, and no success evidence file is checked in.

## Reproducible local checks

Run from the repository root with a supported patched Node runtime. Results below were
obtained on Linux with Node 26.13.0 and system Chromium.

| Command | Observed result |
| --- | --- |
| `npm test` | **180 passed, 0 failed, 0 skipped**, including the pre-existing regression tests. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; production JavaScript **491.86 kB / 144.64 kB gzip**. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser` | **31 passed** in 3.8 minutes; one worker, unchanged authentication policy/deadlines. |
| `npm run demo:agent` | Passed, isolated mock; first-session fact recalled in a new session, scripted review-only code proposal; no network/provider/Mainnet calls. |
| `npm run benchmark:retrieval` | Passed; four synthetic lexical cases, Recall@3 / MRR **1 / 1**. |
| `npm run evaluate:retrieval` | Passed; synthetic evaluation Recall@3 / MRR **1 / 1**, hard-negative rate **0.375**, **0 cross-agent leaks**. Not a live semantic-quality benchmark. |
| `npm audit` | **0 vulnerabilities** reported for the installed dependency lockfile. Not a complete application security audit. |

CI repeats unit/type/build/demo/audit checks with Node 24.22.1 and 26.13.0 and runs Chromium
scenarios separately. Historical follow-up [unit/build CI](https://github.com/vyshgit/adaptive-ai-agent-with-persistent-memory/actions/runs/42495197754)
and [browser CI](https://github.com/vyshgit/adaptive-ai-agent-with-persistent-memory/actions/runs/42495202400)
are completed/success for `728cb9995ecebb8cd46ac6538863a80c23593a48` on
`feat/recallloop-coding-workspace`, merged through PR #2. Those results are **not redesign CI**.
The current `feat/recallloop-dark-provider-redesign` work has local validation only; it has
not been pushed and has no hosted run or PR. A new hosted run is still required before any
future merge. Browser reports, screenshots, and traces are generated under gitignored
`.playwright/`, not submitted as live evidence.

### What the tests establish

- Real local Ed25519/Secp256k1/Secp256r1 signature verification; exact-message/address binding,
  expiring single-use challenges, cookie rotation, replay resistance, logout/expiry cleanup.
- Same-origin/operator gate, wallet-scoped caches/services, no owner credential fallback,
  stale-tab/session binding, and old-wallet disconnect isolation.
- Injected upstream account-type/Shared-owner checks, signed delegate authorization staging,
  and rollback/cleanup when verification fails or logout races an upstream result.
- Mock ingest/recall/inventory, user-only fact consolidation, profile/context budgets,
  idempotency behavior, pending-write capacity, partial failures, inventory pagination,
  tombstones, and refusal to count mock/unconfirmed evidence.
- Responses/Chat Completions wire parsing with **mock HTTP fixtures**, streaming tools,
  bounded outputs, honest incomplete/error handling, no client impersonation, and redaction
  across arbitrary stream chunks. Stateless Responses rounds/follow-ups use `store: false`,
  locally reconstructed text, and matching function `call_id` pairs without provider-stored
  response/message/reasoning references. This is not a live routing diagnosis or a claim
  that the previously reported Azure resource error is fixed.
- Separate account-specific model discovery, bounded non-executing generation/stream/tool
  verification, safe error categories, failed-replacement rollback, and failed-recheck status.
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

### Browser scenarios

| Suite | Scenarios | Coverage |
| --- | ---: | --- |
| `browser/accessibility.pw.mjs` | 5 | Conversation-first panels and sessions preserve drafts/approval controls; arrow-key settings tabs, focus trap/Escape/restoration; stored themes; solid reading surfaces, dialog-backdrop blur and reduced motion; onboarding, composer and panels from short mobile to desktop. |
| `browser/markdown.pw.mjs` | 2 | Lists/headings/tables, safe links, exact code and citation/review controls; no HTML execution, remote image fetching, unsafe links, or unreadable partial fences. |
| `browser/providers.pw.mjs` | 9 | Official presets without guessed models/key sharing; discovery versus verification; failed replacements/rechecks and categorized errors; Cancel/Close races; stale wallet callbacks; independent verification/disconnection and failed operator-token refresh. |
| `browser/wallet.pw.mjs` | 4 | Distinct connect/sign/verify progress; actionable wallet/signature declines; selected Mainnet account only; server logout before optional extension removal and visible disconnect errors. |
| `browser/workflow.pw.mjs` | 4 | Recall departure before asking dates; question-only reload/continuation; draft-only suggestions and preserved drafts; keyboard/short-mobile reachability; long cached clarification continuation through the real local server; proposed plans and literal hostile metadata. |
| `browser/workspace.pw.mjs` | 7 | Signed onboarding and cache/export redaction; offline recall → code proposal → exact download/review/application → outcome → fresh-session recall; safe import/edit/export and keyboard navigation; deterministic latest-cache flushing; cross-tab wallet isolation; mobile/theme/settings; Stop/Retry without duplicate users. |

The cache regression holds autosave timers pending rather than sleeping until a save, and
checks reload plus hidden-visibility flushing. Authentication is paced **before** each test,
reserving three attempts against the real unchanged 12/minute limit; login requests and
signatures are not intercepted, and the production request deadline is not increased.

Synthetic browser wallets produce signatures that the real local server verifies.
Provider/connection and hostile-rendering responses use explicit fixtures; HTTP tests exercise
the real local routes with injected upstream clients. These checks **do not** establish real
extension, Tatum, MemWal, or model-provider compatibility. Screenshots of plans, clarifications,
draft results, review/applied Files, provider dialogs, themes, and responsive surfaces were
visually inspected in addition to automated checks.

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
the fix, followed by the successful hosted runs linked above. The expanded redesign suite
reports 180 local tests and 31 Chromium scenarios, not a rerun of the historical seven only.
CI failure-artifact upload includes the hidden `.playwright/` report directory.

### Final continuation review

The final source/diff review covered credential/session isolation, cache lifecycle, provider
settings, workflow boundaries, and generated artifacts. Credential-pattern matches were only
intentional synthetic unsafe URLs in Markdown tests; no unintended credentials or generated
reports/build output were found in the reviewed change set. This review and the dependency
audit are not a complete application security audit.

The committed originals of `docs/ACTION_PLAN.md` and `docs/IMPLEMENTATION_PROMPT.md` were
verified against their recorded SHA-256 baselines. Newer local edits in both files remain
byte-for-byte untouched and excluded from continuation commits. See [scope amendments](SCOPE_AMENDMENTS.md).
The continuation is split into workflow/client regressions, UI/provider/Markdown, browser
tests, and documentation commits for review; it is not merged into `main` or pushed.

An intermediate browser run passed 30/31 and failed only a strict-mode status assertion:
progress and completion can briefly coexist while the connection dialog refreshes status.
The test now targets the intended completion message; authentication limits and production
deadlines were not changed. A focused repeat command completed twice before its shell
timeout during conservative harness cooldown; no third result is claimed. The subsequent
final full run completed successfully with **31/31 scenarios in 3.8 minutes**.

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
  provider. Copy an exact model ID and supported protocol from the authenticated account;
  do not rely on historical placeholders. Request RecallLoop approval if required rather
  than spoofing a client fingerprint. Discovery alone is not generation proof. Run the
  explicit bounded checks, then a real Talk clarification/continuation and a Build turn
  with compatible tool support. Checks may consume quota and execute no returned tools.
- [ ] **Confirmed writes:** teach a synthetic TypeScript/npm preference and a verified lesson.
  Inspect returned blob IDs, `stored` status, and independently refreshed inventory. If
  capture is pending/failed, inspect inventory before retrying accepted work.
- [ ] **Portable recall:** start a new session without old history. Then restart the server
  or use a fresh browser/device, sign in with the same wallet, reconnect the same account,
  and ask a preference-sensitive task. Check real citations and the effect on the answer.
- [ ] **Isolation:** sign into another wallet and confirm no project/history/credentials or
  recalled memories from the first wallet are selected. Test a stale background tab too.
- [ ] **Review/outcome:** inspect/download a proposal, apply it only in the browser, run the
  downloaded project tests locally, and teach the actual result. Do not label approval as
  test success, and do not store assistant speculation as a user-verified outcome.
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
| Verified Mainnet writes and portable recall | **Not attempted: credentials absent.** No blob IDs, live inventory, relayer/account proof, or checkpoint claimed. |
| Published learning-loop blog | Draft only: [BLOG_DRAFT.md](BLOG_DRAFT.md). |
| Working live demo + 2–3 minute video | Not yet recorded/validated live. Offline demo works. |
| Public completed branch and hosted CI | Historical workspace PR #2 merged with successful CI; redesign branch remains local and unpushed, with no redesign hosted CI or PR. |

Do not promote a live checkbox to passed based on a test fixture, mock blob, public health
response, successful model listing, or a proposed but untested code change. The
[submission checklist](SUBMISSION_CHECKLIST.md) is the final gate, not this offline test table.

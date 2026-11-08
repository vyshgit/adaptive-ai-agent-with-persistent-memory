# Validation and live evidence status

Updated 8 November 2026. **Implementation/offline validation is green; live integration and
the hackathon submission are not yet complete.** No real Mainnet blob evidence has been
generated, and no success evidence file is checked in.

## Reproducible local checks

Run from the repository root with a supported patched Node runtime. Results below were
obtained on Linux with Node 26.13.0 and system Chromium.

| Command | Observed result |
| --- | --- |
| `npm test` | **133 passed, 0 failed, 0 skipped**, including the pre-existing regression tests. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; production React assets generated. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser` | **6 passed**. |
| `npm run demo:agent` | Passed, isolated mock; first-session fact recalled in a new session, scripted review-only code proposal; no network/provider/Mainnet calls. |
| `npm audit` | **0 vulnerabilities** reported for the installed dependency lockfile. Not a complete application security audit. |

CI is configured to repeat unit/type/build/demo/audit checks with Node 24.22.1 and 26.13.0
and run Chromium scenarios separately. That configuration is not a claim that hosted CI
has already run successfully. Browser reports/screenshots/traces are generated under
gitignored `.playwright/`, not submitted as live evidence.

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
  across arbitrary stream chunks.
- Browser-only import/edit/export, reviewed proposals, exact patches (including `git apply
  --check` fixtures), Stop/Retry, mobile layout/themes, and keyboard-accessible modals.
- CLI defaults/confirmation guards, network-free two-session flow, wallet namespace mapping,
  and evidence exports that refuse invalid proof or existing files.

### Browser scenarios

1. Signed synthetic-wallet onboarding and credential-form/cache/export redaction.
2. Offline recall → code proposal → download/review → outcome → recall after clearing chat.
3. Safe text import/export, cache reload, and editor keyboard behavior.
4. Cross-tab wallet changes reject stale requests and restore the correct scoped project.
5. Mobile panels/themes/settings at 390 px and 320 px without viewport overflow.
6. Stop preserves a partial answer without capture; Retry avoids duplicate user submission.

Synthetic browser wallets produce signatures that the real local server verifies.
Credential-form responses are mocked: these checks **do not** establish real extension,
Tatum, MemWal, or model-provider compatibility.

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
  provider. Send a Talk turn, then a Build turn with compatible tool support. Discovery
  alone is not generation proof. For AgentRouter `gpt-6.1-sol`, select Responses; request
  provider approval rather than spoofing client fingerprints.
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
| Public completed branch and hosted CI | Verify after commit/push; do not infer visibility from local Git state. |

Do not promote a live checkbox to passed based on a test fixture, mock blob, public health
response, successful model listing, or a proposed but untested code change. The
[submission checklist](SUBMISSION_CHECKLIST.md) is the final gate, not this offline test table.

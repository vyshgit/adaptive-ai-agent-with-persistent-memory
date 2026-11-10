# Total Recall submission checklist

**Track 2 — Smart Agents for Real Life** · Deadline: **10 November 2026, 17:00 UTC**.

Rules verified 8 November 2026 against the
[official Walrus event rules](https://thewalrussessions.wal.app/tatum-total-recall).
Also check the [Tatum event page](https://tatum.io/hackathon/total-recall) and
[submission form](https://recall-tatum-walrus.vercel.app/) before submitting, since sponsors
may update requirements. **The project is not submission-complete yet.**
Local validation and release-review status updated **10 November 2026**.

## Required gates

- [x] Memory-first conversation/planning, bounded reviewed coding, and visible recall/capture
  workflow implemented; working plans and draft-only clarification replies are distinct from actions.
- [x] Credential-free local startup, CLI demo, a complete 357-test run, and build/typecheck
  validated. All 98 browser scenarios (66 hosted conversation + 32 local-builder) have passing
  observations across full runs and targeted reruns. Details: [VALIDATION.md](VALIDATION.md).
- [x] Per-user account/service isolation, default facts-only Auto-memory with a disable control
  and separate raw consent, revocable tab caches, key-free cross-tool setup, and encrypted
  multi-profile device-vault behavior validated offline.
  Synthetic fixtures are not live account/API/Mainnet or cross-tool compatibility evidence.
- [x] Integrated selectable-folder builder with Standard/Strict permissions, real disk edits/
  native commands, read-only Plan, bounded follow-ups, actual private SDK execution, isolated
  static previews, and opt-in reviewed checkpoints validated offline. Native commands are not
  sandboxed; scripted model/mock memory is not live evidence.
- [x] Shared provider gateway, endpoint-bound dispatch authentication/cleanup, text-only tool
  denial, private Gemini signature replay, and retained-context provider recovery validated
  offline. The user's specific Gemini HTTP 400 still needs credential-redacted error details.
- [ ] **Dependency oversight:** audits now report 26 moderate npm-tooling findings and 0 high
  (CI gates on high severity after the verified `zod@^4.6.6` override). Monitor the OpenCode
  SDK chain for compatible updates; do not claim a clean audit.
- [ ] **Walrus Memory writing on Mainnet:** verify the user's authorized account/delegate,
  actual completed writes, and independent inventory. Health/config responses are not proof.
- [ ] **At least 10 Mainnet memories:** bundled guarded seed targets 12 unique confirmed
  synthetic memories. Mock, pending, expired, duplicate, or legacy-demo records do not count.
- [ ] **Relevant Tatum onchain data:** demonstrate actual Sui Mainnet checkpoint and official
  account-owner reads through Tatum HTTP GraphQL. A checkpoint is not proof of Walrus storage.
- [ ] **Learning over time:** fresh history/browser/server session recalls a confirmed
  preference or correction and visibly changes a later answer. Record the actual live model.
- [ ] **Demo video first (mandatory):** the 2–3 minute demo is required by the form.
  Use it plus the project-description field for the learning loop, Tatum + Walrus
  example, and honest limits. Paste the final URL into the README demo video slot.
  A separate blog post is optional and not required for this submission.
- [ ] **Working demo:** verify real wallet-extension/provider/account setup on the intended
  demo environment. Offline/mock fallback must be visibly labeled, not marketed as Mainnet.
- [ ] **Public repository:** push the completed branch and verify access without login.
  If presenting a feature branch, link it explicitly rather than a default branch missing code.
  The earlier workspace PR #2 is merged; the redesign branch is locally validated but unpushed,
  with this follow-up uncommitted and no current hosted CI or PR.
  Historical green runs do not validate these changes.
- [ ] **2–3 minute demo video:** upload a viewable video, check access, and include its URL.
  This is mandatory on the form, even though the historical plan called video optional.
- [ ] **Submit the form before the deadline** and retain the confirmation.

No real Mainnet evidence file exists yet. Follow
[live validation](VALIDATION.md#live-manual-validation) for credential-safe steps. The CLI
requires `--confirm-mainnet`; evidence export requires a new, nonexistent output filename.
Use `--wallet-address` to seed the same namespace as the wallet UI, not the CLI default.

## Form information to prepare

The official rules list:

- Email, Discord handle, LinkedIn, how you heard about the event, and whether this is your
  first Web3 project.
- Tatum ID, public SUI address, and **MemWal account object ID** (not the wallet address).
- **MEMWAL_AGENT_ID = the delegate public key** shown after verification/in the official
  dashboard. Do not submit the private delegate key or RecallLoop's hashed wallet namespace.
- Demo video URL (mandatory) and public GitHub repository; blog URL only if one was
  published (optional).
- Honest feedback about building with Walrus and with Tatum AI Builder. Do not claim AI
  Builder usage or a bonus unless the actual project qualifies.
- Published blog URL in the available submission/project-description field — only if you
  chose to publish one; otherwise leave empty and rely on the demo video + description.

Recheck eligibility/terms and the one-submission-per-person rule. Personal form details,
credentials, and the act of submitting should be handled by the entrant; no account,
publication, form submission, or fee-bearing live write is implied by offline validation.

## Suggested 2–3 minute video

Record only after live checks pass. Prepare account/keys off-camera; never show password
fields, authorization headers, cookies, a wallet seed phrase, or private user memories.

| Time | Show |
| --- | --- |
| 0:00–0:20 | Problem and Track 2 workflow; signed wallet workspace. Explain login is not a transaction. |
| 0:20–0:50 | Teach a synthetic preference, show confirmed blob IDs and Memory inventory, plus Tatum's real checkpoint/account observation. |
| 0:50–1:25 | New conversation with no old history; recall chips and a preference-aware Build proposal. |
| 1:25–1:55 | Review before/after, apply only in browser, download, and record an outcome you actually tested locally. |
| 1:55–2:30 | Fresh browser/server session with the same wallet/account; recall preference/correction, show 10+ verified Mainnet records and evidence. |
| 2:30–2:50 | Public repo and demo video links; boundaries: local history versus portable memory, no model retraining, and native local commands governed by Standard/Strict permissions rather than sandboxing. |

If timing requires cuts, preconfigure credentials and use prepared **real** evidence. Do
not substitute a mock count or fabricated blob for a slow live write. Use the wallet
workspace Memory panel, not the legacy console's illustrative records, to demonstrate
Mainnet inventory.

If showing the local builder instead of conversation-only proposals, launch it explicitly
from a trusted project folder. Show routine actions, an exact higher-risk disk/command review
(or Strict review for every write/command), actual results, static preview, and a separately
approved checkpoint. Show automatic user-context capture and its confirmed status too.
Walrus carries extracted/reviewed context, not source restoration
or execution approvals. Do not expose this local mode through a hosted demo/reverse proxy.

## Presentation and scoring

Official criteria: **30% Walrus/Tatum integration, 30% technical quality, 20% creativity,
20% presentation**. The strongest story is a verified correction changing a later task,
with citations and explicit code review—not a claim that all chat text is model training.
Sharing on X/LinkedIn is a bonus; do not treat it as a replacement for required deliverables.

## Final local review and release checks

- [x] Review the follow-up diff/new files for credentials, generated artifacts, and inaccurate
  claims; no unintended credentials or generated artifacts found in the reviewed changes.
- [x] Check the protected local plan/prompt SHA-256 values, preserve pre-existing edits
  byte-for-byte, and document scope amendments. No commit/push/merge for this follow-up.
- [x] Inspect all eight final integrated-project/terminal desktop/mobile light/dark captures;
  themes, active tools, project titles, layout and controls remain visible/reachable. Also
  inspect provider/vault captures and the refreshed short-height Auto-memory layout.
- [x] Inspect fresh folder-picker 320/390/1440-pixel captures, real SDK provider recovery with
  retained drafts, HF/Gemini/OpenRouter error help, and responsive onboarding/Settings/Files.
- [x] Run `npm test -- --test-concurrency=1`, `npm run typecheck`, `npm run build`, both browser
  suites, launcher help, CLI demo/retrieval and a fresh bounded full audit. The initial unit
  timeouts passed unchanged in the complete bounded rerun. Both hosted browser failures and
  the builder renderer-crash case passed targeted reruns; Stop now uses a deterministic
  generator gate and verifies actual abort/capture behavior. Full and rerun artifacts are
  retained separately. The production-only audit result is from the earlier 10 November run
  against the same lockfile. Both audits fail and remain an unchecked release gate above:
  [VALIDATION.md](VALIDATION.md). Repeat affected checks if code changes before release.
- [x] Add separate hosted-workspace/local-builder browser CI matrix jobs and bounded unit-test
  concurrency; validate YAML, matrix conditions, script references and failure artifacts locally.
- [ ] Resolve the dependency gate and execute current hosted CI before claiming green hosted
  validation for this follow-up.
- [ ] Verify hosted CI, public branch/default-branch contents, npm startup, and demo links.
- [ ] Inspect real evidence and the published blog/video; replace no missing proof with a fixture.
- [ ] Check final form/URLs while logged out and submit before **17:00 UTC on 10 November**.

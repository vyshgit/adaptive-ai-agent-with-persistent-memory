# Total Recall submission checklist

**Track 2 — Smart Agents for Real Life** · Deadline: **10 November 2026, 17:00 UTC**.

Rules verified 8 November 2026 against the
[official Walrus event rules](https://thewalrussessions.wal.app/tatum-total-recall).
Also check the [Tatum event page](https://tatum.io/hackathon/total-recall) and
[submission form](https://recall-tatum-walrus.vercel.app/) before submitting, since sponsors
may update requirements. **The project is not submission-complete yet.**

## Required gates

- [x] Coding/planning agent and visible recall/capture workflow implemented.
- [x] Credential-free local startup, CLI demo, 133 tests, build/typecheck, and 6 browser
  scenarios validated. Details: [VALIDATION.md](VALIDATION.md).
- [ ] **Walrus Memory writing on Mainnet:** verify the user's authorized account/delegate,
  actual completed writes, and independent inventory. Health/config responses are not proof.
- [ ] **At least 10 Mainnet memories:** bundled guarded seed targets 12 unique confirmed
  synthetic memories. Mock, pending, expired, duplicate, or legacy-demo records do not count.
- [ ] **Relevant Tatum onchain data:** demonstrate actual Sui Mainnet checkpoint and official
  account-owner reads through Tatum HTTP GraphQL. A checkpoint is not proof of Walrus storage.
- [ ] **Learning over time:** fresh history/browser/server session recalls a confirmed
  preference or correction and visibly changes a later answer. Record the actual live model.
- [ ] **Published blog:** publish the learning loop, Tatum + Walrus use, measured/observed
  example, and honest limits. [BLOG_DRAFT.md](BLOG_DRAFT.md) is only a draft, not this gate.
- [ ] **Working demo:** verify real wallet-extension/provider/account setup on the intended
  demo environment. Offline/mock fallback must be visibly labeled, not marketed as Mainnet.
- [ ] **Public repository:** push the completed branch and verify access without login.
  If presenting a feature branch, link it explicitly rather than a default branch missing code.
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
- Project description, viewable 2–3 minute demo video, and public GitHub repository.
- Honest feedback about building with Walrus and with Tatum AI Builder. Do not claim AI
  Builder usage or a bonus unless the actual project qualifies.
- Published blog URL in the available submission/project-description field.

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
| 2:30–2:50 | Public repo/blog/demo links; boundaries: local history, portable memory, no model retraining or unrestricted terminal. |

If timing requires cuts, preconfigure credentials and use prepared **real** evidence. Do
not substitute a mock count or fabricated blob for a slow live write. Use the wallet
workspace Memory panel, not the legacy console's illustrative records, to demonstrate
Mainnet inventory.

## Presentation and scoring

Official criteria: **30% Walrus/Tatum integration, 30% technical quality, 20% creativity,
20% presentation**. The strongest story is a verified correction changing a later task,
with citations and explicit code review—not a claim that all chat text is model training.
Sharing on X/LinkedIn is a bonus; do not treat it as a replacement for required deliverables.

## Final release check

- [ ] Review the committed diff for credentials, generated artifacts, and inaccurate claims.
- [ ] Confirm the original plan/prompt are unchanged and scope changes are documented.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run test:browser`,
  `npm run demo:agent`, and `npm audit` on the final release.
- [ ] Verify hosted CI, public branch/default-branch contents, npm startup, and demo links.
- [ ] Inspect real evidence and the published blog/video; replace no missing proof with a fixture.
- [ ] Check final form/URLs while logged out and submit before **17:00 UTC on 10 November**.
